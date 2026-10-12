//! Fetching against a server on 127.0.0.1: what is asked, what is kept, what is
//! refused and how, and that the address never shows in a message.

use std::net::TcpListener;

use super::super::test_server::{Reply, client, ok, run, serve, status};
use super::*;

const FEED: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

#[test]
fn webcal_becomes_https_and_other_addresses_are_checked() {
    let secret = "calendar.example.com/ical/me%40example.com/private-0123abcd/basic.ics";
    assert_eq!(
        address(&format!("webcal://{secret}")).unwrap(),
        format!("https://{secret}")
    );
    assert_eq!(
        address(&format!("WEBCALS://{secret}")).unwrap(),
        format!("https://{secret}")
    );
    assert_eq!(
        address(&format!("  https://{secret}  ")).unwrap(),
        format!("https://{secret}")
    );
    assert_eq!(address(secret).unwrap(), format!("https://{secret}"));
    assert_eq!(
        address("http://192.168.1.20/cal.ics").unwrap(),
        "http://192.168.1.20/cal.ics"
    );
    for bad in [
        "",
        "   ",
        "ftp://example.com/x.ics",
        "file:///etc/passwd",
        "https://",
        "two words",
    ] {
        assert!(address(bad).is_err(), "{bad:?}");
    }
    // Too long for the keychain to keep.
    let long = format!("https://example.com/{}", "a".repeat(MAX_ADDRESS));
    assert!(address(&long).unwrap_err().contains("longer"));
}

#[test]
fn the_window_sees_the_host_and_never_the_secret() {
    let url =
        "https://calendar.google.com/calendar/ical/me%40example.com/private-0123abcd/basic.ics";
    assert_eq!(host_of(url), "calendar.google.com");
    let shown = masked(url);
    assert_eq!(shown, "calendar.google.com/….ics");
    assert!(
        !shown.contains("private") && !shown.contains("0123abcd") && !shown.contains("example.com")
    );
    assert_eq!(
        masked("https://p01-caldav.icloud.com/published/2/MTIzNDU2"),
        "p01-caldav.icloud.com/…"
    );
    // A feed on this computer or the local network is the person's to fetch.
    assert!(is_local("http://localhost:8080/cal.ics"));
    assert!(is_local("http://192.168.1.20/cal.ics"));
    assert!(is_local("http://nas/cal.ics"));
    assert!(!is_local("https://calendar.google.com/x.ics"));
}

#[test]
fn fetches_a_feed_and_remembers_what_the_server_said_about_it() {
    let (base, server) = serve(1, |_, _| {
        let mut reply = ok(FEED);
        reply.headers.push(("ETag", "\"v1\"".into()));
        reply
            .headers
            .push(("Last-Modified", "Tue, 06 Oct 2026 10:00:00 GMT".into()));
        reply
    });
    let got = run(get(
        &client(),
        &format!("{base}/cal.ics"),
        &Validators::default(),
    ))
    .unwrap();
    let Answer::Fresh { text, validators } = got else {
        panic!("a fresh copy")
    };
    assert_eq!(text, FEED);
    assert_eq!(validators.etag.as_deref(), Some("\"v1\""));
    assert_eq!(
        validators.last_modified.as_deref(),
        Some("Tue, 06 Oct 2026 10:00:00 GMT")
    );
    let heads = server.join().unwrap();
    assert!(!heads[0].to_ascii_lowercase().contains("if-none-match"));
}

#[test]
fn asks_again_only_for_a_change_and_takes_not_modified_as_unchanged() {
    let (base, server) = serve(2, |n, head| {
        let matched = head.to_ascii_lowercase().contains("if-none-match: \"v1\"");
        if n == 1 && matched {
            status(304)
        } else {
            ok(FEED)
        }
    });
    let url = format!("{base}/cal.ics");
    let have = Validators {
        etag: Some("\"v1\"".into()),
        last_modified: Some("Tue, 06 Oct 2026 10:00:00 GMT".into()),
    };
    // First request: the server gives the feed again anyway.
    assert!(matches!(
        run(get(&client(), &url, &Validators::default())).unwrap(),
        Answer::Fresh { .. }
    ));
    // Second: our validators are sent, the server says nothing changed.
    assert_eq!(run(get(&client(), &url, &have)).unwrap(), Answer::Unchanged);
    let heads = server.join().unwrap();
    let second = heads[1].to_ascii_lowercase();
    assert!(second.contains("if-none-match: \"v1\""));
    assert!(second.contains("if-modified-since: tue, 06 oct 2026 10:00:00 gmt"));
}

#[test]
fn refusals_are_in_words_and_never_show_the_address() {
    for (code, words) in [
        (404, "no calendar at that address"),
        (403, "refused the address"),
        (500, "answered 500"),
        (418, "answered 418"),
    ] {
        let (base, server) = serve(1, move |_, _| status(code));
        let url = format!("{base}/private-0123abcd/basic.ics");
        let err = run(get(&client(), &url, &Validators::default())).unwrap_err();
        assert!(err.contains(words), "{code}: {err}");
        assert!(err.contains("127.0.0.1"), "{err}");
        assert!(!err.contains("private-0123abcd"), "{err}");
        server.join().unwrap();
    }
}

#[test]
fn something_that_is_not_a_calendar_is_refused() {
    let (base, server) = serve(1, |_, _| ok("<html><body>Please sign in</body></html>"));
    let err = run(get(&client(), &format!("{base}/x"), &Validators::default())).unwrap_err();
    assert!(err.contains("did not give a calendar"), "{err}");
    server.join().unwrap();
}

#[test]
fn a_feed_that_stops_short_is_not_a_copy_to_keep() {
    let (base, server) = serve(1, |_, _| {
        ok("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\n")
    });
    let err = run(get(
        &client(),
        &format!("{base}/x.ics"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.contains("cut off"), "{err}");
    server.join().unwrap();
    // The end marker may be in any case, with trailing blank lines.
    let (base, server) = serve(1, |_, _| ok("begin:vcalendar\r\nend:vcalendar\r\n\r\n\r\n"));
    assert!(matches!(
        run(get(
            &client(),
            &format!("{base}/x.ics"),
            &Validators::default()
        ))
        .unwrap(),
        Answer::Fresh { .. }
    ));
    server.join().unwrap();
}

#[test]
fn a_feed_bigger_than_the_limit_is_refused_however_it_is_announced() {
    // Announced by its length.
    let (base, server) = serve(1, |_, _| Reply {
        status: 200,
        headers: vec![("Content-Length", (MAX_FEED + 1).to_string())],
        body: Vec::new(),
        open_ended: true,
    });
    let err = run(get(
        &client(),
        &format!("{base}/big.ics"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.contains("bigger than 10 MB"), "{err}");
    server.join().unwrap();
    // Not announced: stopped when it passes the limit.
    let mut body = FEED.as_bytes().to_vec();
    body.resize(MAX_FEED + 1024, b' ');
    let (base, server) = serve(1, move |_, _| Reply {
        status: 200,
        headers: vec![],
        body: body.clone(),
        open_ended: true,
    });
    let err = run(get(
        &client(),
        &format!("{base}/big.ics"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.contains("bigger than 10 MB"), "{err}");
    server.join().unwrap();
}

#[test]
fn redirects_are_followed_but_not_for_ever() {
    let (base, server) = serve(2, |n, _| {
        if n == 0 {
            Reply {
                status: 302,
                headers: vec![("Location", "/real/feed.ics".into())],
                body: Vec::new(),
                open_ended: false,
            }
        } else {
            ok(FEED)
        }
    });
    let got = run(get(
        &client(),
        &format!("{base}/old"),
        &Validators::default(),
    ))
    .unwrap();
    assert!(matches!(got, Answer::Fresh { .. }));
    let heads = server.join().unwrap();
    assert!(heads[1].starts_with("GET /real/feed.ics"));
    // A server that always redirects to itself is given up on.
    let (base, server) = serve(11, |_, _| Reply {
        status: 302,
        headers: vec![("Location", "/again".into())],
        body: Vec::new(),
        open_ended: false,
    });
    let err = run(get(
        &client(),
        &format!("{base}/loop"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.contains("Could not reach 127.0.0.1"), "{err}");
    assert!(!err.contains("/loop") && !err.contains("/again"), "{err}");
    drop(server);
}

#[test]
fn a_server_that_is_not_there_is_an_answer_not_a_hang() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let err = run(get(
        &client(),
        &format!("http://127.0.0.1:{port}/secret-token/basic.ics"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.starts_with("Could not reach 127.0.0.1"), "{err}");
    assert!(!err.contains("secret-token"), "{err}");
}
