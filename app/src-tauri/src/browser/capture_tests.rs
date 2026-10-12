use super::*;

const NONCE: &str = "n0nce-n0nce-n0nce";

fn started(sessions: &mut Sessions, label: &str, now: Instant) {
    sessions.begin(label, Kind::Selection, NONCE.to_owned(), now);
}

fn json(nonce: &str, text: &str) -> Vec<u8> {
    serde_json::json!({"n": nonce, "title": "T", "html": "<p>x</p>", "text": text})
        .to_string()
        .into_bytes()
}

fn chunks(nonce: &str, bytes: &[u8], size: usize) -> Vec<String> {
    let all = URL_SAFE_NO_PAD.encode(bytes);
    let pieces: Vec<&str> = all
        .as_bytes()
        .chunks(size)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect();
    let total = pieces.len();
    pieces
        .iter()
        .enumerate()
        .map(|(seq, data)| format!("{TITLE_MARK}{nonce}:{seq}:{total}:{data}"))
        .collect()
}

#[test]
fn an_answer_that_names_the_nonce_is_taken_once() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    let (answer, kind) = s.accept("web-a", &json(NONCE, "hi"), now).unwrap();
    assert_eq!((answer.text.as_str(), kind), ("hi", Kind::Selection));
    // A replay finds nothing waiting.
    assert_eq!(
        s.accept("web-a", &json(NONCE, "hi"), now).unwrap_err(),
        Refused::Unknown
    );
    assert!(!s.waiting("web-a"));
}

#[test]
fn a_wrong_nonce_or_tab_is_refused_and_does_not_cancel_the_request() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    assert_eq!(
        s.accept("web-a", &json("guess", "x"), now).unwrap_err(),
        Refused::WrongNonce
    );
    assert_eq!(
        s.accept("web-b", &json(NONCE, "x"), now).unwrap_err(),
        Refused::Unknown
    );
    assert!(s.waiting("web-a"));
    assert!(s.accept("web-a", &json(NONCE, "x"), now).is_ok());
}

#[test]
fn a_request_expires_after_the_time_it_is_given() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    let late = now + TTL + Duration::from_millis(1);
    assert_eq!(
        s.accept("web-a", &json(NONCE, "x"), late).unwrap_err(),
        Refused::Expired
    );
    assert!(!s.waiting("web-a"));
    started(&mut s, "web-a", now);
    assert!(s.accept("web-a", &json(NONCE, "x"), now + TTL).is_ok());
}

#[test]
fn a_new_click_replaces_the_old_request_and_junk_is_refused() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    s.begin("web-a", Kind::Page, "second".to_owned(), now);
    assert_eq!(
        s.accept("web-a", &json(NONCE, "x"), now).unwrap_err(),
        Refused::WrongNonce
    );
    assert!(matches!(
        s.accept("web-a", b"{not json", now),
        Err(Refused::Garbled(_))
    ));
    assert_eq!(
        s.accept("web-a", &vec![b' '; MAX_ANSWER + 1], now)
            .unwrap_err(),
        Refused::TooBig
    );
    let error = br#"{"n":"second","error":"boom"}"#;
    assert_eq!(
        s.accept("web-a", error, now).unwrap_err(),
        Refused::Garbled("boom".to_owned())
    );
    assert!(
        !s.waiting("web-a"),
        "an answer that names the nonce ends the request, even a failed one"
    );
}

#[test]
fn chunks_in_any_order_come_back_as_the_answer() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    let bytes = json(NONCE, &"é".repeat(2000));
    let titles = chunks(NONCE, &bytes, 700);
    assert!(titles.len() > 3);
    // Last first, a repeat, then the rest.
    let mut order: Vec<usize> = (0..titles.len()).rev().collect();
    order.insert(1, order[0]);
    let mut done = None;
    for (i, at) in order.iter().enumerate() {
        match s.titled("web-a", &titles[*at], now) {
            Titled::More => assert!(i < order.len() - 1, "more after the last"),
            Titled::Done(answer, kind) => {
                assert_eq!(kind, Kind::Selection);
                done = Some(answer);
            }
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(done.unwrap().text, "é".repeat(2000));
    assert!(!s.waiting("web-a"));
}

#[test]
fn titles_that_are_not_ours_are_left_alone_or_ignored() {
    let now = Instant::now();
    let mut s = Sessions::default();
    assert!(matches!(
        s.titled("web-a", "A normal title", now),
        Titled::Plain
    ));
    // A marker with nothing waiting, or with a guessed nonce, is neither a title nor an answer.
    let t = chunks(NONCE, &json(NONCE, "x"), 500).remove(0);
    assert!(matches!(s.titled("web-a", &t, now), Titled::Foreign));
    started(&mut s, "web-a", now);
    let t = chunks("guess", &json("guess", "x"), 500).remove(0);
    assert!(matches!(s.titled("web-a", &t, now), Titled::Foreign));
    assert!(matches!(
        s.titled("web-a", "kasten-capture:short", now),
        Titled::Foreign
    ));
    assert!(matches!(
        s.titled("web-a", "kasten-capture:n:x:y:z", now),
        Titled::Foreign
    ));
    assert!(s.waiting("web-a"));
    // The right nonce for another tab does nothing here.
    let t = chunks(NONCE, &json(NONCE, "x"), 500).remove(0);
    assert!(matches!(s.titled("web-b", &t, now), Titled::Foreign));
}

#[test]
fn chunks_that_disagree_or_run_over_end_the_request() {
    let now = Instant::now();
    let mut s = Sessions::default();
    started(&mut s, "web-a", now);
    assert!(matches!(
        s.titled("web-a", &format!("{TITLE_MARK}{NONCE}:0:3:AAAA"), now),
        Titled::More
    ));
    let t = format!("{TITLE_MARK}{NONCE}:1:4:AAAA");
    assert!(matches!(
        s.titled("web-a", &t, now),
        Titled::Refused(Refused::Garbled(_))
    ));
    assert!(!s.waiting("web-a"));
    started(&mut s, "web-a", now);
    let t = format!("{TITLE_MARK}{NONCE}:0:{}:AAAA", MAX_CHUNKS + 1);
    assert!(matches!(
        s.titled("web-a", &t, now),
        Titled::Refused(Refused::TooBig)
    ));
    started(&mut s, "web-a", now);
    let t = format!("{TITLE_MARK}{NONCE}:5:2:AAAA");
    assert!(matches!(
        s.titled("web-a", &t, now),
        Titled::Refused(Refused::Garbled(_))
    ));
    started(&mut s, "web-a", now);
    let long = "A".repeat(CHUNK + 1);
    let t = format!("{TITLE_MARK}{NONCE}:0:1:{long}");
    assert!(matches!(
        s.titled("web-a", &t, now),
        Titled::Refused(Refused::TooBig)
    ));
    started(&mut s, "web-a", now);
    let t = format!("{TITLE_MARK}{NONCE}:0:1:!!!");
    assert!(matches!(
        s.titled("web-a", &t, now),
        Titled::Refused(Refused::Garbled(_))
    ));
    let late = now + TTL * 2;
    started(&mut s, "web-a", now);
    let t = chunks(NONCE, &json(NONCE, "x"), 500).remove(0);
    assert!(matches!(
        s.titled("web-a", &t, late),
        Titled::Refused(Refused::Expired)
    ));
}

#[test]
fn the_navigation_that_carries_an_answer_is_read_and_checked() {
    let now = Instant::now();
    let mut s = Sessions::default();
    let url = |text: &str| Url::parse(text).unwrap();
    let carry = |n: &str, bytes: &[u8]| {
        url(&format!(
            "https://{SENTINEL_HOST}/?n={n}&d={}",
            URL_SAFE_NO_PAD.encode(bytes)
        ))
    };
    assert!(
        s.sentinel("web-a", &url("https://example.com/?n=1&d=2"), now)
            .is_none()
    );
    started(&mut s, "web-a", now);
    assert_eq!(
        s.sentinel("web-a", &carry("guess", &json("guess", "x")), now)
            .unwrap()
            .unwrap_err(),
        Refused::WrongNonce
    );
    assert!(matches!(
        s.sentinel(
            "web-a",
            &url(&format!("https://{SENTINEL_HOST}/?n={NONCE}")),
            now
        ),
        Some(Err(Refused::Garbled(_)))
    ));
    let (answer, _) = s
        .sentinel("web-a", &carry(NONCE, &json(NONCE, "via sentinel")), now)
        .unwrap()
        .unwrap();
    assert_eq!(answer.text, "via sentinel");
    // Once only.
    assert_eq!(
        s.sentinel("web-a", &carry(NONCE, &json(NONCE, "again")), now)
            .unwrap()
            .unwrap_err(),
        Refused::Unknown
    );
    started(&mut s, "web-a", now);
    let big = vec![b'a'; MAX_SLOW + 10];
    assert_eq!(
        s.sentinel("web-a", &carry(NONCE, &big), now)
            .unwrap()
            .unwrap_err(),
        Refused::TooBig
    );
    assert!(is_sentinel(&url("http://KASTEN-CAPTURE.invalid./x")));
    assert!(!is_sentinel(&url(
        "https://kasten-capture.invalid.example.com/"
    )));
}

#[test]
fn nonces_are_long_and_different() {
    let a = new_nonce().unwrap();
    let b = new_nonce().unwrap();
    assert_eq!(a.len(), 43);
    assert_ne!(a, b);
    assert!(
        a.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    );
}

#[test]
fn a_preview_is_confirmed_once_and_only_while_fresh() {
    let now = Instant::now();
    let mut p = Previews::default();
    let cap = |t: &str| WebCapture {
        title: t.to_owned(),
        ..WebCapture::default()
    };
    p.put("a".to_owned(), cap("A"), now);
    assert_eq!(p.take("a", now).unwrap().title, "A");
    assert!(p.take("a", now).is_none());
    p.put("b".to_owned(), cap("B"), now);
    assert!(
        p.take("b", now + PREVIEW_TTL + Duration::from_secs(1))
            .is_none()
    );
    for n in 0..6 {
        p.put(format!("t{n}"), cap("x"), now);
    }
    assert!(p.take("t0", now).is_none() && p.take("t1", now).is_none());
    assert!(p.take("t5", now).is_some());
    p.discard("t4");
    assert!(p.take("t4", now).is_none());
    assert!(p.take("nope", now).is_none());
}
