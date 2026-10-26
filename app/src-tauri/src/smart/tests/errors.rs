//! The error log: the last 50 errors per page, in the cache.

use std::fs;

use kasten_core::Instant;
use kasten_core::smart::{ErrorKind, ErrorReport, MAX_ERROR_RECORDS};

use super::smart;
use crate::smart::errors::{append, clear, flush, log_path, read};

fn report(message: &str) -> ErrorReport {
    ErrorReport {
        kind: ErrorKind::Error,
        message: message.to_owned(),
        source: Some("app.js".to_owned()),
        line: Some(7),
    }
}

#[test]
fn keeps_what_was_reported_in_the_pages_cache_file() {
    let s = smart();
    let root = s.vault.dir.clone();
    assert!(read(&root, &s.id).records.is_empty());
    let log = append(&root, &s.id, &report("boom"), Instant::now()).unwrap();
    assert_eq!(log.records.len(), 1);
    assert_eq!(log.records[0].message, "boom");
    assert_eq!(log.records[0].line, Some(7));
    assert!(log.records[0].time.starts_with("20"));
    let file = root
        .join(".kasten/cache/smart")
        .join(format!("{}.log.json", s.id));
    assert_eq!(log_path(&root, &s.id).unwrap(), file);
    let text = fs::read_to_string(&file).unwrap();
    assert!(
        text.contains("\"boom\"") && text.contains("\"kind\": \"error\""),
        "{text}"
    );
    assert_eq!(read(&root, &s.id), log);
}

#[test]
fn a_page_that_reports_in_a_loop_rewrites_its_file_once_and_loses_nothing() {
    let s = smart();
    let root = s.vault.dir.clone();
    let file = log_path(&root, &s.id).unwrap();
    for n in 0..30 {
        append(&root, &s.id, &report(&format!("e{n}")), Instant::now()).unwrap();
    }
    // The first report was written at once; the rest wait in memory, and are read from there.
    let on_disk = fs::read_to_string(&file).unwrap();
    assert!(
        on_disk.contains("\"e0\"") && !on_disk.contains("\"e29\""),
        "{on_disk}"
    );
    let log = read(&root, &s.id);
    assert_eq!(log.records.len(), 30);
    assert_eq!(log.records[29].message, "e29");
    // A second after the last write they are written together.
    flush(&root, &s.id);
    let after: kasten_core::smart::ErrorLog =
        serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(after, log);
    // Clearing drops what was held too.
    for n in 0..5 {
        append(&root, &s.id, &report(&format!("again {n}")), Instant::now()).unwrap();
    }
    clear(&root, &s.id).unwrap();
    assert!(read(&root, &s.id).records.is_empty());
    flush(&root, &s.id);
    assert!(read(&root, &s.id).records.is_empty());
}

#[test]
fn only_the_last_fifty_stay() {
    let s = smart();
    let root = s.vault.dir.clone();
    for n in 0..(MAX_ERROR_RECORDS + 13) {
        append(&root, &s.id, &report(&format!("error {n}")), Instant::now()).unwrap();
    }
    let log = read(&root, &s.id);
    assert_eq!(log.records.len(), MAX_ERROR_RECORDS);
    assert_eq!(log.records[0].message, "error 13");
    assert_eq!(
        log.records.last().unwrap().message,
        format!("error {}", MAX_ERROR_RECORDS + 12)
    );
}

#[test]
fn a_page_cannot_fill_the_log_with_text_or_leave_its_file() {
    let s = smart();
    let root = s.vault.dir.clone();
    let huge = report(&"x".repeat(100_000));
    let log = append(&root, &s.id, &huge, Instant::now()).unwrap();
    assert!(log.records[0].message.chars().count() <= 2_001);
    let long_source = ErrorReport {
        source: Some("s".repeat(5_000)),
        ..report("m")
    };
    let log = append(&root, &s.id, &long_source, Instant::now()).unwrap();
    assert!(log.records[1].source.as_ref().unwrap().chars().count() <= 301);
    // An id that is not one gets no file at all.
    let long = "a".repeat(100);
    for id in [
        "",
        "../x",
        "a/b",
        "a\\b",
        "kit",
        "x.y",
        "..",
        ".",
        "a b",
        "a:b",
        "a\0b",
        "a\nb",
        "é",
        // Names Windows keeps for devices.
        "con",
        "NUL",
        "Aux",
        "prn",
        "com1",
        "LPT9",
        long.as_str(),
    ] {
        assert!(log_path(&root, id).is_none(), "{id}");
        assert!(
            append(&root, id, &report("m"), Instant::now()).is_err(),
            "{id}"
        );
        assert!(read(&root, id).records.is_empty());
    }
    assert!(!root.join("x.log.json").exists());
}

#[test]
fn what_a_page_reports_stays_text_in_its_own_pages_log_and_cannot_forge_a_record_or_reach_another_log()
 {
    let s = smart();
    let root = s.vault.dir.clone();
    let (_, other) = super::add_page(s.k(), "Other", &super::files());
    append(&root, &other, &report("other's own"), Instant::now()).unwrap();
    let before = fs::read_to_string(log_path(&root, &other).unwrap()).unwrap();
    // JSON, markup and a fake record inside the text of one report.
    let forged = r#"x"},{"time":"2026-01-01T00:00:00Z","kind":"error","message":"forged"}]}"#;
    for message in [
        forged,
        "line one\nline two\r\n\u{0}\u{1b}[31m",
        "<img src=x onerror=alert(1)>",
        "\u{202e}rtl",
    ] {
        let log = append(
            &root,
            &s.id,
            &ErrorReport {
                kind: ErrorKind::ConsoleError,
                message: message.to_owned(),
                source: Some(forged.to_owned()),
                line: Some(u32::MAX),
            },
            Instant::now(),
        )
        .unwrap();
        // Each report is one record, however it is spelled; the file reads back as the same.
        assert_eq!(read(&root, &s.id), log);
    }
    let log = read(&root, &s.id);
    assert_eq!(log.records.len(), 4);
    assert!(log.records.iter().all(|r| r.message != "forged"));
    assert_eq!(log.records[0].message, forged);
    // The other page's log is not touched, and the files are the two logs and nothing else.
    assert_eq!(
        fs::read_to_string(log_path(&root, &other).unwrap()).unwrap(),
        before
    );
    let mut names: Vec<String> = fs::read_dir(root.join(".kasten/cache/smart"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut expected = vec![format!("{}.log.json", s.id), format!("{other}.log.json")];
    expected.sort();
    assert_eq!(names, expected);
}

#[test]
fn a_frames_secret_in_an_address_an_error_names_is_not_kept() {
    let s = smart();
    let root = s.vault.dir.clone();
    let address = format!("smart://localhost/{}/{}/app.js", s.frame, s.id);
    let log = append(
        &root,
        &s.id,
        &ErrorReport {
            kind: ErrorKind::Error,
            message: format!("Failed to load {address}: {} twice", s.frame),
            source: Some(address.clone()),
            line: Some(3),
        },
        Instant::now(),
    )
    .unwrap();
    let record = &log.records[0];
    assert!(!record.message.contains(&s.frame), "{}", record.message);
    assert!(!record.source.as_deref().unwrap().contains(&s.frame));
    assert!(
        !fs::read_to_string(log_path(&root, &s.id).unwrap())
            .unwrap()
            .contains(&s.frame)
    );
    // The page's id and file stay, so the error still says where it was.
    assert!(
        record
            .source
            .as_deref()
            .unwrap()
            .ends_with(&format!("/{}/app.js", s.id))
    );
    // Short runs of hex digits (a number, a word) are not touched.
    let plain = append(
        &root,
        &s.id,
        &report("deadbeef is 0x1F and cafe"),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(plain.records[1].message, "deadbeef is 0x1F and cafe");
}

#[test]
fn a_log_that_does_not_read_is_an_empty_one_and_a_long_one_is_cut() {
    let s = smart();
    let root = s.vault.dir.clone();
    let file = log_path(&root, &s.id).unwrap();
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "not json {").unwrap();
    assert!(read(&root, &s.id).records.is_empty());
    let record = r#"{"time":"2026-10-23T10:00:00Z","kind":"error","message":"m"}"#;
    let many = vec![record; 80].join(",");
    fs::write(&file, format!("{{\"records\":[{many}]}}")).unwrap();
    assert_eq!(read(&root, &s.id).records.len(), MAX_ERROR_RECORDS);
    // The next one is written over the cut log.
    assert_eq!(
        append(&root, &s.id, &report("new"), Instant::now())
            .unwrap()
            .records
            .len(),
        MAX_ERROR_RECORDS
    );
}

#[test]
fn clearing_empties_the_log() {
    let s = smart();
    let root = s.vault.dir.clone();
    append(&root, &s.id, &report("boom"), Instant::now()).unwrap();
    clear(&root, &s.id).unwrap();
    assert!(read(&root, &s.id).records.is_empty());
    clear(&root, "../nope").unwrap();
}

#[test]
fn the_log_is_a_cache_the_vaults_history_does_not_hold() {
    let s = smart();
    let before = s.k().log(None, 1).unwrap()[0].id.clone();
    append(&s.vault.dir, &s.id, &report("boom"), Instant::now()).unwrap();
    s.k().commit_edits().unwrap();
    assert_eq!(s.k().log(None, 1).unwrap()[0].id, before);
}
