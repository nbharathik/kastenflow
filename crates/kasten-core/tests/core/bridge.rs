//! The mailbox between the MCP server and the app: a request goes in as a
//! file, the app answers with another, and the app's own file says it is
//! there. The app side is a stand-in thread here (`serve` with a handler).

use crate::common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{TempVault, dev_vault};
use kasten_core::agent::Session;
use kasten_core::bridge::{Answer, Call, Handler, Mailbox, Platform, Reply, Request, serve};
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};

pub const DOC: &str = "projects/photo-organiser/latex/article";

pub fn mailbox(t: &TempVault) -> Mailbox {
    Mailbox::open(t.vault.root(), Platform::standard()).unwrap()
}

pub fn build(doc: &str) -> Call {
    Call::LatexBuild {
        doc: doc.into(),
        wait_ms: 5_000,
        preview: false,
    }
}

pub fn now() -> u64 {
    Instant::now().millis
}

/// A handler that answers every request with what it was asked, and counts.
pub fn echo(count: &Arc<AtomicUsize>) -> Handler {
    let count = Arc::clone(count);
    Arc::new(move |request: Request, call: Call| {
        count.fetch_add(1, Ordering::SeqCst);
        Ok(json!({
            "kind": call.kind(),
            "doc": call.doc(),
            "client": request.session.map(|s| s.client),
        }))
    })
}

/// Waits (up to five seconds) until `done` is true.
pub fn until(mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..250 {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    done()
}

/// Writes a file as the mailbox would (readable by its owner alone), for the
/// tests that forge one by hand.
pub fn plant(path: &std::path::Path, bytes: &[u8]) {
    std::fs::write(path, bytes).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

pub fn files_in(t: &TempVault, folder: &str) -> Vec<String> {
    let dir = t.vault.root().join(".kasten/cache/bridge").join(folder);
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_request_is_answered_by_the_app_and_the_answer_comes_back() {
    let t = dev_vault();
    let count = Arc::new(AtomicUsize::new(0));
    let server = serve(mailbox(&t), "1.2.2", echo(&count)).unwrap();
    let session = Session::start("claude-code", Instant::now());
    let answer = mailbox(&t)
        .ask(&build(DOC), Some(&session), Duration::from_secs(5))
        .unwrap();
    let Answer::Reply(reply) = answer else {
        panic!("expected a reply, got {answer:?}");
    };
    assert!(reply.ok, "{reply:?}");
    assert_eq!(reply.result["kind"], "latex_build");
    assert_eq!(reply.result["doc"], DOC);
    assert_eq!(reply.result["client"], "claude-code");
    assert_eq!(count.load(Ordering::SeqCst), 1);
    // Nothing is left in the mailbox.
    assert!(files_in(&t, "requests").is_empty());
    assert!(files_in(&t, "replies").is_empty());
    drop(server);
}

#[test]
fn every_kind_has_its_params_and_comes_back_typed() {
    for call in [
        build(DOC),
        Call::LatexExportPdf {
            doc: DOC.into(),
            reason: Some("ready".into()),
        },
        Call::DiagramPng {
            diagram: "library/Login flow.drawio".into(),
            page: Some("Page-2".into()),
        },
        Call::DiagramPng {
            diagram: "library/Login flow.drawio".into(),
            page: None,
        },
        Call::WatchSelection {},
    ] {
        let params = call.params();
        assert!(params.is_object(), "{params}");
        assert!(Call::KINDS.contains(&call.kind()), "{}", call.kind());
        assert_eq!(Call::parse(call.kind(), &params).unwrap(), call);
    }
    assert_eq!(Call::KINDS.len(), 4);
    let why = Call::parse("run_program", &json!({"cmd": "calc"})).unwrap_err();
    assert!(why.contains("run_program"), "{why}");
    // A kind the app knows, with params that do not fit.
    assert!(Call::parse("latex_build", &json!({"folder": "x"})).is_err());
}

#[test]
fn two_requests_at_once_each_get_their_own_answer() {
    let t = dev_vault();
    let count = Arc::new(AtomicUsize::new(0));
    let _server = serve(mailbox(&t), "1.2.2", echo(&count)).unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut threads = Vec::new();
    for doc in ["projects/a/latex/one", "projects/b/latex/two"] {
        let (mailbox, seen) = (mailbox(&t), Arc::clone(&seen));
        threads.push(std::thread::spawn(move || {
            let answer = mailbox
                .ask(&build(doc), None, Duration::from_secs(5))
                .unwrap();
            let Answer::Reply(reply) = answer else {
                panic!("{answer:?}");
            };
            seen.lock()
                .unwrap()
                .push((doc, reply.result["doc"].clone()));
        }));
    }
    for thread in threads {
        thread.join().unwrap();
    }
    for (asked, got) in seen.lock().unwrap().iter() {
        assert_eq!(*got, json!(asked));
    }
    assert_eq!(count.load(Ordering::SeqCst), 2);
}

#[test]
fn a_reply_is_read_once_and_removed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    let id = mailbox.new_id().unwrap();
    mailbox
        .put_reply(&Reply::ok(&id, json!({"pages": 3})))
        .unwrap();
    assert_eq!(files_in(&t, "replies").len(), 1);
    let first = mailbox.take_reply(&id).unwrap().unwrap();
    assert_eq!(first.result["pages"], 3);
    assert!(mailbox.take_reply(&id).unwrap().is_none());
    assert!(files_in(&t, "replies").is_empty());
}

#[test]
fn no_app_means_the_app_is_closed_and_nothing_is_left_behind() {
    let t = dev_vault();
    let answer = mailbox(&t)
        .ask(&build(DOC), None, Duration::from_secs(1))
        .unwrap();
    assert_eq!(answer, Answer::AppClosed);
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn an_alive_file_older_than_fifteen_seconds_means_closed() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now() - 20_000).unwrap();
    assert!(mailbox.alive(now()).is_none());
    assert_eq!(
        mailbox
            .ask(&build(DOC), None, Duration::from_secs(1))
            .unwrap(),
        Answer::AppClosed
    );
    mailbox.mark_alive("1.2.2", now() - 5_000).unwrap();
    let alive = mailbox.alive(now()).unwrap();
    assert_eq!(alive.version, "1.2.2");
    // The app's clock far ahead of ours is not alive either.
    mailbox.mark_alive("1.2.2", now() + 60_000).unwrap();
    assert!(mailbox.alive(now()).is_none());
}

#[test]
fn an_app_that_does_not_answer_in_time_is_timed_out_and_its_request_withdrawn() {
    let t = dev_vault();
    let mailbox = mailbox(&t);
    mailbox.mark_alive("1.2.2", now()).unwrap();
    let answer = mailbox
        .ask(&build(DOC), None, Duration::from_millis(300))
        .unwrap();
    assert_eq!(answer, Answer::TimedOut);
    assert!(
        files_in(&t, "requests").is_empty(),
        "a late app must not run it"
    );
}

#[test]
fn stopping_the_server_clears_the_alive_file() {
    let t = dev_vault();
    let count = Arc::new(AtomicUsize::new(0));
    let mut server = serve(mailbox(&t), "1.2.2", echo(&count)).unwrap();
    assert!(until(|| mailbox(&t).alive(now()).is_some()));
    server.stop();
    assert!(mailbox(&t).alive(now()).is_none());
    assert_eq!(
        mailbox(&t)
            .ask(&build(DOC), None, Duration::from_secs(1))
            .unwrap(),
        Answer::AppClosed
    );
}

#[test]
fn a_handler_that_fails_or_panics_answers_with_a_plain_sentence() {
    let t = dev_vault();
    let handler: Handler = Arc::new(|_request, call: Call| {
        if call.doc().ends_with("boom") {
            panic!("the handler breaks");
        }
        Err("That is not a LaTeX document".to_owned())
    });
    let _server = serve(mailbox(&t), "1.2.2", handler).unwrap();
    let ask = |doc: &str| match mailbox(&t)
        .ask(&build(doc), None, Duration::from_secs(5))
        .unwrap()
    {
        Answer::Reply(reply) => reply,
        other => panic!("{other:?}"),
    };
    let failed = ask("projects/x/latex/a");
    assert!(!failed.ok);
    assert_eq!(
        failed.error.as_deref(),
        Some("That is not a LaTeX document")
    );
    let broken = ask("projects/x/latex/boom");
    assert!(!broken.ok);
    assert!(broken.error.unwrap().contains("stopped"), "plain words");
    // The app goes on answering.
    assert!(!ask("projects/x/latex/a").ok);
}

#[test]
fn the_mailbox_is_never_in_history_or_changed_files() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty());
    let count = Arc::new(AtomicUsize::new(0));
    let _server = serve(mailbox(&t), "1.2.2", echo(&count)).unwrap();
    let _ = mailbox(&t)
        .ask(&build(DOC), None, Duration::from_secs(5))
        .unwrap();
    let dirty: Vec<String> = k.dirty().unwrap();
    assert!(dirty.iter().all(|p| !p.contains("bridge")), "{dirty:?}");
    // The folder exists, and git ignores it with the rest of the cache.
    assert!(t.vault.root().join(".kasten/cache/bridge").is_dir());
    let value: Value = serde_json::from_str(
        &std::fs::read_to_string(t.vault.root().join(".kasten/cache/bridge/app-alive.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(value["version"], "1.2.2");
}
