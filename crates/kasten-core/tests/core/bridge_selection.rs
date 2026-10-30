//! The shared selection: what the app publishes for a client that asked, and
//! what a client reads back. At most five snippets of at most 20 KB, stamped
//! with the app's time (a minute old is out of date), written whole and
//! readable by its owner alone, never in history, backup or the changed files,
//! shared only for two minutes after the last ask and deleted when the app
//! closes. The two new kinds of request (`diagram_png`, `watch_selection`) are
//! checked here too.

use crate::bridge::{echo, mailbox, now, plant};
use crate::common::dev_vault;

use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

use kasten_core::Kasten;
use kasten_core::bridge::{
    Call, MAX_SNIPPET_TEXT, MAX_SNIPPETS, Published, REFRESH_MS, SELECTION_STALE_MS, Seen, Sharing,
    Snippet, Span, Tick, WATCH_MS, serve,
};

fn snippet(kind: &str, path: &str, text: &str) -> Snippet {
    Snippet {
        kind: kind.into(),
        path: path.into(),
        title: "A page".into(),
        heading: None,
        range: None,
        elements: Vec::new(),
        text: text.into(),
        truncated: false,
        time: 0,
    }
}

fn page(text: &str) -> Snippet {
    snippet("page", "library/notes.md", text)
}

fn selection_file(t: &crate::common::TempVault) -> std::path::PathBuf {
    t.vault.root().join(".kasten/cache/bridge/selection.json")
}

#[test]
fn the_new_requests_name_only_a_diagram_inside_the_vault_or_nothing() {
    let png = |diagram: &str, page: Option<&str>| Call::DiagramPng {
        diagram: diagram.into(),
        page: page.map(str::to_owned),
    };
    assert!(png("library/Login flow.drawio", None).check().is_ok());
    assert!(
        png("library/Login flow.drawio", Some("Page-2"))
            .check()
            .is_ok()
    );
    for bad in [
        "../outside.drawio",
        "/etc/passwd",
        "C:\\Users\\me\\x.drawio",
        "library\\x.drawio",
        ".kasten/x.drawio",
        "library/../../x.drawio",
        "",
    ] {
        assert!(png(bad, None).check().is_err(), "{bad:?}");
    }
    assert!(png("a.drawio", Some(&"p".repeat(300))).check().is_err());
    assert!(png("a.drawio", Some("two\nlines")).check().is_err());
    // A request to share the selection names no place at all.
    assert!(Call::WatchSelection {}.check().is_ok());
    assert_eq!(Call::WatchSelection {}.doc(), "");
    // And one with a place the other kinds would not take is not taken.
    assert!(Call::parse("diagram_png", &serde_json::json!({"page": "x"})).is_err());
}

#[test]
fn the_selection_goes_to_the_file_and_comes_back_with_everything_it_says() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    let mut one = page("the words that were selected");
    one.heading = Some("Method".into());
    one.range = Some(Span { from: 10, to: 38 });
    let mut slide = snippet("slide", "library/talk.deck", "");
    slide.elements = vec!["e1".into(), "e2".into()];
    let published = Published::of(&[one.clone(), slide.clone()], &[], now());
    mailbox.write_selection(&published).unwrap();
    let Seen::Selected(read) = mailbox.read_selection(now()) else {
        panic!("a selection was shared");
    };
    assert_eq!(read.snippets.len(), 2);
    assert_eq!(read.snippets[0].kind, "page");
    assert_eq!(read.snippets[0].path, "library/notes.md");
    assert_eq!(read.snippets[0].title, "A page");
    assert_eq!(read.snippets[0].heading.as_deref(), Some("Method"));
    assert_eq!(read.snippets[0].range, Some(Span { from: 10, to: 38 }));
    assert_eq!(read.snippets[0].text, "the words that were selected");
    assert_eq!(read.snippets[0].time, read.time);
    assert_eq!(read.snippets[1].kind, "slide");
    assert_eq!(read.snippets[1].elements, ["e1", "e2"]);
    // The file says it in these words.
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(selection_file(&t)).unwrap()).unwrap();
    assert!(raw["time"].is_u64());
    assert_eq!(raw["snippets"][0]["kind"], "page");
    assert_eq!(raw["snippets"][1]["elements"][1], "e2");
}

#[test]
fn at_most_five_snippets_and_twenty_kilobytes_each_are_kept() {
    let many: Vec<Snippet> = (0..9).map(|i| page(&format!("snippet {i}"))).collect();
    let file = Published::of(&many, &[], 1_000);
    assert_eq!(file.snippets.len(), MAX_SNIPPETS);
    assert_eq!(file.snippets[4].text, "snippet 4");
    // The same words twice are one snippet.
    let twice = Published::of(&[page("same"), page("same")], &[], 1_000);
    assert_eq!(twice.snippets.len(), 1);

    // Cut at a character boundary: a two-byte letter is never split.
    let big = "é".repeat(MAX_SNIPPET_TEXT);
    let cut = Published::of(&[page(&big)], &[], 1_000).snippets.remove(0);
    assert!(cut.truncated);
    assert!(cut.text.len() <= MAX_SNIPPET_TEXT, "{}", cut.text.len());
    assert!(cut.text.chars().all(|c| c == 'é'));
    // Short text is not marked cut.
    assert!(!Published::of(&[page("short")], &[], 1_000).snippets[0].truncated);
    // Long names are cut and many element ids are capped.
    let mut long = page("words");
    long.title = "t".repeat(1000);
    long.elements = (0..500).map(|i| format!("e{i}")).collect();
    let kept = Published::of(&[long], &[], 1_000).snippets.remove(0);
    assert_eq!(kept.title.chars().count(), 200);
    assert_eq!(kept.elements.len(), 50);
    // Five at the cap are well inside what the file may hold.
    let five: Vec<Snippet> = (0..5).map(|i| page(&format!("{i}{big}"))).collect();
    let t = dev_vault();
    assert!(
        mailbox(&t)
            .write_selection(&Published::of(&five, &[], 1_000))
            .is_ok()
    );
}

#[test]
fn what_is_not_worth_sharing_or_not_safe_to_name_is_left_out() {
    let odd = [
        snippet("terminal", "library/notes.md", "from somewhere else"),
        snippet("page", "../outside.md", "outside the vault"),
        snippet("page", "/etc/passwd", "an absolute path"),
        snippet("page", ".kasten/config.yaml", "a hidden folder"),
        snippet("page", "C:\\Users\\me\\x.md", "a drive"),
        snippet("page", "library/notes.md", "   \n  "),
    ];
    assert!(Published::of(&odd, &[], 1_000).snippets.is_empty());
    // A slide with elements and no words is shared.
    let mut slide = snippet("slide", "library/talk.deck", "");
    slide.elements = vec!["e1".into()];
    assert_eq!(Published::of(&[slide], &[], 1_000).snippets.len(), 1);
}

#[test]
fn a_snippet_that_stays_selected_keeps_the_time_it_was_first_seen() {
    let first = Published::of(&[page("kept")], &[], 1_000);
    let later = Published::of(&[page("kept"), page("new")], &first.snippets, 5_000);
    assert_eq!(later.snippets[0].time, 1_000);
    assert_eq!(later.snippets[1].time, 5_000);
    assert_eq!(later.time, 5_000);
}

#[test]
fn the_reader_says_plainly_why_there_is_nothing() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    // The app is not there.
    assert_eq!(mailbox.read_selection(now()), Seen::AppClosed);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    // The app is there and has shared nothing.
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
    // It shared an empty selection.
    mailbox
        .write_selection(&Published::of(&[], &[], now()))
        .unwrap();
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
    // A selection a minute old is out of date; just inside the minute it is not.
    let at = now();
    mailbox
        .write_selection(&Published::of(&[page("old")], &[], at))
        .unwrap();
    // (The app says it is there at the time of each look.)
    mailbox
        .mark_alive("1.2.2", at + SELECTION_STALE_MS)
        .unwrap();
    assert!(matches!(
        mailbox.read_selection(at + SELECTION_STALE_MS),
        Seen::Selected(_)
    ));
    mailbox
        .mark_alive("1.2.2", at + SELECTION_STALE_MS + 1)
        .unwrap();
    assert_eq!(
        mailbox.read_selection(at + SELECTION_STALE_MS + 1),
        Seen::OutOfDate
    );
    // One stamped in the future (a wrong clock, a forgery) is not believed either.
    mailbox.mark_alive("1.2.2", at).unwrap();
    mailbox
        .write_selection(&Published::of(&[page("tomorrow")], &[], at + 3_600_000))
        .unwrap();
    assert_eq!(mailbox.read_selection(at), Seen::OutOfDate);
}

#[test]
fn a_file_that_is_not_what_the_app_writes_is_not_believed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    let path = selection_file(&t);
    plant(&path, b"this is { not json");
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
    // Too big to be one: five snippets of 20 KB come to well under the limit.
    plant(&path, &vec![b' '; 600 * 1024]);
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
    // A folder where the file should be is not read.
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
}

#[cfg(unix)]
#[test]
fn the_file_is_owner_only_and_a_file_others_can_read_is_not_believed() {
    use std::os::unix::fs::PermissionsExt;
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    mailbox
        .write_selection(&Published::of(&[page("private")], &[], now()))
        .unwrap();
    let mode = std::fs::metadata(selection_file(&t))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "{mode:o}");
    assert!(matches!(mailbox.read_selection(now()), Seen::Selected(_)));
    std::fs::set_permissions(selection_file(&t), std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(mailbox.read_selection(now()), Seen::Nothing);
}

#[test]
fn a_write_leaves_only_the_whole_file_and_replaces_the_one_before() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    for text in ["first", "second", "third"] {
        mailbox
            .write_selection(&Published::of(&[page(text)], &[], now()))
            .unwrap();
    }
    let Seen::Selected(read) = mailbox.read_selection(now()) else {
        panic!("shared");
    };
    assert_eq!(read.snippets[0].text, "third");
    let names: Vec<String> = std::fs::read_dir(t.vault.root().join(".kasten/cache/bridge"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .all(|n| !n.contains("tmp") && !n.ends_with(".part")),
        "{names:?}"
    );
    assert!(names.contains(&"selection.json".to_owned()), "{names:?}");
}

#[test]
fn the_selection_is_never_in_history_a_backup_or_the_changed_files() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty());
    let before = k.log(None, 50).unwrap().len();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    mailbox
        .write_selection(&Published::of(&[page("a secret thought")], &[], now()))
        .unwrap();
    assert!(selection_file(&t).is_file());
    let dirty = k.dirty().unwrap();
    assert!(
        dirty
            .iter()
            .all(|p| !p.contains("bridge") && !p.contains("selection")),
        "{dirty:?}"
    );
    k.commit_edits().unwrap();
    assert_eq!(k.log(None, 50).unwrap().len(), before);
    // The cache folder is in the vault's ignore list, so git never takes it in.
    let ignore = std::fs::read_to_string(t.vault.root().join(".gitignore")).unwrap_or_default();
    let exclude =
        std::fs::read_to_string(t.vault.root().join(".git/info/exclude")).unwrap_or_default();
    assert!(
        ignore.contains(".kasten/cache") || exclude.contains(".kasten/cache"),
        "the cache is not ignored: {ignore} / {exclude}"
    );
}

#[test]
fn the_app_shares_only_for_two_minutes_after_a_client_asked_and_then_the_file_goes() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    let sharing = Sharing::default();
    let start = now();
    // Nobody asked: nothing is written.
    assert!(!sharing.on(start));
    assert!(!sharing.publish(&mailbox, &[page("quiet")], start).unwrap());
    assert!(!selection_file(&t).exists());
    // A client asks: it is on, and asking again does not say it turned on again.
    assert!(sharing.ask(start));
    assert!(!sharing.ask(start + 10));
    assert!(sharing.on(start + 1));
    assert!(
        sharing
            .publish(&mailbox, &[page("shared")], start + 5)
            .unwrap()
    );
    assert!(sharing.written_since(start));
    assert!(matches!(
        mailbox.read_selection(start + 6),
        Seen::Selected(_)
    ));
    // Asking again lengthens it.
    let again = start + WATCH_MS - 1_000;
    assert!(!sharing.ask(again));
    assert!(sharing.on(start + WATCH_MS + 1_000));
    assert!(!sharing.on(again + WATCH_MS));
}

#[test]
fn an_unchanged_selection_is_renewed_so_it_is_not_called_out_of_date_and_lapses_after_two_minutes()
{
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let start = now();
    mailbox.mark_alive("1.2.2", start).unwrap();
    let sharing = Sharing::default();
    sharing.ask(start);
    sharing.publish(&mailbox, &[page("steady")], start).unwrap();
    assert_eq!(sharing.tick(&mailbox, start + 1_000), Tick::Idle);
    // Renewed with the same snippets, and the snippet keeps the time it was first seen.
    let renew = start + REFRESH_MS;
    mailbox.mark_alive("1.2.2", renew).unwrap();
    assert_eq!(sharing.tick(&mailbox, renew), Tick::Restamped);
    let Seen::Selected(read) = mailbox.read_selection(renew + 1) else {
        panic!("still shared");
    };
    assert_eq!(read.time, renew);
    assert_eq!(read.snippets[0].time, start);
    assert_eq!(read.snippets[0].text, "steady");
    // Nobody asked again: after two minutes the file is gone.
    let gone = start + WATCH_MS;
    assert_eq!(sharing.tick(&mailbox, gone), Tick::Lapsed);
    assert!(!selection_file(&t).exists());
    assert!(!sharing.on(gone));
    assert_eq!(sharing.tick(&mailbox, gone + 1), Tick::Idle);
    // Publishing after that writes nothing, until someone asks again.
    assert!(
        !sharing
            .publish(&mailbox, &[page("late")], gone + 2)
            .unwrap()
    );
    assert!(!selection_file(&t).exists());
}

#[test]
fn closing_the_app_deletes_the_selection() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let count = Arc::new(AtomicUsize::new(0));
    let mut server = serve(mailbox.clone(), "1.2.2", echo(&count)).unwrap();
    let sharing = Sharing::default();
    sharing.ask(now());
    sharing
        .publish(&mailbox, &[page("on screen")], now())
        .unwrap();
    assert!(selection_file(&t).is_file());
    // The loop ending (the app closing) takes the file with it, and the app is then closed.
    server.stop();
    assert!(!selection_file(&t).exists());
    assert_eq!(mailbox.read_selection(now()), Seen::AppClosed);
    // The app's own stop does it as well.
    sharing.ask(now());
    mailbox.mark_alive("1.2.2", now()).unwrap();
    sharing.publish(&mailbox, &[page("again")], now()).unwrap();
    sharing.stop(&mailbox);
    assert!(!selection_file(&t).exists());
    assert!(!sharing.on(now()));
}
