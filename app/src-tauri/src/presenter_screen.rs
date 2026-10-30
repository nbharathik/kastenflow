//! Which display a slide show fills. With two displays (a laptop and a projector) the show goes on the external one: the main window
//! is moved there before it goes full screen, the presenter's window goes on the display the main window came from, and when the
//! show ends everything goes back. "Present on" in the slideshow options chooses between automatic, the display the window is on,
//! and a display by name. The choosing is a pure function of the displays and the window, so it is tested without any.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::closing::MAIN;
use crate::presenter::Rect;

/// A display, as the choice sees it: its label (what the menu shows), where it is on the desktop and whether it is the primary one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    pub label: String,
    pub area: Rect,
    pub primary: bool,
}

/// What the person chose in "Present on".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Choice {
    /// The external display when there is one (and the window is not already on it), else the display the window is on.
    Automatic,
    /// The display the window is on.
    ThisScreen,
    /// A display by its label.
    Named(String),
}

impl Choice {
    /// A choice as the app keeps it: `auto`, `here` or `name:<label>`; anything else is automatic.
    pub fn parse(text: &str) -> Self {
        match text {
            "here" => Self::ThisScreen,
            other => match other.strip_prefix("name:") {
                Some(label) if !label.is_empty() => Self::Named(label.to_string()),
                _ => Self::Automatic,
            },
        }
    }
}

/// Where the show and the presenter's window go, as positions in the list of displays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub show: usize,
    /// The display for the presenter's window; none when there is only the one display (it then goes beside the show's window).
    pub presenter: Option<usize>,
    /// The main window has to be moved to get to the display the show is on.
    pub moved: bool,
}

/// What puts the main window back after the show: where it was, and whether it was maximised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Restore {
    pub rect: Rect,
    pub maximized: bool,
}

/// The display the window is on: the one its middle is on, else the first.
pub fn display_of(displays: &[Display], window: Rect) -> usize {
    let (x, y) = (
        i64::from(window.x) + i64::from(window.w / 2),
        i64::from(window.y) + i64::from(window.h / 2),
    );
    displays
        .iter()
        .position(|d| {
            x >= i64::from(d.area.x)
                && y >= i64::from(d.area.y)
                && x < i64::from(d.area.x) + i64::from(d.area.w)
                && y < i64::from(d.area.y) + i64::from(d.area.h)
        })
        .unwrap_or(0)
}

/// Where the show and the presenter's window go. None when there are no displays to choose from.
pub fn choose(displays: &[Display], window: Rect, choice: &Choice) -> Option<Plan> {
    if displays.is_empty() {
        return None;
    }
    let here = display_of(displays, window);
    // Automatic: the external display, unless the window is on one already; with only the primary, where it is.
    let automatic = || {
        if displays[here].primary {
            displays.iter().position(|d| !d.primary).unwrap_or(here)
        } else {
            here
        }
    };
    let show = match choice {
        Choice::ThisScreen => here,
        Choice::Automatic => automatic(),
        // A display that is gone (unplugged since it was chosen) is as if nothing was chosen.
        Choice::Named(label) => displays
            .iter()
            .position(|d| &d.label == label)
            .unwrap_or_else(automatic),
    };
    let presenter = if show == here {
        // The show stays where the window is: the presenter's window takes another display, the primary one if it can.
        displays
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != show)
            .min_by_key(|(_, d)| !d.primary)
            .map(|(i, _)| i)
    } else {
        Some(here)
    };
    Some(Plan {
        show,
        presenter,
        moved: show != here,
    })
}

/// What to do to the main window when the show ends: nothing if it was never moved, else put it back where it was.
pub fn restore_after(plan: &Plan, before: Rect, maximized: bool) -> Option<Restore> {
    plan.moved.then_some(Restore {
        rect: before,
        maximized,
    })
}

/// The labels the menu shows: the display's name, or "Display N" when it has none; two with the same name are told apart by a number.
pub fn labels(names: &[Option<String>]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(names.len());
    for (i, name) in names.iter().enumerate() {
        let base = name
            .as_deref()
            .filter(|n| !n.trim().is_empty())
            .map_or_else(|| format!("Display {}", i + 1), |n| n.trim().to_string());
        let mut label = base.clone();
        let mut n = 2;
        while out.contains(&label) {
            label = format!("{base} ({n})");
            n += 1;
        }
        out.push(label);
    }
    out
}

/// Where a window of `size` goes to sit in the middle of `area` (at its corner when it is larger).
fn middle(area: Rect, size: (u32, u32)) -> (i32, i32) {
    (
        area.x + (area.w.saturating_sub(size.0) / 2) as i32,
        area.y + (area.h.saturating_sub(size.1) / 2) as i32,
    )
}

/// What is true while a show has moved the window.
struct Active {
    presenter_area: Option<Rect>,
    restore: Option<Restore>,
    /// Where the main window came from, kept even when the show started on its own display: a later move of the show needs it.
    origin: Restore,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

fn active() -> std::sync::MutexGuard<'static, Option<Active>> {
    ACTIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The display the presenter's window goes on while a show has chosen one; none otherwise.
pub fn presenter_area() -> Option<Rect> {
    active().as_ref().and_then(|a| a.presenter_area)
}

/// The show was moved to another display while it ran (`presenter_move`): the presenter's window goes on `presenter_area`, and the main
/// window is put back where it came from when the show ends. False when no show holds the window.
pub(crate) fn note_moved(presenter_area: Option<Rect>) -> bool {
    let mut slot = active();
    let Some(held) = slot.as_mut() else {
        return false;
    };
    held.presenter_area = presenter_area;
    held.restore = Some(held.origin);
    true
}

/// Where the main window came from, while a show holds it.
pub(crate) fn origin() -> Option<Restore> {
    active().as_ref().map(|a| a.origin)
}

pub(crate) fn outer_rect(window: &WebviewWindow) -> Option<Rect> {
    let at = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Rect {
        x: at.x,
        y: at.y,
        w: size.width,
        h: size.height,
    })
}

pub(crate) fn displays_of(app: &AppHandle) -> Vec<Display> {
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let names: Vec<Option<String>> = monitors.iter().map(|m| m.name().cloned()).collect();
    monitors
        .iter()
        .zip(labels(&names))
        .map(|(m, label)| Display {
            label,
            area: Rect {
                x: m.position().x,
                y: m.position().y,
                w: m.size().width,
                h: m.size().height,
            },
            primary: primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size()),
        })
        .collect()
}

/// The labels of the displays attached now, for the "Present on" menu.
#[tauri::command]
pub fn present_displays(app: AppHandle) -> Vec<String> {
    displays_of(&app).into_iter().map(|d| d.label).collect()
}

/// A show is about to fill the screen: moves the main window to the display `choice` names (see `Choice::parse`), and notes where the
/// presenter's window goes and how to put things back. With one display it does nothing.
#[tauri::command]
pub fn present_enter(app: AppHandle, choice: String) -> Result<(), String> {
    let mut slot = active();
    // A show that is already holding the window keeps what it noted: where the window came from is what counts.
    if slot.is_some() {
        return Ok(());
    }
    let window = app
        .get_webview_window(MAIN)
        .ok_or("The main window is not open")?;
    let displays = displays_of(&app);
    let before = outer_rect(&window).ok_or("The window has no place to be read")?;
    let maximized = window.is_maximized().unwrap_or(false);
    let Some(plan) = choose(&displays, before, &Choice::parse(&choice)) else {
        return Ok(());
    };
    if plan.moved {
        let area = displays[plan.show].area;
        // A maximised window does not move; it is maximised again where it came from.
        if maximized {
            let _ = window.unmaximize();
        }
        let size = (before.w.min(area.w), before.h.min(area.h));
        let (x, y) = middle(area, size);
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|err| err.to_string())?;
    }
    *slot = Some(Active {
        presenter_area: plan.presenter.map(|i| displays[i].area),
        restore: restore_after(&plan, before, maximized),
        origin: Restore {
            rect: before,
            maximized,
        },
    });
    Ok(())
}

/// The show ended: the window leaves full screen and goes back to the display and place it came from.
#[tauri::command]
pub fn present_leave(app: AppHandle) {
    let noted = active().take();
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let _ = window.set_fullscreen(false);
    // A display that was unplugged during the show cannot take the window back: it comes to the main display instead.
    let restore = noted
        .and_then(|a| a.restore)
        .map(|r| crate::presenter_move::visible_restore(&displays_of(&app), r));
    if let Some(Restore { rect, maximized }) = restore {
        let _ = window.set_size(PhysicalSize::new(rect.w, rect.h));
        let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
        if maximized {
            let _ = window.maximize();
        }
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
    fn the_presenter_screen_choice_parses_what_the_app_keeps() {
        assert_eq!(Choice::parse("auto"), Choice::Automatic);
        assert_eq!(Choice::parse("here"), Choice::ThisScreen);
        assert_eq!(
            Choice::parse("name:DELL U2720Q"),
            Choice::Named("DELL U2720Q".into())
        );
        assert_eq!(Choice::parse("name:"), Choice::Automatic);
        assert_eq!(Choice::parse("everywhere"), Choice::Automatic);
    }

    #[test]
    fn automatic_puts_the_show_on_the_external_display_and_the_presenter_on_the_original_one() {
        let plan = choose(&[laptop(), projector()], ON_LAPTOP, &Choice::Automatic).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 1,
                presenter: Some(0),
                moved: true
            }
        );
        // The list may come in either order.
        let plan = choose(&[projector(), laptop()], ON_LAPTOP, &Choice::Automatic).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: Some(1),
                moved: true
            }
        );
    }

    #[test]
    fn automatic_leaves_a_window_that_is_on_the_external_display_there() {
        let plan = choose(&[laptop(), projector()], ON_PROJECTOR, &Choice::Automatic).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 1,
                presenter: Some(0),
                moved: false
            }
        );
    }

    #[test]
    fn automatic_takes_the_first_external_display_of_three() {
        let third = display("Second projector", r(3360, 0, 1920, 1080), false);
        let plan = choose(
            &[laptop(), projector(), third],
            ON_LAPTOP,
            &Choice::Automatic,
        )
        .unwrap();
        assert_eq!(plan.show, 1);
        assert_eq!(plan.presenter, Some(0));
    }

    #[test]
    fn this_screen_keeps_the_show_where_the_window_is_and_gives_the_presenter_another() {
        let plan = choose(&[laptop(), projector()], ON_LAPTOP, &Choice::ThisScreen).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: Some(1),
                moved: false
            }
        );
        // On the external display, the presenter goes to the primary one.
        let plan = choose(&[laptop(), projector()], ON_PROJECTOR, &Choice::ThisScreen).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 1,
                presenter: Some(0),
                moved: false
            }
        );
    }

    #[test]
    fn a_display_by_name_is_where_the_show_goes_and_the_presenter_goes_where_the_window_was() {
        let displays = [laptop(), projector()];
        let named = Choice::Named("Projector".into());
        let plan = choose(&displays, ON_LAPTOP, &named).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 1,
                presenter: Some(0),
                moved: true
            }
        );
        let on_built_in = Choice::Named("Built-in".into());
        let plan = choose(&displays, ON_PROJECTOR, &on_built_in).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: Some(1),
                moved: true
            }
        );
        // The window is already on the one named: it stays, and the other display is the presenter's.
        let plan = choose(&displays, ON_PROJECTOR, &named).unwrap();
        assert!(!plan.moved);
        assert_eq!(plan.presenter, Some(0));
    }

    #[test]
    fn a_display_that_is_gone_is_as_if_nothing_was_chosen() {
        let gone = Choice::Named("Hotel TV".into());
        let plan = choose(&[laptop(), projector()], ON_LAPTOP, &gone).unwrap();
        assert_eq!(plan.show, 1);
        assert!(plan.moved);
        // And with one display left, the show stays and the presenter's window has no display of its own.
        let plan = choose(&[laptop()], ON_LAPTOP, &gone).unwrap();
        assert_eq!(
            plan,
            Plan {
                show: 0,
                presenter: None,
                moved: false
            }
        );
    }

    #[test]
    fn one_display_or_none_has_nothing_to_move() {
        for choice in [Choice::Automatic, Choice::ThisScreen] {
            let plan = choose(&[laptop()], ON_LAPTOP, &choice).unwrap();
            assert!(!plan.moved);
            assert_eq!(plan.presenter, None);
        }
        assert_eq!(choose(&[], ON_LAPTOP, &Choice::Automatic), None);
    }

    #[test]
    fn a_window_on_a_display_to_the_left_with_a_negative_origin_is_found() {
        let left = display("Left", r(-1920, 0, 1920, 1080), false);
        let window = r(-1800, 100, 1200, 700);
        assert_eq!(display_of(&[laptop(), left.clone()], window), 1);
        // Off every display (just unplugged): the first.
        assert_eq!(display_of(&[laptop(), left], r(9000, 9000, 100, 100)), 0);
    }

    #[test]
    fn what_was_moved_is_put_back_after_the_show_and_what_was_not_is_left() {
        let moved = choose(&[laptop(), projector()], ON_LAPTOP, &Choice::Automatic).unwrap();
        assert_eq!(
            restore_after(&moved, ON_LAPTOP, false),
            Some(Restore {
                rect: ON_LAPTOP,
                maximized: false
            })
        );
        // A window that was maximised is maximised again where it came from.
        assert_eq!(
            restore_after(&moved, ON_LAPTOP, true),
            Some(Restore {
                rect: ON_LAPTOP,
                maximized: true
            })
        );
        let stayed = choose(&[laptop(), projector()], ON_LAPTOP, &Choice::ThisScreen).unwrap();
        assert_eq!(restore_after(&stayed, ON_LAPTOP, false), None);
    }

    #[test]
    fn displays_are_labelled_by_name_and_told_apart() {
        let names = [Some("Built-in".to_string()), None, Some("  ".to_string())];
        assert_eq!(labels(&names), ["Built-in", "Display 2", "Display 3"]);
        let same = [Some("DELL".to_string()), Some("DELL".to_string())];
        assert_eq!(labels(&same), ["DELL", "DELL (2)"]);
    }

    #[test]
    fn a_window_sits_in_the_middle_of_the_display_it_is_moved_to() {
        assert_eq!(middle(r(1440, 0, 1920, 1080), (1200, 700)), (1800, 190));
        assert_eq!(middle(r(-1920, 0, 1920, 1080), (1200, 700)), (-1560, 190));
        assert_eq!(middle(r(0, 0, 800, 600), (1200, 700)), (0, 0));
    }
}
