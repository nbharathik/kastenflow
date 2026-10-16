//! Refreshing several calendars side by side, and stopping: a refresh that is
//! stopped (the window closed, the app quitting) records nothing and hangs up,
//! one calendar failing does not stop the others, a proxy that fails leaves
//! the last copy as it was, and a subscription that is stopped keeps nothing.
//! Feeds come from 127.0.0.1 and the keychain is in memory.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::client::{Clients, build};
use super::fetch::{self, Answer, Validators};
use super::jobs::refresh_ids;
use super::service::{Calendars, check_new, infos, save_new};
use super::store::Store;
use super::test_server::{client, ok, run, serve};
use crate::secrets::MemoryKeys;

const GOOGLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/ics/google.ics"
));
const SECRET: &str = "private-0123abcd";

fn fresh(name: &str) -> (Store, Calendars) {
    let root = std::env::temp_dir()
        .join(format!("kasten-calendar-jobs-{}", std::process::id()))
        .join(name);
    let _ = fs::remove_dir_all(&root);
    let store = Store::new(
        root.join("config"),
        root.join("cache"),
        Arc::new(MemoryKeys::default()),
    );
    (store, Calendars::with_clients(Clients::fixed(client())))
}

/// Subscribes to a feed served once, and returns the calendar's id.
fn subscribe(store: &Store, cal: &Calendars, name: &str) -> String {
    let (base, server) = serve(1, |_, _| ok(GOOGLE));
    let new = check_new(store, name, &format!("{base}/{SECRET}/{name}.ics"), "teal").unwrap();
    let Answer::Fresh { text, validators } =
        run(fetch::get(&client(), &new.url, &Validators::default())).unwrap()
    else {
        panic!("a fresh copy")
    };
    server.join().unwrap();
    save_new(store, cal, new, &text, validators, 1_000)
        .unwrap()
        .id
}

fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

/// A server that sends the start of a long feed and then trickles on, and says
/// whether the other end hung up while it did.
fn trickling_server() -> (String, JoinHandle<bool>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return false;
        };
        let _ = stream.read(&mut [0u8; 1024]);
        let head = b"HTTP/1.1 200 OK\r\nContent-Type: text/calendar\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\nBEGIN:VCALENDAR\r\n";
        if stream.write_all(head).is_err() {
            return true;
        }
        for _ in 0..80 {
            thread::sleep(Duration::from_millis(50));
            if stream.write_all(&[b' '; 200]).is_err() {
                return true;
            }
        }
        false
    });
    (base, handle)
}

fn titles(store: &Store, cal: &Calendars) -> Vec<String> {
    super::service::events(store, cal, "2026-10-01", "2026-10-31", Some("UTC"))
        .unwrap()
        .events
        .into_iter()
        .map(|e| e.event.title)
        .collect()
}

#[test]
fn a_refresh_that_is_stopped_records_nothing_and_hangs_up() {
    let (store, cal) = fresh("stopped");
    let id = subscribe(&store, &cal, "Work");
    let (slow, hung_up) = trickling_server();
    store
        .set_address(&id, &format!("{slow}/{SECRET}/basic.ics"))
        .unwrap();
    let before = (store.read_feed(&id), store.meta(&id));
    let stopped = run(async {
        tokio::time::timeout(
            Duration::from_millis(400),
            refresh_ids(&store, &cal, vec![id.clone()], || 9_000),
        )
        .await
    });
    assert!(stopped.is_err(), "the refresh was still going when stopped");
    // Neither the copy nor what is known about it changed: not even a failure.
    assert_eq!((store.read_feed(&id), store.meta(&id)), before);
    assert!(hung_up.join().unwrap(), "the connection was not closed");
    // And nobody is left holding the calendar: a refresh may start again.
    assert!(cal.claim(&id).is_some());
}

#[test]
fn a_subscription_that_is_stopped_keeps_nothing() {
    let (store, _cal) = fresh("stopped-subscribe");
    let (slow, hung_up) = trickling_server();
    let new = check_new(
        &store,
        "Work",
        &format!("{slow}/{SECRET}/basic.ics"),
        "teal",
    )
    .unwrap();
    let stopped = run(async {
        tokio::time::timeout(
            Duration::from_millis(400),
            fetch::get(&client(), &new.url, &Validators::default()),
        )
        .await
    });
    assert!(stopped.is_err());
    // A feed is kept only once it has been read whole, so nothing is left:
    // no entry in the list, no copy, no address.
    assert!(store.list().unwrap().is_empty());
    assert!(store.files_for_tests().is_empty());
    assert!(hung_up.join().unwrap(), "the connection was not closed");
}

#[test]
fn one_calendar_failing_does_not_stop_the_others() {
    let (store, cal) = fresh("side-by-side");
    let good = subscribe(&store, &cal, "Work");
    let bad = subscribe(&store, &cal, "Gone");
    let (base, server) = serve(1, |_, _| {
        ok(&GOOGLE.replace(
            "END:VCALENDAR",
            "BEGIN:VEVENT\nUID:new@x\nSUMMARY:Added later\nDTSTART:20261008T080000Z\nEND:VEVENT\nEND:VCALENDAR",
        ))
    });
    store
        .set_address(&good, &format!("{base}/{SECRET}/basic.ics"))
        .unwrap();
    store
        .set_address(
            &bad,
            &format!("http://127.0.0.1:{}/{SECRET}/basic.ics", closed_port()),
        )
        .unwrap();
    let news = run(refresh_ids(
        &store,
        &cal,
        vec![good.clone(), bad.clone()],
        || 5_000,
    ));
    server.join().unwrap();
    assert!(news, "a new copy and a new failure are news");
    assert!(titles(&store, &cal).contains(&"Added later".to_owned()));
    let all = infos(&store).unwrap();
    let of = |id: &str| all.iter().find(|i| i.id == id).unwrap();
    assert_eq!(of(&good).error, None);
    assert_eq!(of(&good).last_updated, Some(5_000));
    let failure = of(&bad).error.clone().expect("the failure is kept");
    assert!(failure.contains("Could not reach 127.0.0.1"), "{failure}");
    assert!(!failure.contains(SECRET), "{failure}");
    // The failed one still shows its last copy, from the time it was fetched.
    assert_eq!(of(&bad).last_updated, Some(1_000));
    // Both are free again.
    assert!(cal.claim(&good).is_some() && cal.claim(&bad).is_some());
}

#[test]
fn a_proxy_that_fails_leaves_the_last_copy_as_it_was_and_says_why() {
    let (store, _) = fresh("proxy-down");
    let dead = format!("http://aladdin:opensesame@127.0.0.1:{}", closed_port());
    let cal = Calendars::with_clients(Clients::fixed(
        build(
            true,
            Some(reqwest::Proxy::all(dead).expect("a proxy address")),
        )
        .unwrap(),
    ));
    let id = subscribe(&store, &cal, "Work");
    store
        .set_address(
            &id,
            &format!("https://calendar.example.test/{SECRET}/basic.ics"),
        )
        .unwrap();
    let before = store.read_feed(&id);
    let news = run(refresh_ids(&store, &cal, vec![id.clone()], || 7_000));
    assert!(news, "the first failure is news");
    let info = infos(&store).unwrap().remove(0);
    let error = info.error.expect("the failure is kept");
    assert!(
        error.starts_with("Could not reach calendar.example.test"),
        "{error}"
    );
    for secret in [SECRET, "opensesame", "aladdin"] {
        assert!(!error.contains(secret), "{error}");
    }
    assert_eq!(store.read_feed(&id), before, "the last copy is kept");
    assert_eq!(
        (info.last_updated, info.last_checked),
        (Some(1_000), Some(7_000))
    );
    assert!(titles(&store, &cal).contains(&"Team standup".to_owned()));
}

#[test]
fn a_calendar_that_is_being_fetched_already_is_left_alone() {
    let (store, cal) = fresh("claimed");
    let id = subscribe(&store, &cal, "Work");
    // The address leads nowhere: if it were asked for, the failure would be recorded.
    store
        .set_address(
            &id,
            &format!("http://127.0.0.1:{}/{SECRET}/basic.ics", closed_port()),
        )
        .unwrap();
    let held = cal.claim(&id).expect("free to claim");
    let news = run(refresh_ids(&store, &cal, vec![id.clone()], || 8_000));
    assert!(!news);
    let info = infos(&store).unwrap().remove(0);
    assert_eq!((info.last_checked, info.error), (Some(1_000), None));
    drop(held);
    assert!(cal.claim(&id).is_some());
}
