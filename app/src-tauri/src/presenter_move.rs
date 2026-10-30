//! Moving a show that is running: the show and the presenter's window change displays without a restart (the page is not reloaded,
//! so the slide, the step and the timer stay). Three things start it: "Swap screens", a display picked from a menu, and a display
//! that disappears (a projector unplugged), which brings the show back to the main display. What is decided is pure and tested; the
//! rest only puts the windows where the decision says. It also flashes a number on each display so the menu's names can be told apart.

use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindowBuilder,
};

use crate::closing::MAIN;
use crate::presenter::{PRESENTER, Rect, centred, in_address};
use crate::presenter_screen::{Display, Plan, Restore, display_of};

/// How long the number shows on each display.
const IDENTIFY_FOR: Duration = Duration::from_millis(1500);

/// Where the show goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// The other display: the one the presenter's window is on (the next one when there are more than two).
    Swap,
    /// A display by its label.
    Named(String),
}

impl Target {
    /// `swap` or `name:<label>`; anything else is nothing.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "swap" => Some(Self::Swap),
            other => other
                .strip_prefix("name:")
                .filter(|label| !label.is_empty())
                .map(|label| Self::Named(label.to_string())),
        }
    }
}

fn contains(area: Rect, point: (i64, i64)) -> bool {
    point.0 >= i64::from(area.x)
        && point.1 >= i64::from(area.y)
        && point.0 < i64::from(area.x) + i64::from(area.w)
        && point.1 < i64::from(area.y) + i64::from(area.h)
}

fn middle_of(window: Rect) -> (i64, i64) {
    (
        i64::from(window.x) + i64::from(window.w / 2),
        i64::from(window.y) + i64::from(window.h / 2),
    )
}

/// Whether the middle of the window is on one of the displays.
pub fn on_a_display(displays: &[Display], window: Rect) -> bool {
    displays.iter().any(|d| contains(d.area, middle_of(window)))
}

/// Where the show goes for `target`, with the presenter's window on the display the show leaves. None when there is nothing to do:
/// fewer than two displays, a display that is not there, or the show is on the one asked for already.
pub fn plan_move(
    displays: &[Display],
    show: Rect,
    presenter: Option<Rect>,
    target: &Target,
) -> Option<Plan> {
    if displays.len() < 2 {
        return None;
    }
    let here = display_of(displays, show);
    let there = match target {
        Target::Named(label) => displays.iter().position(|d| &d.label == label)?,
        Target::Swap => presenter
            .map(|p| display_of(displays, p))
            .filter(|i| *i != here)
            .or_else(|| (0..displays.len()).find(|i| *i != here))?,
    };
    (there != here).then_some(Plan {
        show: there,
        presenter: Some(here),
        moved: true,
    })
}

/// A show whose display is gone comes back to the main display (the first when none says it is the main one), and the presenter's
/// window takes another. None when the show is on a display still, or there are none at all.
pub fn recover(displays: &[Display], show: Rect) -> Option<Plan> {
    if displays.is_empty() || on_a_display(displays, show) {
        return None;
    }
    let main = displays.iter().position(|d| d.primary).unwrap_or(0);
    Some(Plan {
        show: main,
        presenter: (0..displays.len()).find(|i| *i != main),
        moved: true,
    })
}

/// Where the main window goes back to after the show: where it came from, or, when that display has been unplugged since, the middle
/// of the main display.
pub fn visible_restore(displays: &[Display], restore: Restore) -> Restore {
    if displays.is_empty() || on_a_display(displays, restore.rect) {
        return restore;
    }
    let main = displays
        .iter()
        .find(|d| d.primary)
        .unwrap_or(&displays[0])
        .area;
    let size = (restore.rect.w.min(main.w), restore.rect.h.min(main.h));
    let (x, y) = centred(main, size);
    Restore {
        rect: Rect {
            x,
            y,
            w: size.0,
            h: size.1,
        },
        maximized: restore.maximized,
    }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The page flashed on a display: its number, large, and its name below. It uses the system's own colours, not the app's.
pub fn identify_html(number: usize, name: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><title>Screen {number}</title><body style=\"margin:0;display:grid;place-items:center;\
         height:100vh;background:Highlight;color:HighlightText;font-family:system-ui,sans-serif;text-align:center;overflow:hidden\">\
         <div><div style=\"font-size:120px;font-weight:700;line-height:1\">{number}</div>\
         <div style=\"font-size:22px;margin-top:10px\">{}</div></div>",
        escape(name)
    )
}

/// A display as the "Present on" menu lists it.
#[derive(Debug, Serialize)]
pub struct ScreenInfo {
    pub label: String,
    pub primary: bool,
    /// The main window (the show, while one runs) is on it.
    pub current: bool,
}

/// The displays attached now, with which is the main one and which the window is on.
#[tauri::command]
pub fn present_screens(app: AppHandle) -> Vec<ScreenInfo> {
    let displays = crate::presenter_screen::displays_of(&app);
    let at = app
        .get_webview_window(MAIN)
        .as_ref()
        .and_then(crate::presenter_screen::outer_rect)
        .map(|w| display_of(&displays, w));
    displays
        .into_iter()
        .enumerate()
        .map(|(i, d)| ScreenInfo {
            label: d.label,
            primary: d.primary,
            current: at == Some(i),
        })
        .collect()
}

/// Puts the show and the presenter's window where `plan` says. Nothing is reloaded.
fn apply(app: &AppHandle, displays: &[Display], plan: &Plan) -> Result<(), String> {
    let main = app
        .get_webview_window(MAIN)
        .ok_or("The main window is not open")?;
    let full = main.is_fullscreen().unwrap_or(false);
    if full {
        let _ = main.set_fullscreen(false);
    }
    if crate::presenter_screen::origin().is_some_and(|o| o.maximized) {
        let _ = main.unmaximize();
    }
    let area = displays[plan.show].area;
    let size = main.outer_size().map_or((area.w, area.h), |s| {
        (s.width.min(area.w), s.height.min(area.h))
    });
    let (x, y) = centred(area, size);
    let _ = main.set_size(PhysicalSize::new(size.0, size.1));
    main.set_position(PhysicalPosition::new(x, y))
        .map_err(|err| err.to_string())?;
    if full {
        let _ = main.set_fullscreen(true);
    }
    let presenter_area = plan.presenter.map(|i| displays[i].area);
    if let (Some(area), Some(window)) = (presenter_area, app.get_webview_window(PRESENTER)) {
        let _ = window.unmaximize();
        let size = window
            .outer_size()
            .map_or((area.w, area.h), |s| (s.width, s.height));
        let (x, y) = centred(area, size);
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.maximize();
    }
    crate::presenter_screen::note_moved(presenter_area);
    Ok(())
}

/// Moves the running show: `swap`, or `name:<display>`. The presenter's window takes the display the show leaves.
#[tauri::command(async)]
pub fn present_move(app: AppHandle, target: String) -> Result<(), String> {
    let target = Target::parse(&target).ok_or("That is not a place to move the show to")?;
    if crate::presenter_screen::origin().is_none() {
        return Err("No show is running".into());
    }
    let main = app
        .get_webview_window(MAIN)
        .ok_or("The main window is not open")?;
    let displays = crate::presenter_screen::displays_of(&app);
    let show =
        crate::presenter_screen::outer_rect(&main).ok_or("The window has no place to be read")?;
    let presenter = app
        .get_webview_window(PRESENTER)
        .as_ref()
        .and_then(crate::presenter_screen::outer_rect);
    match plan_move(&displays, show, presenter, &target) {
        Some(plan) => apply(&app, &displays, &plan),
        None => Ok(()),
    }
}

/// Called when the displays change while a show runs: a show left on a display that is gone comes back to the main one. Says whether
/// it moved anything.
#[tauri::command(async)]
pub fn present_check(app: AppHandle) -> Result<bool, String> {
    if crate::presenter_screen::origin().is_none() {
        return Ok(false);
    }
    let Some(main) = app.get_webview_window(MAIN) else {
        return Ok(false);
    };
    let displays = crate::presenter_screen::displays_of(&app);
    let Some(show) = crate::presenter_screen::outer_rect(&main) else {
        return Ok(false);
    };
    match recover(&displays, show) {
        Some(plan) => apply(&app, &displays, &plan).map(|()| true),
        None => Ok(false),
    }
}

/// Flashes each display's number and name on it for a moment: a small borderless window per display, closed by itself.
#[tauri::command(async)]
pub fn present_identify(app: AppHandle) {
    for (i, display) in crate::presenter_screen::displays_of(&app)
        .iter()
        .enumerate()
    {
        let page = format!(
            "data:text/html;charset=utf-8,{}",
            in_address(&identify_html(i + 1, &display.label))
        );
        let Ok(url) = Url::parse(&page) else {
            continue;
        };
        let Ok(window) =
            WebviewWindowBuilder::new(&app, format!("identify-{i}"), WebviewUrl::External(url))
                .title("Screen")
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .inner_size(360.0, 220.0)
                .build()
        else {
            continue;
        };
        if let Ok(size) = window.outer_size() {
            let (x, y) = centred(display.area, (size.width, size.height));
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
        std::thread::spawn(move || {
            std::thread::sleep(IDENTIFY_FOR);
            let _ = window.close();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect { x, y, w, h }
    }

    fn display(label: &str, area: Rect, primary: bool) -> Display {
        Display {
            label: label.into(),
            area,
            primary,
        }
    }

    fn laptop() -> Display {
        display("Built-in", r(0, 0, 1440, 900), true)
    }

    fn projector() -> Display {
        display("Projector", r(1440, 0, 1920, 1080), false)
    }

    const ON_LAPTOP: Rect = r(100, 80, 1200, 700);
    const ON_PROJECTOR: Rect = r(1500, 40, 1200, 700);

    #[test]
    fn a_target_is_swap_or_a_display_by_name() {
        assert_eq!(Target::parse("swap"), Some(Target::Swap));
        assert_eq!(
            Target::parse("name:Projector"),
            Some(Target::Named("Projector".into()))
        );
        assert_eq!(Target::parse("name:"), None);
        assert_eq!(Target::parse("auto"), None);
    }

    #[test]
    fn swapping_with_two_displays_sends_the_show_to_the_other_and_the_presenter_back() {
        let displays = [laptop(), projector()];
        let plan = plan_move(&displays, ON_PROJECTOR, None, &Target::Swap).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: Some(1),
                moved: true
            }
        );
        let plan = plan_move(&displays, ON_LAPTOP, None, &Target::Swap).unwrap();
        assert_eq!((plan.show, plan.presenter), (1, Some(0)));
    }

    #[test]
    fn swapping_with_three_displays_takes_the_one_the_presenter_is_on() {
        let third = display("Hotel TV", r(3360, 0, 1920, 1080), false);
        let displays = [laptop(), projector(), third];
        let presenter = r(3400, 20, 1000, 700);
        let plan = plan_move(&displays, ON_PROJECTOR, Some(presenter), &Target::Swap).unwrap();
        assert_eq!((plan.show, plan.presenter), (2, Some(1)));
        // A presenter on the same display as the show (one display apart from the others): the first other display.
        let plan = plan_move(&displays, ON_PROJECTOR, Some(ON_PROJECTOR), &Target::Swap).unwrap();
        assert_eq!(plan.show, 0);
    }

    #[test]
    fn a_display_by_name_gets_the_show_and_the_one_it_left_gets_the_presenter() {
        let displays = [laptop(), projector()];
        let to = Target::Named("Projector".into());
        let plan = plan_move(&displays, ON_LAPTOP, None, &to).unwrap();
        assert_eq!((plan.show, plan.presenter, plan.moved), (1, Some(0), true));
        // Already there, or a name that is gone: nothing to move.
        assert_eq!(plan_move(&displays, ON_PROJECTOR, None, &to), None);
        let gone = Target::Named("Hotel TV".into());
        assert_eq!(plan_move(&displays, ON_LAPTOP, None, &gone), None);
    }

    #[test]
    fn one_display_has_nowhere_to_swap_to() {
        assert_eq!(plan_move(&[laptop()], ON_LAPTOP, None, &Target::Swap), None);
        assert_eq!(plan_move(&[], ON_LAPTOP, None, &Target::Swap), None);
    }

    #[test]
    fn a_show_on_a_display_that_is_gone_comes_back_to_the_main_display() {
        // The projector was unplugged: the window's middle is on nothing.
        let plan = recover(&[laptop()], ON_PROJECTOR).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: None,
                moved: true
            }
        );
        // With another display left, the presenter's window takes it; the list may come in either order.
        let tv = display("Hotel TV", r(-1920, 0, 1920, 1080), false);
        let plan = recover(&[tv, laptop()], ON_PROJECTOR).unwrap();
        assert_eq!((plan.show, plan.presenter), (1, Some(0)));
    }

    #[test]
    fn a_show_that_is_on_a_display_is_left_alone_and_no_displays_means_nothing_to_do() {
        assert_eq!(recover(&[laptop(), projector()], ON_PROJECTOR), None);
        assert_eq!(recover(&[], ON_LAPTOP), None);
        // With no main display marked, the first one is the main.
        let plain = display("A", r(0, 0, 800, 600), false);
        assert_eq!(recover(&[plain], ON_PROJECTOR).unwrap().show, 0);
    }

    #[test]
    fn the_window_goes_back_where_it_came_from_unless_that_display_is_gone() {
        let kept = Restore {
            rect: ON_LAPTOP,
            maximized: false,
        };
        assert_eq!(visible_restore(&[laptop(), projector()], kept), kept);
        // It came from the projector, which is unplugged: the middle of the main display, as large as fits.
        let from_projector = Restore {
            rect: r(1500, 40, 1800, 1000),
            maximized: true,
        };
        let back = visible_restore(&[laptop()], from_projector);
        assert_eq!(back.rect, r(0, 0, 1440, 900));
        assert!(back.maximized);
        assert_eq!(visible_restore(&[], from_projector), from_projector);
    }

    #[test]
    fn the_flashed_page_has_the_number_and_the_name_and_cannot_be_written_into() {
        let page = identify_html(2, "DELL <U2720Q> & \"co\"");
        assert!(page.contains(">2<"));
        assert!(page.contains("DELL &lt;U2720Q&gt; &amp; &quot;co&quot;"));
        assert!(!page.contains("<U2720Q>"));
    }
}
