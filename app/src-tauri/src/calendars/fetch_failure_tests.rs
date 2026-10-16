//! Feeds that do not arrive: through a proxy the computer names (which works,
//! asks for a sign-in, is down or hangs up), from a server that stalls, and
//! that the feed's address and a proxy's name and password never show in a
//! message. Nothing here reaches a real calendar service or a real proxy.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::super::client::build;
use super::super::test_server::{client, ok, run, serve, status};
use super::*;

const FEED: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
const SECRET: &str = "private-0123abcd";
/// A public-looking name no resolver is ever asked about: with a proxy, the
/// proxy is the only one that is.
const HOST: &str = "calendar.example.test";

fn through(proxy: &str) -> reqwest::Client {
    build(true, Some(reqwest::Proxy::all(proxy).unwrap())).unwrap()
}

fn feed_url(scheme: &str) -> String {
    format!("{scheme}://{HOST}/{SECRET}/basic.ics")
}

fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

#[test]
fn a_feed_goes_through_the_proxy_the_computer_names() {
    let (proxy, server) = serve(1, |_, _| ok(FEED));
    let url = feed_url("http");
    let got = run(get(&through(&proxy), &url, &Validators::default())).unwrap();
    assert!(matches!(got, Answer::Fresh { .. }));
    let heads = server.join().unwrap();
    // A proxy is asked for the whole address, and so for the host it must reach.
    assert!(
        heads[0].starts_with(&format!("GET {url} HTTP/1.1")),
        "{}",
        heads[0]
    );
    assert!(
        heads[0]
            .to_ascii_lowercase()
            .contains(&format!("host: {HOST}"))
    );
}

#[test]
fn a_proxy_that_wants_a_sign_in_is_told_in_words() {
    let (proxy, server) = serve(1, |_, _| status(407));
    let err = run(get(
        &through(&proxy),
        &feed_url("http"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(
        err.contains("proxy") && err.contains("sign-in") && err.contains(HOST),
        "{err}"
    );
    assert!(!err.contains(SECRET), "{err}");
    server.join().unwrap();
}

#[test]
fn a_proxy_that_is_down_is_an_answer_and_keeps_its_password_to_itself() {
    let proxy = format!("http://aladdin:opensesame@127.0.0.1:{}", closed_port());
    let err = run(get(
        &through(&proxy),
        &feed_url("http"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.starts_with(&format!("Could not reach {HOST}")), "{err}");
    for secret in [SECRET, "opensesame", "aladdin"] {
        assert!(!err.contains(secret), "{err}");
    }
}

#[test]
fn a_proxy_that_hangs_up_is_an_answer_not_a_hang() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        // Takes the connection and closes it without a word.
        drop(listener.accept());
    });
    let started = Instant::now();
    let err = run(get(
        &through(&proxy),
        &feed_url("http"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.starts_with(&format!("Could not reach {HOST}")), "{err}");
    assert!(!err.contains(SECRET), "{err}");
    assert!(started.elapsed() < Duration::from_secs(10));
    server.join().unwrap();
}

#[test]
fn a_proxy_that_refuses_to_tunnel_points_at_the_proxy_settings() {
    // For an https feed the proxy is asked to open a tunnel (CONNECT).
    let (proxy, server) = serve(1, |_, _| status(403));
    let err = run(get(
        &through(&proxy),
        &feed_url("https"),
        &Validators::default(),
    ))
    .unwrap_err();
    assert!(err.starts_with(&format!("Could not reach {HOST}")), "{err}");
    assert!(err.contains("proxy"), "{err}");
    assert!(!err.contains(SECRET), "{err}");
    let heads = server.join().unwrap();
    assert!(
        heads[0].starts_with(&format!("CONNECT {HOST}:443")),
        "{}",
        heads[0]
    );
}

#[test]
fn the_feed_clients_leave_the_proxy_settings_to_the_computer() {
    // Nothing that builds a feed client may turn the system's proxy off: it is
    // only the tests' own client (`test_server::client`) that does.
    assert!(
        !include_str!("client.rs").contains("no_proxy"),
        "the feed clients must follow the system proxy"
    );
    let shared = include_str!("../chat/clients.rs");
    let start = shared
        .split("pub(crate) fn web_builder")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .expect("the shared start of the web clients");
    assert!(!start.contains("no_proxy"));
}

/// A server that takes a request and says nothing for a while.
fn silent_server() -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.read(&mut [0u8; 1024]);
            thread::sleep(Duration::from_millis(1_500));
        }
    });
    (base, handle)
}

#[test]
fn a_server_that_never_answers_is_given_up_on() {
    let (base, server) = silent_server();
    let started = Instant::now();
    let err = run(get_within(
        &client(),
        &format!("{base}/{SECRET}/basic.ics"),
        &Validators::default(),
        Duration::from_millis(300),
    ))
    .unwrap_err();
    assert!(
        err.contains("did not answer in time") && err.contains("127.0.0.1"),
        "{err}"
    );
    assert!(!err.contains(SECRET), "{err}");
    assert!(started.elapsed() < Duration::from_secs(5));
    server.join().unwrap();
}

#[test]
fn a_feed_that_stops_in_the_middle_is_given_up_on_too() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.read(&mut [0u8; 1024]);
            // Announces a long feed, sends the start of it, then stalls.
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\nBEGIN:VCALENDAR\r\n",
            );
            let _ = stream.flush();
            thread::sleep(Duration::from_millis(1_500));
        }
    });
    let err = run(get_within(
        &client(),
        &format!("{base}/{SECRET}/basic.ics"),
        &Validators::default(),
        Duration::from_millis(300),
    ))
    .unwrap_err();
    assert!(err.contains("took too long"), "{err}");
    assert!(!err.contains(SECRET), "{err}");
    server.join().unwrap();
}

#[test]
fn nothing_that_looks_like_an_address_is_left_in_a_message() {
    assert_eq!(
        scrub(
            "proxy error (http://aladdin:opensesame@10.0.0.1:3128/) for https://calendar.example.test/x"
        ),
        "proxy error … for …"
    );
    assert_eq!(scrub("no address here"), "no address here");
}
