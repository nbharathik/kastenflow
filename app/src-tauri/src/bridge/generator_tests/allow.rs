//! A person's "Allow to run" is for the code they saw, in the deck they saw it for: changed code asks
//! again, and code in no deck is asked about every time.

use std::path::{Path, PathBuf};

use super::*;
use crate::smart::settings;

fn scratch(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "kasten-allow-{label}-{}",
        kasten_core::ulid_at(Instant::now().millis)
    ))
}

fn agent_window(dir: &Path, permission: Result<String, Failed>, code: &str) -> Window {
    let mut side = window(false, permission, Ok(svg_answer()));
    side.store = Some(dir.to_path_buf());
    side.payload = Some(
        serde_json::to_vec(&json!({ "language": "js", "code": code, "inputs": [], "theme": {} }))
            .unwrap(),
    );
    side
}

#[test]
fn an_allow_holds_for_the_code_the_person_saw_and_changed_code_asks_again() {
    let dir = scratch("changed");
    let seen = "return kit.svg(200, 100, '');";
    settings::set_generator_allowed(&dir, "library/talk.deck", &settings::code_hash(seen)).unwrap();
    let call = call(GeneratorOutput::Svg);

    // The very code they allowed runs without a question.
    let same = agent_window(&dir, Err(silent("never asked")), seen);
    handle(&same, &by_an_agent(&call), &call).unwrap();
    let asked = same.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].0, RUN_EVENT);
    drop(asked);

    // Code changed under the same deck is asked about, with its own hash, and does not run unless allowed.
    let edited = "return kit.svg(200, 100, '<text/>');";
    let changed = agent_window(&dir, Ok("deny".to_owned()), edited);
    let why = handle(&changed, &by_an_agent(&call), &call).unwrap_err();
    assert!(why.contains("did not allow"), "{why}");
    let asked = changed.asked.lock().unwrap();
    assert_eq!(asked.len(), 1, "it was never run");
    assert_eq!(asked[0].0, ASK_EVENT);
    assert_eq!(asked[0].1["hash"], json!(settings::code_hash(edited)));
    assert_eq!(asked[0].1["deck"], "library/talk.deck");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn code_in_no_deck_is_asked_about_every_time() {
    let dir = scratch("nodeck");
    let code = "return kit.svg(200, 100, '');";
    // Whatever the window keeps for "always", nothing is kept for no deck.
    let _ = settings::set_generator_allowed(&dir, "", &settings::code_hash(code));
    let call = Call::RunGenerator {
        deck: None,
        output: GeneratorOutput::Svg,
        timeout_ms: 8_000,
    };
    for _ in 0..2 {
        let side = agent_window(&dir, Ok("deny".to_owned()), code);
        assert!(handle(&side, &by_an_agent(&call), &call).is_err());
        let asked = side.asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].0, ASK_EVENT);
        assert_eq!(asked[0].1["deck"], "");
        assert_eq!(asked[0].1["hash"], json!(settings::code_hash(code)));
    }
    let _ = std::fs::remove_dir_all(dir);
}
