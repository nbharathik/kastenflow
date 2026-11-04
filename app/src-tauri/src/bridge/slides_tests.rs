//! The app's side of slide drawing: what the window is asked, and what is
//! believed of its answer. The window is a stand-in that records the job and
//! answers with what a test gives it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use kasten_core::Kasten;
use kasten_core::bridge::{Call, Decks, Request};
use kasten_core::latex::LatexDoc;
use serde_json::{Value, json};

use super::side::Side;
use super::slides::handle;
use super::window::Failed;
use crate::plugins::latex::service::Outcome;

struct Window {
    payload: Option<Vec<u8>>,
    answer: Result<String, Failed>,
    jobs: Mutex<Vec<(Value, Duration)>>,
}

impl Side for Window {
    fn kasten(&self) -> Result<Arc<Kasten>, String> {
        Err("no vault".to_owned())
    }
    fn latex_on(&self) -> Result<(), String> {
        Ok(())
    }
    fn diagrams_on(&self) -> Result<(), String> {
        Ok(())
    }
    fn build(&self, _doc: &LatexDoc, _wait: Duration) -> Result<Outcome, String> {
        Err("no engine".to_owned())
    }
    fn draw_png(&self, _svg: &str, _background: &str, _wait: Duration) -> Result<String, Failed> {
        Err(Failed {
            why: "not here".to_owned(),
            answered: false,
        })
    }
    fn payload(&self, _id: &str) -> Result<Vec<u8>, String> {
        self.payload
            .clone()
            .ok_or_else(|| "The deck did not come with the request".to_owned())
    }
    fn ask_slides(&self, job: Value, wait: Duration) -> Result<String, Failed> {
        self.jobs.lock().unwrap().push((job, wait));
        self.answer.clone()
    }
    fn share_selection(&self, _now: u64) -> Result<(), String> {
        Ok(())
    }
    fn selection_published_since(&self, _since: u64) -> bool {
        false
    }
}

/// The first bytes of a PNG `w` by `h` pixels, as base64: its signature and header chunk.
fn png(w: u32, h: u32) -> String {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&w.to_be_bytes());
    bytes.extend_from_slice(&h.to_be_bytes());
    bytes.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
    STANDARD.encode(bytes)
}

fn window(before: Option<&str>, answer: Result<String, Failed>) -> Window {
    let decks = Decks {
        after: "{\"after\":1}".to_owned(),
        before: before.map(str::to_owned),
    };
    Window {
        payload: Some(serde_json::to_vec(&decks).unwrap()),
        answer,
        jobs: Mutex::default(),
    }
}

fn request(call: &Call) -> Request {
    Request::new("a".repeat(32), call, None, 0)
}

fn slide(percent: u32) -> Call {
    Call::SlidePng {
        slide: 2,
        step: Some(1),
        scale_percent: percent,
    }
}

fn silent(why: &str) -> Failed {
    Failed {
        why: why.to_owned(),
        answered: false,
    }
}

#[test]
fn a_slide_is_drawn_by_the_window_from_the_deck_that_came_and_the_picture_is_checked() {
    let side = window(None, Ok(png(1920, 1080)));
    let call = slide(200);
    let result = handle(&side, &request(&call), &call).unwrap();
    assert_eq!(
        (result["width"].as_u64(), result["height"].as_u64()),
        (Some(1920), Some(1080))
    );
    assert_eq!(result["png_base64"], json!(png(1920, 1080)));
    let (job, wait) = side.jobs.lock().unwrap()[0].clone();
    assert_eq!(job["kind"], "slide");
    assert_eq!(
        (job["slide"].as_u64(), job["step"].as_u64()),
        (Some(2), Some(1))
    );
    assert_eq!(job["scale"].as_f64(), Some(2.0));
    assert_eq!(job["after"], "{\"after\":1}");
    assert_eq!(job["before"], Value::Null);
    assert_eq!(job["maxSide"], 4000);
    assert_eq!(job["maxBytes"], 2 * 1024 * 1024);
    assert_eq!(wait, Duration::from_secs(45));
}

#[test]
fn the_grid_and_a_comparison_are_asked_for_in_the_windows_own_words() {
    let side = window(Some("{\"before\":1}"), Ok(png(960, 270)));
    let grid = Call::SlideGrid {};
    handle(&side, &request(&grid), &grid).unwrap();
    let diff = Call::SlideDiff {
        before_slide: 1,
        after_slide: 3,
        step: None,
        scale_percent: 100,
        before_marks: vec![[1, 2, 3, 4]],
        after_marks: vec![],
    };
    handle(&side, &request(&diff), &diff).unwrap();
    let jobs = side.jobs.lock().unwrap();
    assert_eq!(jobs[0].0["kind"], "grid");
    let job = &jobs[1].0;
    assert_eq!(job["kind"], "diff");
    assert_eq!(
        (job["slide"].as_u64(), job["beforeSlide"].as_u64()),
        (Some(3), Some(1))
    );
    assert_eq!(job["beforeMarks"], json!([[1, 2, 3, 4]]));
    assert_eq!(job["afterMarks"], json!([]));
    assert_eq!(job["before"], "{\"before\":1}");
}

#[test]
fn a_picture_that_is_not_a_png_or_not_a_sensible_size_is_never_passed_on() {
    let call = slide(100);
    let said = |answer: Result<String, Failed>| {
        let side = window(None, answer);
        handle(&side, &request(&call), &call).unwrap_err()
    };
    assert!(
        said(Ok(
            STANDARD.encode(b"GIF89a, not a png at all, padding padding")
        ))
        .contains("not a PNG")
    );
    assert!(said(Ok("not base64 !!".to_owned())).contains("not a picture"));
    assert!(said(Ok(png(5000, 10))).contains("5000 by 10"));
    assert!(said(Ok(png(0, 10))).contains("0 by 10"));
    let huge = STANDARD.encode(vec![0u8; 3 * 1024 * 1024]);
    assert!(said(Ok(huge)).contains("too big"));
}

#[test]
fn a_window_that_stays_silent_or_says_it_cannot_is_told_to_the_agent_in_its_words() {
    let call = slide(100);
    let side = window(
        None,
        Err(silent(
            "KastenFlow's window did not draw the picture in time",
        )),
    );
    assert!(
        handle(&side, &request(&call), &call)
            .unwrap_err()
            .contains("in time")
    );
    let side = window(
        None,
        Err(Failed {
            why: "There is no slide 9".to_owned(),
            answered: true,
        }),
    );
    assert_eq!(
        handle(&side, &request(&call), &call).unwrap_err(),
        "There is no slide 9"
    );
}

#[test]
fn the_deck_must_have_come_and_be_readable_and_the_scale_in_range() {
    let call = slide(100);
    let mut side = window(None, Ok(png(10, 10)));
    side.payload = None;
    assert!(
        handle(&side, &request(&call), &call)
            .unwrap_err()
            .contains("did not come")
    );
    side.payload = Some(b"not json".to_vec());
    assert!(
        handle(&side, &request(&call), &call)
            .unwrap_err()
            .contains("could not be read")
    );
    let side = window(None, Ok(png(10, 10)));
    let call = slide(900);
    assert!(
        handle(&side, &request(&call), &call)
            .unwrap_err()
            .contains("25 to 400")
    );
    assert!(
        side.jobs.lock().unwrap().is_empty(),
        "nothing was asked of the window"
    );
    // A call that is not about slides is not this handler's.
    let other = Call::WatchSelection {};
    assert!(handle(&side, &request(&other), &other).is_err());
}

#[test]
fn the_sizes_of_the_words_come_back_as_json_of_the_right_shape_or_not_at_all() {
    let call = Call::SlideMeasure {};
    let side = window(
        None,
        Ok("{\"slides\":{\"s-1\":{\"e-1\":{\"textWidth\":1}}}}".to_owned()),
    );
    let result = handle(&side, &request(&call), &call).unwrap();
    assert_eq!(result["measures"]["slides"]["s-1"]["e-1"]["textWidth"], 1);
    assert_eq!(side.jobs.lock().unwrap()[0].0["kind"], "measure");
    assert_eq!(side.jobs.lock().unwrap()[0].1, Duration::from_secs(15));
    for bad in ["nonsense", "[1,2]", "{\"slides\":3}"] {
        let side = window(None, Ok(bad.to_owned()));
        assert!(handle(&side, &request(&call), &call).is_err(), "{bad}");
    }
}
