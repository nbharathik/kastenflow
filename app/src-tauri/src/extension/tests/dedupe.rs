//! A page that is already saved is told, not saved again: the capture route
//! answers 409 with the cards it is saved in, writes nothing, and a request
//! that says `again` keeps a snapshot that points back at the first card.

use std::fs;

use super::{Door, Reply};

const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
const FIRST: &str = r#"{"url":"https://example.com/guide/slip-box","title":"Slip-box basics","text":"One idea per note."}"#;

fn send(door: &Door, token: &str, body: &str) -> Reply {
    door.authed("POST", "/v1/capture", token).json(body).send()
}

#[test]
fn the_same_page_again_is_told_and_nothing_is_written() {
    let door = Door::new();
    let token = door.pair();
    let first = send(&door, &token, FIRST);
    assert_eq!(first.status, 200, "{}", first.body);
    let path = first.json()["path"].as_str().unwrap().to_owned();
    let commits = door.commits();
    let told = door.told.lock().unwrap().len();
    let text = fs::read_to_string(door.vault.join(&path)).unwrap();

    for again in [
        FIRST,
        r#"{"url":"http://www.example.com/guide/slip-box/?utm_source=x#top","title":"Another title","html":"<p>Changed.</p>"}"#,
        r#"{"url":"https://example.com/guide/slip-box","target":{"kind":"project","project":"photo-organiser"}}"#,
    ] {
        let reply = send(&door, &token, again);
        assert_eq!(reply.status, 409, "{}", reply.body);
        assert!(!reply.has_cors());
        assert!(reply.error().starts_with("Already saved"), "{}", reply.body);
        let existing = reply.json()["existing"].as_array().unwrap().clone();
        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0]["path"], path.as_str());
        assert_eq!(existing[0]["title"], "Slip-box basics");
        let mut keys: Vec<&String> = existing[0].as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["captured", "path", "title"]);
    }
    assert_eq!(door.commits(), commits);
    assert_eq!(
        door.told.lock().unwrap().len(),
        told,
        "the window heard nothing"
    );
    assert_eq!(fs::read_to_string(door.vault.join(&path)).unwrap(), text);
}

#[test]
fn again_keeps_a_snapshot_that_points_back_and_leaves_the_first_alone() {
    let door = Door::new();
    let token = door.pair();
    let first = send(&door, &token, FIRST);
    let path = first.json()["path"].as_str().unwrap().to_owned();
    let id = door.kasten.read(&path).unwrap().meta.id.unwrap();
    let text = fs::read_to_string(door.vault.join(&path)).unwrap();
    let commits = door.commits();

    let reply = send(
        &door,
        &token,
        r#"{"url":"https://example.com/guide/slip-box/","title":"Slip-box basics","text":"The page changed.","again":true}"#,
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    let second = reply.json()["path"].as_str().unwrap().to_owned();
    assert_ne!(second, path);
    let note = door.kasten.read(&second).unwrap();
    assert_eq!(note.meta.props["snapshot_of"], id.as_str());
    assert_eq!(note.meta.props["via"], "extension");
    assert_eq!(door.commits().len(), commits.len() + 1);
    assert_eq!(fs::read_to_string(door.vault.join(&path)).unwrap(), text);
    // Both are now what the page is saved as.
    assert_eq!(
        door.kasten
            .captured("https://example.com/guide/slip-box")
            .unwrap()
            .len(),
        2
    );
    // A third time is still told, and names both.
    let third = send(&door, &token, FIRST);
    assert_eq!(third.status, 409);
    assert_eq!(third.json()["existing"].as_array().unwrap().len(), 2);
}

#[test]
fn again_on_a_new_page_is_just_a_capture_and_a_quote_is_never_held_back() {
    let door = Door::new();
    let token = door.pair();
    let fresh = send(
        &door,
        &token,
        r#"{"url":"https://example.com/new","text":"Words.","again":true}"#,
    );
    assert_eq!(fresh.status, 200, "{}", fresh.body);
    let path = fresh.json()["path"].as_str().unwrap().to_owned();
    assert!(
        door.kasten
            .read(&path)
            .unwrap()
            .meta
            .props
            .get("snapshot_of")
            .is_none()
    );

    // A quote added to a page is a different thing from a second card.
    send(&door, &token, FIRST);
    let quoted = send(
        &door,
        &token,
        &format!(
            r#"{{"url":"https://example.com/guide/slip-box","text":"Quote me.","target":{{"kind":"page","path":"{ROADMAP}"}}}}"#
        ),
    );
    assert_eq!(quoted.status, 200, "{}", quoted.body);
    assert_eq!(quoted.json()["path"], ROADMAP);
}

#[test]
fn again_must_be_true_or_false() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    for bad in [r#""yes""#, "1", "null"] {
        let reply = send(
            &door,
            &token,
            &format!(r#"{{"url":"https://example.com/x","text":"Words.","again":{bad}}}"#),
        );
        assert_eq!(reply.status, 400, "{bad}: {}", reply.body);
    }
    assert_eq!(door.commits(), commits);
}
