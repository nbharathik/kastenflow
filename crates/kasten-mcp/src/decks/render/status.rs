//! Whether slides can be drawn here, for `server_status` and `--check`: told
//! from what is on the machine, without starting a browser.

use serde_json::{Value, json};

use super::NOT_BUILT;

/// What is said of drawing slides, and what is wrong with it.
pub struct Report {
    /// The `render` part of the status.
    pub value: Value,
    /// Sentences for what keeps a drawing from working in a program built to draw.
    pub problems: Vec<String>,
}

/// Where the browser the program would start stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "render"), allow(dead_code))]
pub(crate) enum Sandbox {
    On,
    /// The person switched it off (`SLIDES_RENDER_NO_SANDBOX=1`).
    Off,
    /// As the administrator, the browser cannot use it, and it is not dropped for the person.
    Refused,
}

impl Sandbox {
    fn word(self) -> &'static str {
        match self {
            Sandbox::On => "on",
            Sandbox::Off => "off",
            Sandbox::Refused => "refused",
        }
    }
}

#[cfg_attr(not(feature = "render"), allow(dead_code))]
const REFUSED: &str = "The browser will not run its sandbox as the administrator (root), and KastenFlow does not switch the sandbox off for you. Run as an ordinary user; where the machine is itself the boundary you trust, set SLIDES_RENDER_NO_SANDBOX=1.";

/// The report for a program built to draw, from what was found: the
/// browser's program or the sentence for why there is none, whether the page
/// is built in, and the sandbox.
#[cfg_attr(not(feature = "render"), allow(dead_code))]
pub(crate) fn built_report(
    browser: Result<String, String>,
    page: bool,
    sandbox: Sandbox,
) -> Report {
    let mut problems = Vec::new();
    let (path, browser_problem) = match browser {
        Ok(path) => (Some(path), None),
        Err(why) => {
            problems.push(why.clone());
            (None, Some(why))
        }
    };
    if !page {
        problems.push("This program does not carry the page it draws slides with, so it cannot draw them. Use a build that has it, or set SLIDES_RENDER_PAGE to the folder it was built into.".to_owned());
    }
    if sandbox == Sandbox::Refused {
        problems.push(REFUSED.to_owned());
    }
    let ready = problems.is_empty();
    let message = if ready {
        "Slides can be drawn here.".to_owned()
    } else {
        format!("Slides cannot be drawn here. {}", problems.join(" "))
    };
    Report {
        value: json!({
            "built": true,
            "ready": ready,
            "browser": path,
            "browser_problem": browser_problem,
            "page": page,
            "sandbox": sandbox.word(),
            "message": message,
        }),
        problems,
    }
}

/// The report for a program that cannot draw: it was made so, which is not a problem.
#[cfg_attr(feature = "render", allow(dead_code))]
pub(crate) fn unbuilt_report() -> Report {
    Report {
        value: json!({ "built": false, "ready": false, "message": NOT_BUILT }),
        problems: Vec::new(),
    }
}

/// The report for this program on this machine now.
pub fn report() -> Report {
    #[cfg(feature = "render")]
    {
        use std::ffi::OsStr;

        let browser = if super::browser_pretended_missing() {
            Err(slides_render::Error::NoBrowser { notes: Vec::new() })
        } else {
            slides_render::find_browser()
        }
        .map(|path| path.display().to_string())
        .map_err(|why| why.to_string());
        let page = slides_render::bundle::Page::locate().is_some();
        let sandbox =
            if std::env::var_os("SLIDES_RENDER_NO_SANDBOX").as_deref() == Some(OsStr::new("1")) {
                Sandbox::Off
            } else if slides_render::private::running_as_root() {
                Sandbox::Refused
            } else {
                Sandbox::On
            };
        built_report(browser, page, sandbox)
    }
    #[cfg(not(feature = "render"))]
    {
        unbuilt_report()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_with_a_browser_and_its_page_says_it_can_draw() {
        let r = built_report(Ok("/usr/bin/chromium".to_owned()), true, Sandbox::On);
        assert!(r.problems.is_empty());
        assert_eq!(r.value["built"], json!(true));
        assert_eq!(r.value["ready"], json!(true));
        assert_eq!(r.value["browser"], json!("/usr/bin/chromium"));
        assert_eq!(r.value["browser_problem"], Value::Null);
        assert_eq!(r.value["page"], json!(true));
        assert_eq!(r.value["sandbox"], json!("on"));
        assert_eq!(r.value["message"], json!("Slides can be drawn here."));
    }

    #[test]
    fn each_thing_that_keeps_a_drawing_from_working_is_a_problem_in_its_own_words() {
        let none = built_report(Err("none was found".to_owned()), true, Sandbox::On);
        assert_eq!(none.problems, ["none was found"]);
        assert_eq!(none.value["ready"], json!(false));
        assert_eq!(none.value["browser"], Value::Null);
        assert_eq!(none.value["browser_problem"], json!("none was found"));

        let no_page = built_report(Ok("b".to_owned()), false, Sandbox::On);
        assert_eq!(no_page.problems.len(), 1);
        assert!(no_page.problems[0].contains("page it draws slides with"));
        assert_eq!(no_page.value["page"], json!(false));

        let root = built_report(Ok("b".to_owned()), true, Sandbox::Refused);
        assert!(
            root.problems[0].contains("administrator"),
            "{:?}",
            root.problems
        );
        assert_eq!(root.value["sandbox"], json!("refused"));

        // Switched off on purpose is the person's to say; it is shown, not a problem.
        let off = built_report(Ok("b".to_owned()), true, Sandbox::Off);
        assert!(off.problems.is_empty());
        assert_eq!(off.value["sandbox"], json!("off"));

        let all = built_report(Err("no".to_owned()), false, Sandbox::Refused);
        assert_eq!(all.problems.len(), 3);
        assert!(
            all.value["message"]
                .as_str()
                .unwrap()
                .starts_with("Slides cannot be drawn here. no ")
        );
    }

    #[test]
    fn a_program_made_without_drawing_says_so_and_it_is_not_a_problem() {
        let r = unbuilt_report();
        assert!(r.problems.is_empty());
        assert_eq!(r.value["built"], json!(false));
        assert_eq!(r.value["ready"], json!(false));
        assert_eq!(r.value["message"], json!(NOT_BUILT));
    }

    #[test]
    fn the_report_of_this_program_follows_how_it_was_built() {
        let r = report();
        assert_eq!(r.value["built"], json!(super::super::built()));
        #[cfg(feature = "render")]
        {
            crate::decks::render::pretend_no_browser(true);
            let missing = report();
            crate::decks::render::pretend_no_browser(false);
            assert_eq!(missing.value["browser"], Value::Null);
            assert!(
                missing.value["browser_problem"]
                    .as_str()
                    .unwrap()
                    .contains("none was found"),
                "{}",
                missing.value
            );
            assert!(!missing.problems.is_empty());
        }
    }
}
