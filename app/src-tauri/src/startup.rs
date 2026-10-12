//! How long the app takes to start, written as one line per start to
//! `startup.log` beside `crash.log`: when setup began, when the vault was
//! open, when the window showed, and the page's own marks (connected to the
//! vault, sidebar listed), each in milliseconds since the process began.
//! Only timings go in the file, never a path or a note, so it can be sent
//! with a report about a slow start.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::crash;

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: Mutex<Vec<(String, u64)>> = Mutex::new(Vec::new());

/// Starts the clock; the first thing the process does.
pub fn begin() {
    START.get_or_init(Instant::now);
}

fn elapsed() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// Notes that the process reached `name`, once.
pub fn mark(name: &str) {
    let at = elapsed().round() as u64;
    if let Ok(mut marks) = MARKS.lock()
        && !marks.iter().any(|(n, _)| n == name)
    {
        marks.push((name.to_owned(), at));
    }
}

/// The page's marks, in its own clock (`performance.now()`), placed on the
/// process's: the page's `now` is the process's time as the call arrives.
fn placed(process_now: f64, page_now: f64, page: &[(String, f64)]) -> Vec<(String, u64)> {
    let origin = process_now - page_now;
    page.iter()
        .filter(|(_, t)| t.is_finite() && *t >= 0.0)
        .map(|(name, t)| (name.clone(), (origin + t).max(0.0).round() as u64))
        .collect()
}

/// One line: `<time> <version> setup=… vault=… …`, in the order reached.
/// Names are kept to letters, digits, `-` and `:` so a line stays a line.
fn line(stamp: &str, marks: &[(String, u64)]) -> String {
    let mut marks = marks.to_vec();
    marks.sort_by_key(|(_, at)| *at);
    let parts: Vec<String> = marks
        .iter()
        .map(|(name, at)| {
            let name: String = name
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ':'))
                .take(40)
                .collect();
            format!("{name}={at}")
        })
        .collect();
    format!(
        "{stamp} KastenFlow {} {}\n",
        env!("CARGO_PKG_VERSION"),
        parts.join(" ")
    )
}

/// The page sends its start-up marks once it has listed the vault; the line
/// is written then, with the process's own marks.
#[tauri::command]
pub fn startup_marks(now: f64, marks: Vec<(String, f64)>) {
    let mut all = MARKS.lock().map(|m| m.clone()).unwrap_or_default();
    all.extend(placed(elapsed(), now, &marks));
    let Some(path) = crash::log_path().map(|p| p.with_file_name("startup.log")) else {
        return;
    };
    let _ = crash::record(&path, &line(&kasten_core::Instant::now().rfc3339(), &all));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_marks_land_on_the_process_clock() {
        // The page began 300 ms into the process: now is 500 there, 200 here.
        let marks = placed(
            500.0,
            200.0,
            &[
                ("connected".into(), 120.4),
                ("listed".into(), 180.0),
                ("bad".into(), f64::NAN),
            ],
        );
        assert_eq!(
            marks,
            vec![("connected".into(), 420), ("listed".into(), 480)]
        );
    }

    #[test]
    fn a_line_lists_the_marks_in_order_and_nothing_else() {
        let text = line(
            "2026-09-28T10:00:00Z",
            &[
                ("ready".into(), 610),
                ("setup".into(), 85),
                ("page:listed\nx".into(), 590),
            ],
        );
        assert_eq!(
            text,
            format!(
                "2026-09-28T10:00:00Z KastenFlow {} setup=85 page:listedx=590 ready=610\n",
                env!("CARGO_PKG_VERSION")
            )
        );
    }
}
