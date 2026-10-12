use std::time::Instant as Clock;

use super::*;
use crate::chat::tests::block_on;

const STATE: &str = "state-0123456789";

fn request(port: u16, target: &str) -> String {
    format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUser-Agent: test\r\n")
}

fn status(request: &str, port: u16) -> u16 {
    answer(request, port, STATE).status
}

#[test]
fn only_this_sign_ins_own_callback_ends_it() {
    let good = request(
        5000,
        "/auth/callback?code=abc&state=state-0123456789&client_id=oaiapp_X1-y",
    );
    let reply = answer(&good, 5000, STATE);
    assert_eq!(reply.status, 200);
    assert_eq!(
        reply.outcome,
        Some(Outcome::Code {
            code: "abc".into(),
            client_id: Some("oaiapp_X1-y".into())
        })
    );
    // No client in the answer is fine: an earlier sign-in's is used.
    let bare = request(5000, "/auth/callback?state=state-0123456789&code=abc");
    assert_eq!(
        answer(&bare, 5000, STATE).outcome,
        Some(Outcome::Code {
            code: "abc".into(),
            client_id: None
        })
    );

    let wrong = [
        // Somebody else's: no state, another state, a state twice.
        (request(5000, "/auth/callback?code=abc"), 400),
        (request(5000, "/auth/callback?code=abc&state=another-state-xx"), 400),
        (request(5000, "/auth/callback?code=abc&state=state-0123456789&state=state-0123456789"), 400),
        (request(5000, "/auth/callback?error=access_denied&state=nope"), 400),
        // Not the callback.
        (request(5000, "/auth/callback/?code=abc&state=state-0123456789"), 404),
        (request(5000, "/callback?code=abc&state=state-0123456789"), 404),
        (request(5000, "/auth/../auth/callback?code=abc&state=state-0123456789"), 404),
        (request(5000, "/AUTH/CALLBACK?code=abc&state=state-0123456789"), 404),
        (request(5000, "/?code=abc&state=state-0123456789"), 404),
        (request(5000, "http://127.0.0.1:5000/auth/callback?code=abc&state=state-0123456789"), 404),
        // Not a GET, not a request.
        ("POST /auth/callback?code=abc&state=state-0123456789 HTTP/1.1\r\nHost: 127.0.0.1:5000\r\n".to_owned(), 405),
        ("GET /auth/callback?code=abc&state=state-0123456789\r\nHost: 127.0.0.1:5000\r\n".to_owned(), 400),
        ("hello".to_owned(), 400),
        // Another name for this computer, another port or no name at all:
        // a web page cannot be what asks.
        ("GET /auth/callback?code=abc&state=state-0123456789 HTTP/1.1\r\nHost: localhost:5000\r\n".to_owned(), 404),
        ("GET /auth/callback?code=abc&state=state-0123456789 HTTP/1.1\r\nHost: evil.example\r\n".to_owned(), 404),
        ("GET /auth/callback?code=abc&state=state-0123456789 HTTP/1.1\r\nHost: 127.0.0.1:5001\r\n".to_owned(), 404),
        ("GET /auth/callback?code=abc&state=state-0123456789 HTTP/1.1\r\n".to_owned(), 404),
        (format!("{}Host: 127.0.0.1:5000\r\n", request(5000, "/auth/callback?code=abc&state=state-0123456789")), 404),
    ];
    for (head, expected) in wrong {
        let reply = answer(&head, 5000, STATE);
        assert_eq!(
            (reply.status, reply.outcome.is_none()),
            (expected, true),
            "{head}"
        );
    }
    assert_eq!(
        status(
            &request(5000, "/auth/callback?state=state-0123456789&code=a&code=b"),
            5000
        ),
        400
    );
}

#[test]
fn a_no_and_a_broken_answer_end_it_in_words() {
    let denied = request(
        5000,
        "/auth/callback?error=access_denied&error_description=No&state=state-0123456789",
    );
    assert_eq!(
        answer(&denied, 5000, STATE).outcome,
        Some(Outcome::Error("access_denied".into()))
    );
    // The code is kept to what a code is made of.
    let odd = request(
        5000,
        "/auth/callback?error=%3Cscript%3Ealert(1)&state=state-0123456789",
    );
    assert_eq!(
        answer(&odd, 5000, STATE).outcome,
        Some(Outcome::Error("scriptalert1".into()))
    );
    for (query, code) in [
        ("state=state-0123456789", "missing_code"),
        ("state=state-0123456789&code=", "missing_code"),
        (
            "state=state-0123456789&code=a&client_id=dynamic_agent_client",
            "registration_incomplete",
        ),
        (
            "state=state-0123456789&code=a&client_id=has%20space",
            "registration_incomplete",
        ),
        (
            "state=state-0123456789&code=a&client_id=%3Cb%3E",
            "registration_incomplete",
        ),
    ] {
        let head = request(5000, &format!("/auth/callback?{query}"));
        assert_eq!(
            answer(&head, 5000, STATE).outcome,
            Some(Outcome::Error(code.into())),
            "{query}"
        );
    }
}

/// What a connection to the listener reads back.
async fn ask(port: u16, bytes: &[u8]) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let _ = stream.write_all(bytes).await;
    let mut out = Vec::new();
    let _ = stream.read_to_end(&mut out).await;
    String::from_utf8_lossy(&out).into_owned()
}

fn port_of(listener: &Listener) -> u16 {
    listener.port
}

#[test]
fn the_listener_waits_through_strays_and_ends_with_the_real_callback() {
    block_on(async {
        let listener = Listener::bind(0).await.unwrap();
        let port = port_of(&listener);
        assert_eq!(
            listener.redirect_uri(),
            format!("http://127.0.0.1:{port}/auth/callback")
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let stop = Arc::clone(&cancel);
        let waiting =
            tokio::spawn(async move { listener.wait(STATE, &stop, Duration::from_secs(30)).await });

        let wrong_state = format!("{}\r\n", request(port, "/auth/callback?code=x&state=other"));
        assert!(
            ask(port, wrong_state.as_bytes())
                .await
                .starts_with("HTTP/1.1 400")
        );
        let wrong_host =
            "GET /auth/callback?code=x&state=state-0123456789 HTTP/1.1\r\nHost: localhost\r\n\r\n";
        assert!(
            ask(port, wrong_host.as_bytes())
                .await
                .starts_with("HTTP/1.1 404")
        );
        let post = format!("POST /auth/callback HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
        assert!(ask(port, post.as_bytes()).await.starts_with("HTTP/1.1 405"));
        // More than 8 KB of headers.
        let big = format!(
            "{}X-Pad: {}\r\n\r\n",
            request(port, "/auth/callback"),
            "a".repeat(9000)
        );
        assert!(ask(port, big.as_bytes()).await.starts_with("HTTP/1.1 431"));
        // A connection that says nothing, then goes, changes nothing.
        drop(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
        assert!(!waiting.is_finished(), "strays do not end the sign-in");

        let good = format!(
            "{}Connection: close\r\n\r\n",
            request(
                port,
                "/auth/callback?code=the-code&state=state-0123456789&client_id=oaiapp_1"
            )
        );
        let page = ask(port, good.as_bytes()).await;
        assert!(page.starts_with("HTTP/1.1 200 OK"), "{page}");
        assert!(page.contains("You can close this tab"));
        let lower = page.to_lowercase();
        assert!(!lower.contains("<script"), "no scripts on the page");
        assert!(
            lower.contains("cache-control: no-store")
                && lower.contains("referrer-policy: no-referrer")
        );
        assert!(lower.contains("content-security-policy: default-src 'none'"));
        assert!(
            !page.contains("the-code"),
            "the page does not echo the code"
        );
        assert_eq!(
            waiting.await.unwrap(),
            Outcome::Code {
                code: "the-code".into(),
                client_id: Some("oaiapp_1".into())
            }
        );
        // The listener is gone with the sign-in.
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    });
}

#[test]
fn a_no_from_the_person_comes_through_and_the_listener_closes() {
    block_on(async {
        let listener = Listener::bind(0).await.unwrap();
        let port = port_of(&listener);
        let waiting = tokio::spawn(async move {
            let cancel = AtomicBool::new(false);
            listener.wait(STATE, &cancel, Duration::from_secs(30)).await
        });
        let denied = format!(
            "{}\r\n",
            request(
                port,
                "/auth/callback?error=access_denied&state=state-0123456789"
            )
        );
        let page = ask(port, denied.as_bytes()).await;
        assert!(page.contains("did not finish"), "{page}");
        assert_eq!(
            waiting.await.unwrap(),
            Outcome::Error("access_denied".into())
        );
    });
}

#[test]
fn it_runs_out_and_can_be_stopped() {
    block_on(async {
        let started = Clock::now();
        let listener = Listener::bind(0).await.unwrap();
        let cancel = AtomicBool::new(false);
        let outcome = listener
            .wait(STATE, &cancel, Duration::from_millis(300))
            .await;
        assert_eq!(outcome, Outcome::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));

        let listener = Listener::bind(0).await.unwrap();
        let port = port_of(&listener);
        let cancel = Arc::new(AtomicBool::new(false));
        let stop = Arc::clone(&cancel);
        let waiting =
            tokio::spawn(async move { listener.wait(STATE, &stop, Duration::from_secs(60)).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(waiting.await.unwrap(), Outcome::Cancelled);
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    });
}
