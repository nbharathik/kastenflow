//! Subscribing, refreshing, going offline and removing, against a feed
//! served from 127.0.0.1 and an in-memory keychain: no real calendar service
//! is reached and no real keychain is touched.

use std::fs;
use std::sync::Arc;

use super::fetch::{self, Answer, Validators};
use super::refresh::wanted;
use super::service::*;
use super::store::{Entry, Meta, Store};
use super::test_server::{Reply, client, ok, run, serve};
use crate::secrets::MemoryKeys;

const GOOGLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/ics/google.ics"
));
const SECRET: &str = "private-0123abcd";

fn fresh(name: &str) -> (Store, Calendars) {
    let root = std::env::temp_dir()
        .join(format!("kasten-calendar-service-{}", std::process::id()))
        .join(name);
    let _ = fs::remove_dir_all(&root);
    let store = Store::new(
        root.join("config"),
        root.join("cache"),
        Arc::new(MemoryKeys::default()),
    );
    (store, Calendars::default())
}

/// Subscribes to the feed at `url`: checked, fetched, read and kept.
fn subscribe(
    store: &Store,
    cal: &Calendars,
    name: &str,
    url: &str,
    now: i64,
) -> Result<Info, String> {
    let new = check_new(store, name, url, "teal")?;
    match run(fetch::get(&client(), &new.url, &Validators::default()))? {
        Answer::Fresh { text, validators } => save_new(store, cal, new, &text, validators, now),
        Answer::Unchanged => Err("unexpected".into()),
    }
}

/// Refreshes one subscription as the app does: plan, fetch, record.
fn refresh(store: &Store, cal: &Calendars, id: &str, now: i64) -> Result<bool, String> {
    let plan = plan_refresh(store, id)?;
    let answer = run(fetch::get(&client(), &plan.url, &plan.have));
    finish_refresh(store, cal, id, answer, now)
}

fn feed_server(count: usize) -> (String, std::thread::JoinHandle<Vec<String>>) {
    serve(count, |n, head| {
        let has_tag = head.to_ascii_lowercase().contains("if-none-match: \"v1\"");
        match n {
            // The first request gives the feed and its version.
            0 => {
                let mut reply = ok(GOOGLE);
                reply.headers.push(("ETag", "\"v1\"".into()));
                reply
            }
            // A refresh that names the version it holds: nothing changed.
            1 if has_tag => Reply {
                status: 304,
                headers: vec![],
                body: vec![],
                open_ended: false,
            },
            // Then a new version, with one more event.
            _ => {
                let more = GOOGLE.replace(
                    "END:VCALENDAR",
                    "BEGIN:VEVENT\nUID:new@x\nSUMMARY:Added later\nDTSTART:20261008T080000Z\nEND:VEVENT\nEND:VCALENDAR",
                );
                let mut reply = ok(&more);
                reply.headers.push(("ETag", "\"v2\"".into()));
                reply
            }
        }
    })
}

fn titles(store: &Store, cal: &Calendars) -> Vec<String> {
    events(store, cal, "2026-10-01", "2026-10-31", Some("UTC"))
        .unwrap()
        .events
        .into_iter()
        .map(|e| e.event.title)
        .collect()
}

#[test]
fn subscribing_reads_the_feed_once_and_keeps_the_address_only_in_the_keychain() {
    let (store, cal) = fresh("add");
    let (base, server) = feed_server(1);
    let url = format!("{base}/{SECRET}/basic.ics");
    let made = subscribe(&store, &cal, "", &url, 1_000).unwrap();
    server.join().unwrap();
    // Named by the feed when the person gave no name.
    assert_eq!(made.name, "Work (fixture)");
    assert_eq!(made.color, "teal");
    assert_eq!(made.host, "127.0.0.1");
    assert_eq!(made.masked, "127.0.0.1/….ics");
    assert_eq!(
        (made.last_updated, made.last_checked, made.error.clone()),
        (Some(1_000), Some(1_000), None)
    );
    // The address is in the keychain, under the calendar's own account.
    let keys = store.keys();
    assert_eq!(
        keys.get(&format!("calendar @ {}", made.id))
            .unwrap()
            .as_deref(),
        Some(url.as_str())
    );
    // What the window is told never holds it.
    let told = serde_json::to_string(&infos(&store).unwrap()).unwrap();
    assert!(
        !told.contains(SECRET) && told.contains("127.0.0.1"),
        "{told}"
    );
    // The events are there to ask for.
    assert!(titles(&store, &cal).contains(&"Team standup (moved)".to_owned()));
    // Nothing is written outside the app's own folders: the list and the cache hold no address.
    for path in store.files_for_tests() {
        assert!(
            !fs::read_to_string(&path).unwrap().contains(SECRET),
            "{path:?}"
        );
    }
}

#[test]
fn an_address_that_is_not_a_calendar_is_never_kept() {
    let (store, cal) = fresh("not-a-calendar");
    let (base, server) = serve(1, |_, _| ok("<html>Sign in to continue</html>"));
    let err = subscribe(&store, &cal, "x", &format!("{base}/{SECRET}"), 1).unwrap_err();
    server.join().unwrap();
    assert!(
        err.contains("did not give a calendar") && !err.contains(SECRET),
        "{err}"
    );
    assert!(store.list().unwrap().is_empty());
    // Text that looks like one but holds no calendar at all is refused too, with nothing left over.
    let new = check_new(&store, "x", "https://example.com/a.ics", "teal").unwrap();
    assert!(
        save_new(
            &store,
            &cal,
            new,
            "BEGIN:VCALENDAR",
            Validators::default(),
            1
        )
        .is_ok()
    );
    let new = check_new(&store, "y", "https://example.com/b.ics", "teal").unwrap();
    assert!(save_new(&store, &cal, new, "<html></html>", Validators::default(), 1).is_err());
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(store.files_for_tests().len(), 3);
}

#[test]
fn a_refresh_asks_only_for_a_change_and_then_takes_the_new_copy() {
    let (store, cal) = fresh("refresh");
    let (base, server) = feed_server(3);
    let made = subscribe(
        &store,
        &cal,
        "Work",
        &format!("{base}/{SECRET}/basic.ics"),
        1_000,
    )
    .unwrap();
    assert!(!titles(&store, &cal).contains(&"Added later".to_owned()));
    // Nothing changed: the copy is confirmed current, and the window has nothing new.
    assert!(!refresh(&store, &cal, &made.id, 2_000).unwrap());
    let info = &infos(&store).unwrap()[0];
    assert_eq!(
        (info.last_updated, info.last_checked),
        (Some(2_000), Some(2_000))
    );
    // A new version: kept, and its events shown.
    assert!(refresh(&store, &cal, &made.id, 3_000).unwrap());
    assert!(titles(&store, &cal).contains(&"Added later".to_owned()));
    assert_eq!(
        store.meta(&made.id).validators.etag.as_deref(),
        Some("\"v2\"")
    );
    let heads = server.join().unwrap();
    assert!(
        heads[1]
            .to_ascii_lowercase()
            .contains("if-none-match: \"v1\"")
    );
    assert!(
        heads[2]
            .to_ascii_lowercase()
            .contains("if-none-match: \"v1\"")
    );
}

#[test]
fn offline_the_last_copy_is_shown_with_the_time_it_was_updated() {
    let (store, cal) = fresh("offline");
    let (base, server) = feed_server(1);
    let url = format!("{base}/{SECRET}/basic.ics");
    let made = subscribe(&store, &cal, "Work", &url, 1_000).unwrap();
    server.join().unwrap();
    // The server is gone now.
    assert!(
        refresh(&store, &cal, &made.id, 5_000).unwrap(),
        "a failure is news for the window"
    );
    let info = infos(&store).unwrap().remove(0);
    let error = info.error.clone().expect("the failure is kept");
    assert!(
        error.contains("Could not reach 127.0.0.1") && !error.contains(SECRET),
        "{error}"
    );
    assert_eq!(
        info.last_updated,
        Some(1_000),
        "the last copy is from the time it was fetched"
    );
    assert_eq!(info.last_checked, Some(5_000));
    // The events are still the last copy's, even after a restart (no parsed copy held).
    assert!(titles(&store, &cal).contains(&"Team standup".to_owned()));
    assert!(titles(&store, &Calendars::default()).contains(&"Team standup".to_owned()));
    // The same failure again is not news.
    assert!(!refresh(&store, &cal, &made.id, 9_000).unwrap());
}

#[test]
fn a_new_copy_that_cannot_be_read_leaves_the_old_one_alone() {
    let (store, cal) = fresh("garbled");
    let (base, server) = feed_server(1);
    let made = subscribe(
        &store,
        &cal,
        "Work",
        &format!("{base}/{SECRET}/basic.ics"),
        1_000,
    )
    .unwrap();
    server.join().unwrap();
    let before = store.read_feed(&made.id).unwrap();
    let html = Ok(Answer::Fresh {
        text: "<html></html>".into(),
        validators: Validators::default(),
    });
    assert!(
        finish_refresh(&store, &cal, &made.id, html, 3_000).unwrap(),
        "a new failure is news"
    );
    let info = &infos(&store).unwrap()[0];
    assert!(
        info.error
            .as_deref()
            .unwrap()
            .contains("did not give a calendar")
    );
    assert_eq!(store.read_feed(&made.id).unwrap(), before);
    // The copy is still the one from 1,000: the check at 3,000 did not confirm it.
    assert_eq!(
        (info.last_updated, info.last_checked),
        (Some(1_000), Some(3_000))
    );
    assert!(titles(&store, &cal).contains(&"Team standup".to_owned()));
}

#[test]
fn removing_a_calendar_removes_its_copy_and_its_address() {
    let (store, cal) = fresh("remove");
    let (base, server) = feed_server(1);
    let made = subscribe(
        &store,
        &cal,
        "Work",
        &format!("{base}/{SECRET}/basic.ics"),
        1_000,
    )
    .unwrap();
    server.join().unwrap();
    let keys = store.keys();
    let account = format!("calendar @ {}", made.id);
    assert!(keys.get(&account).unwrap().is_some());
    assert!(store.read_feed(&made.id).is_some());
    remove(&store, &cal, &made.id).unwrap();
    assert_eq!(keys.get(&account).unwrap(), None);
    assert!(store.read_feed(&made.id).is_none());
    assert_eq!(store.meta(&made.id), Meta::default());
    assert!(store.list().unwrap().is_empty());
    assert!(
        store
            .files_for_tests()
            .iter()
            .all(|p| !p.to_string_lossy().contains(&made.id))
    );
    assert!(titles(&store, &cal).is_empty());
    assert!(remove(&store, &cal, &made.id).is_err());
    assert!(remove(&store, &cal, "../x").is_err());
}

#[test]
fn changes_are_kept_and_a_hidden_calendar_gives_no_events() {
    let (store, cal) = fresh("edit");
    let (base, server) = feed_server(1);
    let made = subscribe(
        &store,
        &cal,
        "Work",
        &format!("{base}/{SECRET}/basic.ics"),
        1_000,
    )
    .unwrap();
    server.join().unwrap();
    let changed = edit(
        &store,
        &made.id,
        &Change {
            name: Some("  Office  ".into()),
            color: Some("#ff8800".into()),
            refresh_minutes: Some(1),
            ..Change::default()
        },
    )
    .unwrap();
    assert_eq!(
        (
            changed.name.as_str(),
            changed.color.as_str(),
            changed.refresh_minutes
        ),
        ("Office", "#ff8800", 5)
    );
    // A colour with anything odd in it is ignored, a name left empty stays.
    let same = edit(
        &store,
        &made.id,
        &Change {
            name: Some("   ".into()),
            color: Some("red;}".into()),
            ..Change::default()
        },
    )
    .unwrap();
    assert_eq!(
        (same.name.as_str(), same.color.as_str()),
        ("Office", "#ff8800")
    );
    assert!(!titles(&store, &cal).is_empty());
    let hidden = edit(
        &store,
        &made.id,
        &Change {
            shown: Some(false),
            ..Change::default()
        },
    )
    .unwrap();
    assert!(!hidden.shown);
    assert!(titles(&store, &cal).is_empty());
    assert!(edit(&store, "nothere", &Change::default()).is_err());
}

#[test]
fn only_shown_calendars_that_are_due_are_refreshed() {
    let entry = |shown, minutes| Entry {
        id: "a".into(),
        shown,
        refresh_minutes: minutes,
        ..Entry::default()
    };
    let meta = |checked| Meta {
        checked,
        ..Meta::default()
    };
    // Never asked: always due.
    assert!(wanted(&entry(true, 30), &meta(None), 100, Refresh::Due));
    // Asked 10 minutes ago: not due at 30, due at 5.
    assert!(!wanted(&entry(true, 30), &meta(Some(0)), 600, Refresh::Due));
    assert!(wanted(&entry(true, 5), &meta(Some(0)), 600, Refresh::Due));
    // Opening the Calendar: older than 5 minutes.
    assert!(wanted(
        &entry(true, 30),
        &meta(Some(0)),
        600,
        Refresh::OlderThan(5)
    ));
    assert!(!wanted(
        &entry(true, 30),
        &meta(Some(400)),
        600,
        Refresh::OlderThan(5)
    ));
    // On demand: now, but never a hidden calendar.
    assert!(wanted(
        &entry(true, 30),
        &meta(Some(599)),
        600,
        Refresh::Always
    ));
    assert!(!wanted(
        &entry(false, 30),
        &meta(None),
        600,
        Refresh::Always
    ));
}

#[test]
fn the_same_address_is_not_subscribed_twice() {
    let (store, cal) = fresh("twice");
    let (base, server) = feed_server(1);
    let url = format!("{base}/{SECRET}/basic.ics");
    subscribe(&store, &cal, "Work", &url, 1).unwrap();
    server.join().unwrap();
    // Caught before anything is fetched.
    let again = check_new(&store, "Again", &url, "teal").unwrap_err();
    assert!(
        again.contains("already subscribed, as “Work”") && !again.contains(SECRET),
        "{again}"
    );
    assert!(check_new(&store, "Other", "https://other.example.com/x.ics", "teal").is_ok());
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn the_number_of_calendars_is_limited() {
    let (store, _cal) = fresh("limit");
    store
        .update(|list| {
            for n in 0..20 {
                list.push(Entry {
                    id: format!("c{n}"),
                    ..Entry::default()
                });
            }
            Ok(())
        })
        .unwrap();
    assert!(check_new(&store, "x", "https://example.com/a.ics", "teal").is_err());
}

#[test]
fn asking_for_events_covers_several_calendars_in_order() {
    let (store, cal) = fresh("several");
    let mine = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:m\nSUMMARY:Mine\nDTSTART:20261012T080000Z\nEND:VEVENT\nEND:VCALENDAR\n";
    let theirs = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:t\nSUMMARY:Theirs\nDTSTART:20261012T070000Z\nEND:VEVENT\nEND:VCALENDAR\n";
    for (name, text, host) in [
        ("Mine", mine, "a.example.com"),
        ("Theirs", theirs, "b.example.com"),
    ] {
        let new = check_new(&store, name, &format!("https://{host}/x.ics"), "blue").unwrap();
        save_new(&store, &cal, new, text, Validators::default(), 1).unwrap();
    }
    let found = events(&store, &cal, "2026-10-12", "2026-10-12", Some("UTC")).unwrap();
    let names: Vec<_> = found
        .events
        .iter()
        .map(|e| e.event.title.as_str())
        .collect();
    assert_eq!(names, ["Theirs", "Mine"]);
    let ids: Vec<_> = infos(&store).unwrap().into_iter().map(|i| i.id).collect();
    assert_eq!(found.events[0].calendar, ids[1]);
    assert!(events(&store, &cal, "2026-10-12", "2026-10-11", None).is_err());
    let json = serde_json::to_value(&found.events[0]).unwrap();
    assert!(json["calendar"].is_string() && json["title"] == "Theirs" && json["allDay"] == false);
}
