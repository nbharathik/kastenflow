use super::*;

use std::fs;

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Scratch {
        let dir = std::env::temp_dir().join(format!(
            "kasten-rehearsals-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        ));
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(n: u64) -> Run {
    Run {
        at: Value::from(1_790_000_000_000 + n),
        total_ms: 60_000 + n,
        slides: vec![
            SlideTime {
                id: "s1".to_owned(),
                ms: 20_000,
            },
            SlideTime {
                id: "s2".to_owned(),
                ms: 40_000 + n,
            },
        ],
        target_ms: None,
    }
}

const VAULT: &str = "C:/Users/me/Documents/My notes";

#[test]
fn a_deck_with_no_runs_has_an_empty_list() {
    let scratch = Scratch::new();
    assert!(read(&scratch.0, Path::new(VAULT), "talk").is_empty());
}

#[test]
fn runs_are_kept_oldest_first_in_a_file_under_the_vaults_folder() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    add(&scratch.0, vault, "talk", run(1)).unwrap();
    let runs = add(&scratch.0, vault, "talk", run(2)).unwrap();
    assert_eq!(runs, [run(1), run(2)]);
    assert_eq!(read(&scratch.0, vault, "talk"), runs);

    let file = file(&scratch.0, vault, "talk");
    assert_eq!(file.file_name().unwrap(), "talk.json");
    let hash = file
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert_eq!(hash.len(), 16);
    assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(
        file.parent().unwrap().parent().unwrap(),
        scratch.0.join("rehearsals")
    );
    let text = fs::read_to_string(&file).unwrap();
    assert!(
        text.contains("\"totalMs\"") && text.contains("\"slides\"") && !text.contains("targetMs"),
        "{text}"
    );
}

#[test]
fn a_target_is_kept_when_there_is_one() {
    let scratch = Scratch::new();
    let mut with = run(3);
    with.target_ms = Some(300_000);
    let runs = add(&scratch.0, Path::new(VAULT), "talk", with.clone()).unwrap();
    assert_eq!(runs, [with]);
    assert!(
        fs::read_to_string(file(&scratch.0, Path::new(VAULT), "talk"))
            .unwrap()
            .contains("\"targetMs\": 300000")
    );
}

#[test]
fn only_the_last_fifty_runs_are_kept() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    for n in 0..60 {
        add(&scratch.0, vault, "talk", run(n)).unwrap();
    }
    let runs = read(&scratch.0, vault, "talk");
    assert_eq!(runs.len(), KEPT);
    assert_eq!(runs.first(), Some(&run(10)));
    assert_eq!(runs.last(), Some(&run(59)));
}

#[test]
fn each_vault_and_each_deck_has_a_list_of_its_own() {
    let scratch = Scratch::new();
    add(&scratch.0, Path::new(VAULT), "talk", run(1)).unwrap();
    add(&scratch.0, Path::new(VAULT), "other", run(2)).unwrap();
    add(&scratch.0, Path::new("D:/elsewhere"), "talk", run(3)).unwrap();
    assert_eq!(read(&scratch.0, Path::new(VAULT), "talk"), [run(1)]);
    assert_eq!(read(&scratch.0, Path::new(VAULT), "other"), [run(2)]);
    assert_eq!(
        read(&scratch.0, Path::new("D:/elsewhere"), "talk"),
        [run(3)]
    );
    assert_ne!(
        folder(&scratch.0, Path::new(VAULT)),
        folder(&scratch.0, Path::new("D:/elsewhere"))
    );
}

#[test]
fn clearing_writes_an_empty_list_and_keeps_the_file() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    add(&scratch.0, vault, "talk", run(1)).unwrap();
    clear(&scratch.0, vault, "talk").unwrap();
    let path = file(&scratch.0, vault, "talk");
    assert!(path.is_file(), "the file is still there");
    assert_eq!(fs::read_to_string(&path).unwrap().trim(), "[]");
    assert!(read(&scratch.0, vault, "talk").is_empty());
    // And a deck that never had one can be cleared.
    clear(&scratch.0, vault, "never").unwrap();
    // Runs start again after clearing.
    assert_eq!(add(&scratch.0, vault, "talk", run(2)).unwrap(), [run(2)]);
}

#[test]
fn an_id_that_is_not_a_plain_name_cannot_leave_the_folder() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    for id in [
        "../escape",
        "a/b",
        "..",
        ".hidden",
        "with space",
        "x\\y",
        "ünï",
        "C:evil",
    ] {
        add(&scratch.0, vault, id, run(1)).unwrap();
        let path = file(&scratch.0, vault, id);
        assert_eq!(path.parent().unwrap(), folder(&scratch.0, vault), "{id}");
        assert!(
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("h-"),
            "{id}"
        );
        assert_eq!(read(&scratch.0, vault, id), [run(1)], "{id}");
    }
    assert!(!scratch.0.join("escape.json").exists());
}

#[test]
fn a_file_that_cannot_be_read_is_an_empty_list_that_the_next_run_replaces() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    add(&scratch.0, vault, "talk", run(1)).unwrap();
    fs::write(file(&scratch.0, vault, "talk"), "{ not a list").unwrap();
    assert!(read(&scratch.0, vault, "talk").is_empty());
    assert_eq!(add(&scratch.0, vault, "talk", run(2)).unwrap(), [run(2)]);
}

#[test]
fn a_record_that_makes_no_sense_is_refused_and_nothing_is_written() {
    let scratch = Scratch::new();
    let vault = Path::new(VAULT);
    let mut bad = Vec::new();
    let mut no_time = run(1);
    no_time.at = Value::Null;
    bad.push(no_time);
    let mut long = run(1);
    long.total_ms = MOST_MS + 1;
    bad.push(long);
    let mut no_id = run(1);
    no_id.slides[0].id.clear();
    bad.push(no_id);
    let mut slow = run(1);
    slow.slides[0].ms = MOST_MS + 1;
    bad.push(slow);
    let mut many = run(1);
    many.slides = (0..=MOST_SLIDES)
        .map(|n| SlideTime {
            id: format!("s{n}"),
            ms: 1,
        })
        .collect();
    bad.push(many);
    for record in bad {
        assert!(add(&scratch.0, vault, "talk", record).is_err());
    }
    assert!(add(&scratch.0, vault, "", run(1)).is_err());
    assert!(!folder(&scratch.0, vault).exists());
}

#[test]
fn the_window_can_send_the_time_as_text_or_a_number() {
    let from_window =
        r#"{"at": "2026-10-11T09:00:00Z", "totalMs": 1000, "slides": [{"id": "s1", "ms": 1000}]}"#;
    let record: Run = serde_json::from_str(from_window).unwrap();
    assert_eq!(record.at, Value::from("2026-10-11T09:00:00Z"));
    assert_eq!(record.target_ms, None);
    let scratch = Scratch::new();
    assert_eq!(
        add(&scratch.0, Path::new(VAULT), "talk", record.clone()).unwrap(),
        [record]
    );
}
