//! What the `smart` scheme refuses: ways out of a page's folder, ids that are
//! not a smart page's, and files a folder may not hold.

use std::fs;

use tauri::http::StatusCode;

use super::protocol::{assert_safe_headers, get, text};
use super::{add_page, smart};
use kasten_core::smart::CSP;

fn refused(status: StatusCode) -> bool {
    matches!(status, StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND)
}

#[test]
fn a_path_that_could_leave_the_pages_folder_is_refused() {
    let s = smart();
    let (_, other) = add_page(s.k(), "Neighbour", &super::files());
    let id = &s.id;
    for path in [
        format!("/{id}/../{other}/index.html"),
        format!("/{id}/%2e%2e/{other}/index.html"),
        format!("/{id}/%2E%2E/%2e%2e/{other}/app.js"),
        format!("/{id}/assets/../../{other}/app.js"),
        format!("/{id}/data%2f..%2f..%2f{other}%2fapp.js"),
        format!("/{id}/%2e%2e%2f{other}%2fapp.js"),
        format!("/{id}/..%5c{other}%5capp.js"),
        format!("/{id}%2f..%2f{other}%2findex.html"),
        format!("/{id}/..%5Capp.js"),
        format!("/{id}/assets%5C..%5Capp.js"),
        // Encoded twice: the second layer is text, never decoded again.
        format!("/{id}/%252e%252e/{other}/app.js"),
        format!("/{id}/%252e%252e%252f{other}%252fapp.js"),
        format!("/{id}/..%255c{other}%255capp.js"),
        format!("/{id}/%252f%252e%252e"),
        // Odd spellings of a dot.
        format!("/{id}/%2e/index.html"),
        format!("/{id}/.%2e/{other}/app.js"),
        format!("/{id}/%2e./{other}/app.js"),
        format!("/{id}/....//{other}/app.js"),
        format!("/{id}//index.html"),
        format!("/{id}/./index.html"),
        format!("/{id}/assets//pin.svg"),
        format!("/{id}/index.html/"),
        format!("/{id}/index.html//"),
        // Drives, streams, devices.
        format!("/{id}/c:/windows/win.ini"),
        format!("/{id}/C%3A%2Fwindows%2Fwin.ini"),
        format!("/{id}/c%3a%5cwindows%5cwin.ini"),
        format!("/{id}/index.html:stream"),
        format!("/{id}/index.html::$DATA"),
        format!("/{id}/CON"),
        format!("/{id}/NUL.js"),
        format!("/{id}/aux.html"),
        // A network share, in each spelling.
        format!("/{id}/%5c%5cserver%5cshare%5cx.js"),
        format!("/{id}//server/share/x.js"),
        // NUL, control characters, bad bytes, bad escapes.
        format!("/{id}/index.html%00.png"),
        format!("/{id}/%00"),
        format!("/{id}/%0a"),
        format!("/{id}/%0d%0aX-Evil:%20yes"),
        format!("/{id}/%1b[31m.js"),
        format!("/{id}/%7f.js"),
        format!("/{id}/%ff"),
        format!("/{id}/%c0%ae%c0%ae/{other}/app.js"),
        format!("/{id}/%zz"),
        format!("/{id}/%"),
        format!("/{id}/%2"),
        // Hidden parts, whatever their spelling.
        format!("/{id}/.hidden.js"),
        format!("/{id}/assets/.hidden/pin.svg"),
        format!("/{id}/%2ehidden.js"),
        format!("/{id}/.git/config"),
        format!("/{id}/.kasten/config.yaml"),
        // Names that other systems read as another file.
        format!("/{id}/INDEX.HTM~"),
        format!("/{id}/app.js%20"),
        format!("/{id}/app.js."),
        format!("/{id}/app.js%20."),
        format!("/{id}/app.js.%20"),
        format!("/{id}/index.html%20"),
        format!("/{id}/assets./pin.svg"),
        format!("/{id}/assets%20/pin.svg"),
        format!("/{id}/INDEX~1.HTML"),
        "/../etc/passwd".to_owned(),
        "/%2e%2e/etc/passwd".to_owned(),
        format!("/{}/../{}", s.path.replace('/', "%2f"), "x"),
        format!("/{}/index.html", s.path),
        format!("/{}/index.html", s.path.replace(".md", ".smart")),
        format!("/{}", s.path),
        // The page's own note, and the vault's private folders, by every route a path can take.
        format!("/{id}/../../{}", s.path),
        format!("/{id}/%2e%2e/%2e%2e/.kasten/config.yaml"),
        format!("/{id}/%2e%2e/%2e%2e/.git/HEAD"),
    ] {
        let response = get(&s, &path);
        assert!(refused(response.status()), "{path}: {}", response.status());
        assert_safe_headers(&response, CSP, &path);
        // Nothing of the page's code, the neighbour's, or the page's own note comes back.
        let body = text(&response);
        assert!(!body.contains("window.app"), "{path}: {body}");
        assert!(!body.contains("layout"), "{path}: {body}");
        assert!(!body.contains("[core]"), "{path}: {body}");
    }
}

#[test]
fn a_query_a_fragment_or_a_long_address_changes_nothing() {
    let s = smart();
    let id = &s.id;
    let plain = get(&s, &format!("/{id}/app.js"));
    assert_eq!(plain.status(), StatusCode::OK);
    // The query is not part of the path: nothing in it picks a file.
    for suffix in [
        "?../../x",
        "?/../../x.js",
        "?%2e%2e/%2e%2e/x",
        "?file=/etc/passwd",
        "#../x",
        "?a=b#../../c",
        "?",
        "?%00",
    ] {
        let response = get(&s, &format!("/{id}/app.js{suffix}"));
        assert_eq!(response.status(), StatusCode::OK, "{suffix}");
        assert_eq!(response.body(), plain.body(), "{suffix}");
        assert_safe_headers(&response, CSP, suffix);
    }
    // Very long names and very many parts (an address is at most 64 KB): refused, and with the same headers.
    let long = "a".repeat(60_000);
    let many = vec!["a"; 15_000].join("/");
    let escaped = "%2e".repeat(15_000);
    for path in [
        format!("/{id}/{long}.js"),
        format!("/{long}/index.html"),
        format!("/{id}/{many}/x.js"),
        format!("/{id}/{escaped}"),
        format!("/{id}/{}", "../".repeat(10_000)),
    ] {
        let response = get(&s, &path);
        assert!(refused(response.status()), "{}", response.status());
        assert_safe_headers(&response, CSP, "a long address");
    }
}

#[test]
fn a_made_up_id_serves_nothing_and_a_page_is_not_reached_by_its_path() {
    let s = smart();
    let (other_path, other) = add_page(s.k(), "Other", &[("index.html", b"<p>other</p>".to_vec())]);
    // The id of a note that is not a smart page, one that is made up, and one that is not an id.
    let plain = s
        .k()
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.id.is_some() && n.path != s.path && n.path != other_path)
        .unwrap();
    for id in [
        plain.id.unwrap(),
        "01ZZZZZZZZZZZZZZZZZZZZZZZZ".to_owned(),
        "nobody".to_owned(),
        "a%20b".to_owned(),
        "x".repeat(200),
        other.clone(),
    ] {
        assert_eq!(
            get(&s, &format!("/{id}/index.html")).status(),
            StatusCode::NOT_FOUND,
            "{id}"
        );
    }
    // A page's path is not an id.
    assert_eq!(
        get(
            &s,
            &format!("/{}/index.html", other_path.replace('/', "%2F"))
        )
        .status(),
        StatusCode::BAD_REQUEST
    );
    // The case of an id is not ignored.
    assert_eq!(
        get(&s, &format!("/{}/index.html", s.id.to_lowercase())).status(),
        if s.id == s.id.to_lowercase() {
            StatusCode::OK
        } else {
            StatusCode::NOT_FOUND
        }
    );
}

#[test]
fn a_page_must_be_a_smart_page_and_a_file_one_a_folder_may_hold() {
    let s = smart();
    let dir = s.vault.dir.join(s.path.replace(".md", ".smart"));
    // Files put there by hand that a folder may not hold are never served.
    for name in [
        "tool.exe",
        "module.wasm",
        "notes.md",
        "backup.html~",
        "noext",
        ".hidden.js",
        "page.htm",
        "x.svgz",
        "run.bat",
        "run.ps1",
    ] {
        fs::write(dir.join(name), "evil").unwrap();
        let response = get(&s, &format!("/{}/{name}", s.id));
        assert!(refused(response.status()), "{name}: {}", response.status());
        assert!(!text(&response).contains("evil"));
    }
    // A file in a folder that holds files a folder may not hold is served or not by its own name.
    fs::create_dir_all(dir.join(".secret")).unwrap();
    fs::write(dir.join(".secret/inside.js"), "evil").unwrap();
    assert!(refused(
        get(&s, &format!("/{}/.secret/inside.js", s.id)).status()
    ));
    // Nor one over the size a file may be.
    fs::write(dir.join("big.json"), vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
    assert_eq!(
        get(&s, &format!("/{}/big.json", s.id)).status(),
        StatusCode::NOT_FOUND
    );
    // A folder is never listed, and a name in a folder that is not there gives nothing.
    for path in [
        format!("/{}", s.id),
        format!("/{}/", s.id),
        format!("/{}/assets", s.id),
        format!("/{}/assets/", s.id),
        format!("/{}/nothing/here.js", s.id),
    ] {
        let response = get(&s, &path);
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert!(!text(&response).contains("pin.svg"));
    }
    // A page that is no longer a smart page serves nothing.
    s.k()
        .set_meta(
            &kasten_core::history::Actor::Human,
            &s.path,
            "layout",
            None,
            kasten_core::Instant::now(),
        )
        .unwrap();
    assert_eq!(
        get(&s, &format!("/{}/index.html", s.id)).status(),
        StatusCode::NOT_FOUND
    );
}

#[cfg(unix)]
#[test]
fn a_link_in_the_pages_folder_is_never_followed() {
    let s = smart();
    let dir = s.vault.dir.join(s.path.replace(".md", ".smart"));
    let outside = s.vault.dir.join("outside-secret.txt");
    fs::write(&outside, "outside").unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("link.txt")).unwrap();
    std::os::unix::fs::symlink(&s.vault.dir, dir.join("up")).unwrap();
    for path in [
        "link.txt",
        "up/outside-secret.txt",
        "up/.kasten/config.yaml",
    ] {
        let response = get(&s, &format!("/{}/{path}", s.id));
        assert!(refused(response.status()), "{path}");
        assert!(!text(&response).contains("outside"));
    }
}
