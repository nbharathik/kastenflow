//! The three routes: pairing, the list of places, and keeping a capture. A
//! capture is one commit that Undo takes back, with `via: extension`; the
//! token is shown once and kept only as a hash.

use std::fs;
use std::time::Duration;

use kasten_core::Instant;

use super::super::store::{FILE, hash};
use super::{CODE, Door, ORIGIN, OTHER, Setup};

const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

fn capture(door: &Door, token: &str, body: &str) -> super::Reply {
    door.authed("POST", "/v1/capture", token).json(body).send()
}

#[test]
fn a_right_code_gives_a_token_once_and_only_its_hash_is_kept() {
    let door = Door::new();
    door.offer(CODE);
    let reply = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"{CODE}","label":"Edge on Windows"}}"#))
        .send();
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    let token = body["token"].as_str().unwrap();
    assert_eq!(token.len(), 43);
    assert_eq!(body["id"].as_str().unwrap().len(), 8);
    assert!(!body["vault"].as_str().unwrap().is_empty());
    assert!(!reply.has_cors());

    let kept = fs::read_to_string(door.settings.join(FILE)).unwrap();
    assert!(!kept.contains(token), "the token is never written: {kept}");
    assert!(kept.contains(&hash(token)));
    assert!(kept.contains(ORIGIN) && kept.contains("Edge on Windows"));
    // The token works.
    assert_eq!(door.authed("GET", "/v1/targets", token).send().status, 200);
}

#[test]
fn a_code_works_once() {
    let door = Door::new();
    let token = door.pair();
    let again = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    assert_eq!(again.status, 403);
    assert!(again.error().contains("No pairing code"), "{}", again.body);
    assert!(again.json().get("token").is_none());
    // The extension paired already is not disturbed.
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
}

#[test]
fn five_wrong_codes_end_it_even_for_the_right_one() {
    let door = Door::new();
    door.offer(CODE);
    for left in [4, 3, 2, 1] {
        let reply = door
            .req("POST", "/v1/pair")
            .json(r#"{"code":"AAAAAAAA"}"#)
            .send();
        assert_eq!(reply.status, 403);
        assert!(reply.error().contains("not right"), "{}", reply.body);
        assert!(reply.error().contains(&left.to_string()) || left == 1);
    }
    let last = door
        .req("POST", "/v1/pair")
        .json(r#"{"code":"AAAAAAAA"}"#)
        .send();
    assert!(
        last.error().contains("Too many wrong codes"),
        "{}",
        last.body
    );
    let right = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    assert_eq!(right.status, 403, "the code is gone");
    assert!(right.json().get("token").is_none());
    assert!(!door.settings.join(FILE).exists(), "nothing was paired");
}

#[test]
fn a_code_that_ran_out_of_time_is_refused() {
    let door = Door::with(Setup {
        ttl: Duration::from_millis(200),
        ..Setup::default()
    });
    door.offer(CODE);
    std::thread::sleep(Duration::from_millis(400));
    let reply = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    assert_eq!(reply.status, 403);
    assert!(reply.error().contains("run out of time"), "{}", reply.body);
}

#[test]
fn a_pairing_request_that_is_not_one_is_refused_before_the_code_is_tried() {
    let door = Door::new();
    door.offer(CODE);
    for body in [
        "",
        "{}",
        r#"{"code":5}"#,
        r#"{"code":"ABCD2345","admin":true}"#,
        r#"{"code":"ABCD2345","code":"ABCD2345"}"#,
    ] {
        let reply = door.req("POST", "/v1/pair").json(body).send();
        assert_eq!(reply.status, 400, "{body}");
    }
    // None of those cost a try.
    let right = door
        .req("POST", "/v1/pair")
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    assert_eq!(right.status, 200, "{}", right.body);
}

#[test]
fn a_label_is_cleaned_and_a_missing_one_is_called_browser() {
    let door = Door::new();
    door.offer(CODE);
    let long = "x".repeat(100);
    door.req("POST", "/v1/pair")
        .json(&format!(
            r#"{{"code":"{CODE}","label":"Ed\ng\u0007e {long}"}}"#
        ))
        .send();
    door.offer(CODE);
    door.req("POST", "/v1/pair")
        .origin(OTHER)
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    let infos = door.shared.store.lock().unwrap().infos();
    let label = |origin: &str| {
        infos
            .iter()
            .find(|p| p.origin == origin)
            .unwrap()
            .label
            .clone()
    };
    assert!(label(ORIGIN).starts_with("Edge ") && label(ORIGIN).chars().count() <= 40);
    assert!(!label(ORIGIN).contains(['\n', '\u{7}']));
    assert_eq!(label(OTHER), "Browser");
}

#[test]
fn a_revoked_token_never_works_again() {
    let door = Door::new();
    let token = door.pair();
    assert_eq!(door.authed("GET", "/v1/targets", &token).send().status, 200);
    let id = door.shared.store.lock().unwrap().infos()[0].id.clone();
    assert!(door.shared.store.lock().unwrap().revoke(&id).unwrap());
    let reply = door.authed("GET", "/v1/targets", &token).send();
    assert_eq!(reply.status, 401);
    assert!(reply.error().contains("revoked"), "{}", reply.body);
    let again = door
        .authed("POST", "/v1/capture", &token)
        .json(r#"{"url":"https://example.com/a"}"#)
        .send();
    assert_eq!(again.status, 401);
}

#[test]
fn pairing_again_replaces_the_token_and_only_so_many_extensions_pair() {
    let door = Door::new();
    let first = door.pair();
    let second = door.pair();
    assert_ne!(first, second);
    assert_eq!(door.authed("GET", "/v1/targets", &first).send().status, 401);
    assert_eq!(
        door.authed("GET", "/v1/targets", &second).send().status,
        200
    );
    assert_eq!(door.shared.store.lock().unwrap().infos().len(), 1);

    // Eight in all; a ninth is told to revoke one.
    for n in 0..7 {
        let origin = format!(
            "chrome-extension://{}",
            ((b'b' + n) as char).to_string().repeat(32)
        );
        door.pair_from(&origin);
    }
    assert_eq!(door.shared.store.lock().unwrap().infos().len(), 8);
    door.offer(CODE);
    let ninth = door
        .req("POST", "/v1/pair")
        .origin(&format!("chrome-extension://{}", "p".repeat(32)))
        .json(&format!(r#"{{"code":"{CODE}"}}"#))
        .send();
    assert_eq!(ninth.status, 409, "{}", ninth.body);
    assert!(ninth.error().contains("Revoke"));
}

#[test]
fn the_places_are_named_and_never_carry_a_note_s_text() {
    let door = Door::new();
    let token = door.pair();
    let reply = door.authed("GET", "/v1/targets", &token).send();
    assert_eq!(reply.status, 200);
    let body = reply.json();
    assert_eq!(body["inbox"]["name"], "Captures");
    assert!(!body["vault"].as_str().unwrap().is_empty());
    let projects = body["projects"].as_array().unwrap();
    let project = projects
        .iter()
        .find(|p| p["id"] == "photo-organiser")
        .unwrap();
    assert!(!project["name"].as_str().unwrap().is_empty());
    for p in projects {
        let mut keys: Vec<&String> = p.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["id", "name"]);
    }
    let pages = body["pages"].as_array().unwrap();
    assert!(!pages.is_empty() && pages.len() <= 15);
    for page in pages {
        let mut keys: Vec<&String> = page.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["path", "title"]);
        assert!(page["path"].as_str().unwrap().ends_with(".md"));
    }
    let mut top: Vec<&String> = body.as_object().unwrap().keys().collect();
    top.sort();
    assert_eq!(top, ["inbox", "pages", "projects", "vault"]);
}

#[test]
fn a_capture_is_one_commit_marked_as_from_the_extension_that_undo_takes_back() {
    let door = Door::new();
    let token = door.pair();
    let before = door.commits();
    let reply = capture(
        &door,
        &token,
        r##"{"url":"https://example.com/guide/slip-box","title":"Slip-box basics",
            "html":"<p>One idea per <a href=\"/notes\">note</a>.</p><p>Then <a href=\"javascript:alert(1)\">link</a> it.</p>",
            "tags":["reading","#rust"],"target":{"kind":"inbox"}}"##,
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    assert_eq!(body["ok"], true);
    assert_eq!(body["title"], "Slip-box basics");
    assert_eq!(body["place"], "Captures");
    let path = body["path"].as_str().unwrap().to_owned();
    assert_eq!(path, "inbox/slip-box-basics.md");

    let after = door.commits();
    assert_eq!(after.len(), before.len() + 1, "one commit");
    assert_eq!(after[0], "capture: Slip-box basics");
    let note = door.kasten.read(&path).unwrap();
    assert_eq!(note.meta.props["via"], "extension");
    assert_eq!(note.meta.props["site"], "example.com");
    assert_eq!(note.meta.tags, ["capture", "reading", "rust"]);
    assert!(!note.text.contains("javascript:"));
    assert!(
        note.text
            .contains("One idea per [note](https://example.com/notes).")
    );
    // The window was told which files were written.
    assert_eq!(
        door.told.lock().unwrap().as_slice(),
        [vec![path.clone(), "tags/capture.yaml".to_owned()]]
    );

    // Undo takes the capture back.
    let id = door.kasten.log(None, 1).unwrap()[0].id.clone();
    door.kasten.undo_commit(&id, Instant::now()).unwrap();
    assert!(!door.vault.join(&path).exists());
}

#[test]
fn a_capture_goes_to_a_project_or_is_quoted_into_a_page() {
    let door = Door::new();
    let token = door.pair();
    let in_project = capture(
        &door,
        &token,
        r#"{"url":"https://example.com/a","title":"For the project","text":"Words.","target":{"kind":"project","project":"photo-organiser"}}"#,
    );
    assert_eq!(in_project.status, 200, "{}", in_project.body);
    assert_eq!(in_project.json()["place"], "photo-organiser");
    let path = in_project.json()["path"].as_str().unwrap().to_owned();
    assert_eq!(path, "projects/photo-organiser/cards/for-the-project.md");
    assert_eq!(
        door.kasten.read(&path).unwrap().meta.project.as_deref(),
        Some("photo-organiser")
    );

    // The page's text after its front matter (which Kasten stamps with the time).
    let body_of = |text: &str| text.split_once("---\n# Photo").unwrap().1.to_owned();
    let page_before = body_of(&door.kasten.read(ROADMAP).unwrap().text);
    let quoted = capture(
        &door,
        &token,
        &format!(
            r#"{{"url":"https://example.com/b","title":"A quote","text":"Quote me.","target":{{"kind":"page","path":"{ROADMAP}"}}}}"#
        ),
    );
    assert_eq!(quoted.status, 200, "{}", quoted.body);
    assert_eq!(quoted.json()["path"], ROADMAP);
    let page_after = body_of(&door.kasten.read(ROADMAP).unwrap().text);
    assert!(page_after.starts_with(page_before.trim_end()));
    assert!(page_after.contains("> Quote me."));
    assert_eq!(door.commits()[0], "append: Photo organiser roadmap");
}

#[test]
fn a_capture_that_cannot_be_kept_writes_nothing() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    let schema = fs::read_to_string(door.vault.join("tags/capture.yaml")).unwrap();
    for (what, body) in [
        ("a script address", r#"{"url":"javascript:alert(1)"}"#),
        ("a file address", r#"{"url":"file:///etc/passwd"}"#),
        (
            "an address with a password",
            r#"{"url":"https://u:p@example.com/"}"#,
        ),
        (
            "nothing in the selection",
            r#"{"url":"https://example.com/","html":"<script>x()</script>"}"#,
        ),
        (
            "a bad tag",
            r#"{"url":"https://example.com/","tags":["a b"]}"#,
        ),
        (
            "a project that is not there",
            r#"{"url":"https://example.com/","target":{"kind":"project","project":"nowhere"}}"#,
        ),
        (
            "a page that is not there",
            r#"{"url":"https://example.com/","target":{"kind":"page","path":"inbox/not-there.md"}}"#,
        ),
    ] {
        let reply = capture(&door, &token, body);
        assert!(
            matches!(reply.status, 404 | 422),
            "{what}: {} {}",
            reply.status,
            reply.body
        );
        assert!(!reply.error().is_empty(), "{what}");
    }
    assert_eq!(door.commits(), commits);
    assert!(
        door.told.lock().unwrap().is_empty(),
        "the window heard nothing"
    );
    assert_eq!(
        fs::read_to_string(door.vault.join("tags/capture.yaml")).unwrap(),
        schema
    );
}

#[test]
fn the_extension_cannot_read_change_or_delete_anything() {
    // The routes are the whole surface: nothing else answers, with a token or not.
    let door = Door::new();
    let token = door.pair();
    for (method, path) in [
        ("GET", "/v1/notes"),
        ("GET", "/v1/notes/inbox/x.md"),
        ("GET", "/v1/search?q=a"),
        ("PUT", "/v1/notes/inbox/x.md"),
        ("DELETE", "/v1/notes/inbox/x.md"),
        ("POST", "/v1/trash"),
        ("GET", "/mcp"),
        ("POST", "/mcp"),
    ] {
        let reply = door.authed(method, path, &token).json("{}").send();
        assert!(
            matches!(reply.status, 404 | 405),
            "{method} {path}: {}",
            reply.status
        );
    }
}
