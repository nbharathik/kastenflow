//! The mailbox is a door into the app: a forged or escaping id, a link in the
//! folder, a file that is not JSON, a file that is too big, an old request and
//! a request that names a place outside the vault are all turned away, and
//! nothing outside the mailbox is read or removed.

use crate::bridge::{DOC, build, echo, files_in, mailbox, now, plant, until};
use crate::common::dev_vault;

use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime};

use kasten_core::agent::Session;
use kasten_core::bridge::{Answer, Call, MAX_REQUEST_BYTES, Request, serve};
use kasten_core::{Error, Instant};
use serde_json::json;

fn session() -> Session {
    Session::start("claude-code", Instant::now())
}

fn request(mailbox: &kasten_core::bridge::Mailbox, call: &Call, created: u64) -> Request {
    Request::new(mailbox.new_id().unwrap(), call, Some(&session()), created)
}

fn counted() -> (Arc<AtomicUsize>, kasten_core::bridge::Handler) {
    let count = Arc::new(AtomicUsize::new(0));
    let handler = echo(&count);
    (count, handler)
}

#[test]
fn ids_are_long_random_and_never_repeat() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let a = mailbox.new_id().unwrap();
    let b = mailbox.new_id().unwrap();
    assert_ne!(a, b);
    for id in [&a, &b] {
        assert!(id.len() >= 32, "{id}");
        assert!(id.bytes().all(|c| c.is_ascii_hexdigit()), "{id}");
    }
}

#[test]
fn an_id_that_escapes_the_folder_reads_and_removes_nothing() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox
        .put_reply(&kasten_core::bridge::Reply::ok(
            &mailbox.new_id().unwrap(),
            json!({}),
        ))
        .unwrap();
    // A JSON file one folder up: the shape of an answer, in the wrong place.
    let outside = t.vault.root().join(".kasten/cache/secret.json");
    fs::write(
        &outside,
        r#"{"id":"../secret","ok":true,"result":{"leak":1}}"#,
    )
    .unwrap();
    for id in [
        "../secret",
        "..%2Fsecret",
        "a/b",
        "a\\b",
        "",
        ".",
        "..",
        "X".repeat(64).as_str(),
        "short",
    ] {
        match mailbox.take_reply(id) {
            Err(Error::Invalid(_)) => {}
            other => panic!("{id:?}: {other:?}"),
        }
    }
    assert!(outside.is_file(), "nothing outside the mailbox was removed");
    // Nor can a request be written under such a name.
    let mut forged = request(&mailbox, &build(DOC), now());
    forged.id = "../../escape".into();
    assert!(mailbox.put_request(&forged).is_err());
    assert!(!t.vault.root().join(".kasten/escape.json").exists());
}

#[test]
fn a_request_whose_inside_id_is_not_its_file_name_is_dropped_unanswered() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    let (count, handler) = counted();
    let one = request(&mailbox, &build(DOC), now());
    let other = mailbox.new_id().unwrap();
    // Written by hand under another id's name.
    let json = serde_json::to_vec(&one).unwrap();
    mailbox.ensure_dirs().unwrap();
    plant(
        &t.vault
            .root()
            .join(format!(".kasten/cache/bridge/requests/{other}.json")),
        &json,
    );
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| files_in(&t, "requests").is_empty()));
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(
        files_in(&t, "replies").is_empty(),
        "a forgery gets no answer"
    );
}

#[test]
fn a_file_that_is_not_json_is_answered_with_an_error_and_removed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let (count, handler) = counted();
    mailbox.ensure_dirs().unwrap();
    let id = mailbox.new_id().unwrap();
    let path = t
        .vault
        .root()
        .join(format!(".kasten/cache/bridge/requests/{id}.json"));
    plant(&path, b"this is { not json");
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| !path.exists()));
    assert!(until(|| mailbox
        .take_reply(&id)
        .ok()
        .flatten()
        .is_some_and(|r| !r.ok)));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn a_request_that_is_too_big_is_refused_and_removed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    // Asking: a document name past the limit never gets written.
    let long = format!("projects/{}", "a".repeat(MAX_REQUEST_BYTES as usize));
    assert!(
        mailbox
            .ask(&build(&long), None, Duration::from_secs(1))
            .is_err()
    );
    assert!(files_in(&t, "requests").is_empty());
    // Serving: a file past the limit is removed unread.
    mailbox.ensure_dirs().unwrap();
    let id = mailbox.new_id().unwrap();
    let path = t
        .vault
        .root()
        .join(format!(".kasten/cache/bridge/requests/{id}.json"));
    fs::write(&path, vec![b' '; MAX_REQUEST_BYTES as usize + 10]).unwrap();
    let (count, handler) = counted();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| !path.exists()));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn a_reply_that_is_too_big_is_replaced_by_a_plain_error() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let big = kasten_core::bridge::Reply::ok(
        &mailbox.new_id().unwrap(),
        json!({"x": "y".repeat(4_000_000)}),
    );
    assert!(mailbox.put_reply(&big).is_err());
    let handler: kasten_core::bridge::Handler =
        Arc::new(|_, _| Ok(json!({"x": "y".repeat(4_000_000)})));
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    let Answer::Reply(reply) = mailbox
        .ask(&build(DOC), None, Duration::from_secs(5))
        .unwrap()
    else {
        panic!("expected a reply");
    };
    assert!(!reply.ok);
    assert!(reply.error.unwrap().contains("too big"));
}

#[test]
fn a_request_naming_a_place_outside_the_vault_is_refused_and_never_written() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    for doc in [
        "../outside",
        "projects/../../outside",
        "/etc/passwd",
        "C:\\Windows",
        "C:/Windows",
        "\\\\server\\share",
        ".kasten/cache",
        "projects/.git/x",
        "",
        "a\0b",
        "projects//x",
    ] {
        let export = Call::LatexExportPdf {
            doc: doc.into(),
            reason: None,
        };
        for call in [build(doc), export] {
            match mailbox.ask(&call, None, Duration::from_millis(200)) {
                Err(Error::Invalid(_)) => {}
                other => panic!("{doc:?}: {other:?}"),
            }
        }
    }
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn a_forged_request_naming_a_path_outside_the_vault_is_answered_with_a_refusal() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let (count, handler) = counted();
    // Written by hand, as something that skipped the client's check would.
    let mut forged = request(&mailbox, &build(DOC), now());
    forged.params = json!({"doc": "/etc/passwd", "wait_ms": 1000});
    mailbox.put_request(&forged).unwrap();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| mailbox
        .take_reply(&forged.id)
        .ok()
        .flatten()
        .is_some_and(|r| !r.ok)));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn an_unknown_kind_gets_a_plain_error() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let (count, handler) = counted();
    let mut odd = request(&mailbox, &build(DOC), now());
    odd.kind = "run_program".into();
    odd.params = json!({"program": "calc"});
    mailbox.put_request(&odd).unwrap();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    let mut said = None;
    assert!(until(|| {
        said = mailbox.take_reply(&odd.id).ok().flatten();
        said.is_some()
    }));
    let said = said.unwrap();
    assert!(!said.ok);
    assert!(said.error.unwrap().contains("run_program"));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn an_old_request_is_dropped_not_run() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let (count, handler) = counted();
    let old = request(&mailbox, &build(DOC), now() - 10 * 60_000);
    mailbox.put_request(&old).unwrap();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| files_in(&t, "requests").is_empty()));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn old_files_are_swept_and_fresh_ones_stay() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.ensure_dirs().unwrap();
    let dir = t.vault.root().join(".kasten/cache/bridge");
    let (old, fresh) = (
        dir.join(format!("replies/{}.json", mailbox.new_id().unwrap())),
        dir.join(format!("replies/{}.json", mailbox.new_id().unwrap())),
    );
    for path in [&old, &fresh] {
        plant(path, br#"{"id":"x","ok":true}"#);
    }
    let long_ago = SystemTime::now() - Duration::from_secs(3600);
    fs::File::options()
        .write(true)
        .open(&old)
        .unwrap()
        .set_modified(long_ago)
        .unwrap();
    mailbox.sweep(now());
    assert!(!old.exists());
    assert!(fresh.exists());
}

#[test]
fn too_many_waiting_requests_are_not_added_to() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    for _ in 0..kasten_core::bridge::MAX_WAITING {
        mailbox
            .put_request(&request(&mailbox, &build(DOC), now()))
            .unwrap();
    }
    let why = mailbox
        .ask(&build(DOC), None, Duration::from_millis(200))
        .unwrap_err();
    assert!(why.to_string().contains("waiting"), "{why}");
}

#[cfg(any(unix, windows))]
fn link_to(target: &std::path::Path, at: &std::path::Path) -> bool {
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(target, at).is_ok();
    #[cfg(windows)]
    let made = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, at).is_ok()
    } else {
        std::os::windows::fs::symlink_file(target, at).is_ok()
    };
    if !made {
        eprintln!("SKIPPED: this machine does not let a test make links");
    }
    made
}

#[cfg(any(unix, windows))]
#[test]
fn a_link_in_the_folder_is_never_followed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.ensure_dirs().unwrap();
    let root = t.vault.root();
    // A request that is a link to a real request elsewhere.
    let real = request(&mailbox, &build(DOC), now());
    let elsewhere = root.join("notes-elsewhere.json");
    fs::write(&elsewhere, serde_json::to_vec(&real).unwrap()).unwrap();
    let at = root.join(format!(".kasten/cache/bridge/requests/{}.json", real.id));
    if !link_to(&elsewhere, &at) {
        return;
    }
    let (count, handler) = counted();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(
        until(|| fs::symlink_metadata(&at).is_err()),
        "the link itself is removed"
    );
    assert_eq!(count.load(Ordering::SeqCst), 0);
    assert!(elsewhere.is_file(), "what it pointed to is untouched");
}

#[cfg(any(unix, windows))]
#[test]
fn a_replies_folder_that_is_a_link_is_refused() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.ensure_dirs().unwrap();
    let root = t.vault.root();
    let other = root.join("somewhere-else");
    fs::create_dir_all(&other).unwrap();
    let replies = root.join(".kasten/cache/bridge/replies");
    fs::remove_dir_all(&replies).unwrap();
    if !link_to(&other, &replies) {
        return;
    }
    assert!(
        mailbox
            .put_reply(&kasten_core::bridge::Reply::ok(
                &mailbox.new_id().unwrap(),
                json!({})
            ))
            .is_err()
    );
    assert!(
        fs::read_dir(&other).unwrap().next().is_none(),
        "nothing was written through the link"
    );
}

#[cfg(unix)]
#[test]
fn a_request_other_people_could_read_is_not_obeyed() {
    use std::os::unix::fs::PermissionsExt;
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.ensure_dirs().unwrap();
    let (count, handler) = counted();
    let one = request(&mailbox, &build(DOC), now());
    let path = t
        .vault
        .root()
        .join(format!(".kasten/cache/bridge/requests/{}.json", one.id));
    fs::write(&path, serde_json::to_vec(&one).unwrap()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let _server = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    assert!(until(|| !path.exists()));
    assert_eq!(count.load(Ordering::SeqCst), 0);
}
