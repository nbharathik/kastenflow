use super::*;
use serde_json::{Value, json};

const MANIFEST: &str = "\
version: 1
title: Conference tracker
kit: \"1\"
queries:
  venues:
    tag: conference
    filter:
      - key: deadline_status
        op: is
        value: announced
    sort:
      - key: paper_deadline
        dir: desc
    limit: 50
    later: kept
views:
  deadlines:
    title: Deadlines
    entry: deadlines.html
    hint: kept too
size:
  height: 600
  maxHeight: 900
  extra: kept as well
future: 3
";

fn manifest() -> SmartManifest {
    serde_saphyr::from_str(MANIFEST).unwrap()
}

// ---- manifest ----

#[test]
fn manifest_reads_every_field() {
    let m = manifest();
    assert_eq!(m.version, 1);
    assert_eq!(m.title, "Conference tracker");
    assert_eq!(m.kit, "1");
    let q = &m.queries["venues"];
    assert_eq!(q.tag, "conference");
    assert_eq!(q.filter.len(), 1);
    assert_eq!(q.filter[0].op, FilterOp::Is);
    assert_eq!(q.filter[0].value, Some(json!("announced")));
    assert_eq!(q.sort[0].dir, SortDir::Desc);
    assert_eq!(q.limit, Some(50));
    let v = &m.views["deadlines"];
    assert_eq!(v.title.as_deref(), Some("Deadlines"));
    assert_eq!(v.entry.as_deref(), Some("deadlines.html"));
    let size = m.size.as_ref().unwrap();
    assert_eq!((size.height, size.max_height), (Some(600), Some(900)));
    assert_eq!(m.validate(), Vec::<String>::new());
}

#[test]
fn manifest_keeps_unknown_keys_at_every_level() {
    let m = manifest();
    assert_eq!(m.extra.get("future"), Some(&json!(3)));
    assert_eq!(m.queries["venues"].extra.get("later"), Some(&json!("kept")));
    assert_eq!(
        m.views["deadlines"].extra.get("hint"),
        Some(&json!("kept too"))
    );
    assert_eq!(
        m.size.as_ref().unwrap().extra.get("extra"),
        Some(&json!("kept as well"))
    );
    let text = serde_saphyr::to_string(&m).unwrap();
    for key in ["future", "later", "hint", "extra"] {
        assert!(text.contains(key), "{key} lost in:\n{text}");
    }
}

#[test]
fn manifest_round_trips_through_yaml_and_json() {
    let m = manifest();
    let yaml = serde_saphyr::to_string(&m).unwrap();
    let again: SmartManifest = serde_saphyr::from_str(&yaml).unwrap();
    assert_eq!(again, m);
    let json = serde_json::to_string(&m).unwrap();
    let back: SmartManifest = serde_json::from_str(&json).unwrap();
    assert_eq!(back, m);
}

#[test]
fn minimal_manifest_gets_defaults() {
    let m: SmartManifest = serde_saphyr::from_str("title: Plain\n").unwrap();
    assert_eq!(m.version, MANIFEST_VERSION);
    assert_eq!(m.kit, DEFAULT_KIT);
    assert!(m.queries.is_empty() && m.views.is_empty() && m.size.is_none());
    assert_eq!(m.validate(), Vec::<String>::new());
    let text = serde_saphyr::to_string(&m).unwrap();
    assert!(
        !text.contains("queries") && !text.contains("size"),
        "{text}"
    );
}

#[test]
fn validate_names_each_problem() {
    let mut m = manifest();
    m.version = 9;
    m.title = "  ".into();
    m.kit = String::new();
    m.queries.insert("bad name".into(), QuerySpec::for_tag("x"));
    m.queries.insert("empty".into(), QuerySpec::for_tag(" "));
    let mut zero = QuerySpec::for_tag("x");
    zero.limit = Some(0);
    m.queries.insert("zero".into(), zero);
    m.views.insert("../up".into(), SmartView::default());
    let view = SmartView {
        entry: Some("../escape.html".into()),
        ..SmartView::default()
    };
    m.views.insert("escape".into(), view);
    m.size = Some(SmartSize {
        height: Some(700),
        max_height: Some(600),
        ..SmartSize::default()
    });
    let problems = m.validate();
    assert_eq!(problems.len(), 9, "{problems:#?}");
}

// ---- layout ----

#[test]
fn constants_match_the_plan() {
    assert_eq!(SMART_DIR_SUFFIX, ".smart");
    assert_eq!(MAX_FILE_BYTES, 2 * 1024 * 1024);
    assert_eq!(MAX_TOTAL_BYTES, 10 * 1024 * 1024);
    assert_eq!(MAX_CALLS_PER_SECOND, 50);
    assert_eq!(MAX_ANSWER_BYTES, 2 * 1024 * 1024);
    assert_eq!(WATCH_DEBOUNCE_MS, 300);
    assert_eq!(MAX_ERROR_RECORDS, 50);
    assert!(CSP.contains("default-src 'none'") && CSP.contains("connect-src 'none'"));
    assert!(CSP.ends_with("; base-uri 'none'; form-action 'none'"));
    assert!(!CSP.contains("https:"));
    // Web pictures change the pictures' rule and nothing else.
    assert_eq!(csp(true).replace(" https:", ""), CSP);
    assert!(csp(true).contains("img-src 'self' data: blob: https:"));
    assert_eq!(csp(false), CSP);
}

#[test]
fn allowed_paths() {
    for ok in [
        "index.html",
        "app.js",
        "css/site.CSS",
        "data/venues.json",
        "assets/a/pin.svg",
        "assets/p.png",
        "assets/p.webp",
        "smart.yaml",
    ] {
        assert!(is_allowed_path(ok), "{ok}");
    }
    for bad in [
        "",
        "/index.html",
        "../x.js",
        "a/../b.js",
        "a//b.js",
        "a\\b.js",
        "x.exe",
        "noext",
        "c:/x.js",
        "a/.hidden.js/",
        "data/x.html.php",
        ".js",
    ] {
        assert!(!is_allowed_path(bad), "{bad}");
    }
}

#[test]
fn sidecar_folder_of_a_page() {
    assert_eq!(
        sidecar_dir("projects/r/pages/tracker.md").as_deref(),
        Some("projects/r/pages/tracker.smart")
    );
    assert_eq!(sidecar_dir("tracker.md").as_deref(), Some("tracker.smart"));
    assert_eq!(sidecar_dir("notes.txt"), None);
    assert_eq!(sidecar_dir(".md"), None);
}

// ---- bridge requests ----

fn request(text: &str) -> BridgeRequest {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("{text}: {e}"))
}

#[test]
fn every_call_reads_and_round_trips() {
    let wire = [
        r#"{"id":1,"kind":"query","args":{"tag":"conference","filter":[{"key":"city","op":"is","value":"Oslo"}],"sort":[{"key":"date"}]}}"#,
        r#"{"id":2,"kind":"list","args":{"project":"research","tag":"x","type":"note"}}"#,
        r#"{"id":3,"kind":"read","args":{"id":"n1"}}"#,
        r#"{"id":4,"kind":"search","args":{"q":"oslo","limit":5}}"#,
        r#"{"id":5,"kind":"journal","args":{"date":"2026-10-22"}}"#,
        r#"{"id":6,"kind":"project"}"#,
        r#"{"id":7,"kind":"tasks","args":{"project":"research","done":false}}"#,
        r#"{"id":8,"kind":"board","args":{"path":"boards/b.board"}}"#,
        r#"{"id":9,"kind":"watch","args":{"watchId":"w1","query":{"tag":"conference"}}}"#,
        r#"{"id":10,"kind":"unwatch","args":{"watchId":"w1"}}"#,
        r#"{"id":11,"kind":"open","args":{"target":"n1"}}"#,
        r#"{"id":12,"kind":"theme"}"#,
        r#"{"id":13,"kind":"resize","args":{"px":480}}"#,
        r#"{"id":14,"kind":"log","args":{"args":["a",1,{"b":true}]}}"#,
        r#"{"id":15,"kind":"report","args":{"kind":"unhandledrejection","message":"boom","source":"smart://p/app.js","line":12}}"#,
        r#"{"id":16,"kind":"update","args":{"id":"n1","props":{"city":"Oslo","n":2}}}"#,
        r#"{"id":17,"kind":"addTags","args":{"id":"n1","tags":["a","b"]}}"#,
        r#"{"id":18,"kind":"createNote","args":{"title":"T","tags":["x"],"props":{"k":"v"},"body":"hi","project":"research"}}"#,
        r#"{"id":19,"kind":"append","args":{"id":"n1","md":"- more"}}"#,
        r#"{"id":20,"kind":"toggleTodo","args":{"id":"n1","index":2}}"#,
    ];
    for text in wire {
        let req = request(text);
        let sent: Value = serde_json::from_str(text).unwrap();
        // Optional and empty fields are left out, so the wire form comes back as sent.
        assert_eq!(serde_json::to_value(&req).unwrap(), sent, "{text}");
        let again: BridgeRequest = serde_json::from_value(sent).unwrap();
        assert_eq!(again, req);
    }
}

#[test]
fn request_kinds_are_typed() {
    assert!(matches!(
        request(r#"{"id":1,"kind":"project"}"#).call,
        BridgeCall::Project
    ));
    assert!(matches!(
        request(r#"{"id":1,"kind":"theme","args":null}"#).call,
        BridgeCall::Theme
    ));
    match request(r#"{"id":4,"kind":"append","args":{"id":"n","md":"x"}}"#).call {
        BridgeCall::Append { id, md } => assert_eq!((id.as_str(), md.as_str()), ("n", "x")),
        other => panic!("{other:?}"),
    }
    assert_eq!(request(r#"{"id":4,"kind":"read","args":{"id":"n"}}"#).id, 4);
    assert!(
        request(r#"{"id":2,"kind":"update","args":{"id":"n","props":{}}}"#)
            .call
            .is_write()
    );
    assert!(
        !request(r#"{"id":2,"kind":"read","args":{"id":"n"}}"#)
            .call
            .is_write()
    );
    assert_eq!(
        request(r#"{"id":2,"kind":"createNote","args":{"title":"T"}}"#)
            .call
            .kind(),
        "createNote"
    );
}

#[test]
fn unknown_or_malformed_requests_do_not_parse() {
    for bad in [
        r#"{"id":1,"kind":"eval","args":{}}"#,
        r#"{"kind":"project"}"#,
        r#"{"id":1,"kind":"read"}"#,
        r#"{"id":1,"kind":"read","args":{"id":3}}"#,
        r#"{"id":-1,"kind":"project"}"#,
        r#"{"id":1,"kind":"resize","args":{"px":"tall"}}"#,
    ] {
        assert!(serde_json::from_str::<BridgeRequest>(bad).is_err(), "{bad}");
    }
}

// ---- answers, events, errors ----

#[test]
fn answers_carry_a_value_or_a_typed_error() {
    let ok = BridgeAnswer::ok(3, json!([{"id": "n1"}]));
    let wire = serde_json::to_value(&ok).unwrap();
    assert_eq!(wire, json!({"id": 3, "ok": true, "value": [{"id": "n1"}]}));
    assert_eq!(serde_json::from_value::<BridgeAnswer>(wire).unwrap(), ok);
    let nothing = BridgeAnswer::ok(4, Value::Null);
    assert_eq!(
        serde_json::to_value(&nothing).unwrap(),
        json!({"id": 4, "ok": true})
    );
    assert_eq!(
        serde_json::from_value::<BridgeAnswer>(json!({"id": 4, "ok": true})).unwrap(),
        nothing
    );
    let err = BridgeAnswer::err(5, BridgeErrorCode::RateLimited, "Too many calls.");
    let wire = serde_json::to_value(&err).unwrap();
    assert_eq!(
        wire,
        json!({"id": 5, "ok": false, "error": {"code": "rate_limited", "message": "Too many calls."}})
    );
    assert_eq!(serde_json::from_value::<BridgeAnswer>(wire).unwrap(), err);
}

#[test]
fn error_codes_use_the_wire_names() {
    for (code, name) in [
        (BridgeErrorCode::RateLimited, "rate_limited"),
        (BridgeErrorCode::TooLarge, "too_large"),
        (BridgeErrorCode::Refused, "refused"),
        (BridgeErrorCode::BadRequest, "bad_request"),
        (BridgeErrorCode::NotFound, "not_found"),
    ] {
        assert_eq!(serde_json::to_value(code).unwrap(), json!(name));
        assert_eq!(
            serde_json::from_value::<BridgeErrorCode>(json!(name)).unwrap(),
            code
        );
    }
    assert!(serde_json::from_value::<BridgeErrorCode>(json!("nope")).is_err());
}

#[test]
fn events_are_tagged_by_event() {
    let watch = BridgeEvent::Watch {
        watch_id: "w1".into(),
        value: json!([1]),
    };
    assert_eq!(
        serde_json::to_value(&watch).unwrap(),
        json!({"event": "watch", "watchId": "w1", "value": [1]})
    );
    let theme = BridgeEvent::Theme {
        theme: SmartTheme::Dark,
    };
    assert_eq!(
        serde_json::to_value(&theme).unwrap(),
        json!({"event": "theme", "theme": "dark"})
    );
    let init = BridgeEvent::Init {
        page_id: "p1".into(),
        theme: SmartTheme::Light,
        view: Some("deadlines".into()),
    };
    let wire = serde_json::to_value(&init).unwrap();
    assert_eq!(
        wire,
        json!({"event": "init", "pageId": "p1", "theme": "light", "view": "deadlines"})
    );
    for e in [watch, theme, init] {
        let back: BridgeEvent = serde_json::from_value(serde_json::to_value(&e).unwrap()).unwrap();
        assert_eq!(back, e);
    }
}

#[test]
fn error_records_round_trip() {
    let rec = ErrorRecord {
        time: "2026-10-22T10:00:00Z".into(),
        kind: ErrorKind::ConsoleError,
        message: "x is not defined".into(),
        source: Some("smart://p1/app.js".into()),
        line: Some(12),
    };
    let wire = serde_json::to_value(&rec).unwrap();
    assert_eq!(wire["kind"], json!("console.error"));
    assert_eq!(serde_json::from_value::<ErrorRecord>(wire).unwrap(), rec);
    let bare = ErrorRecord {
        source: None,
        line: None,
        kind: ErrorKind::Error,
        ..rec.clone()
    };
    let wire = serde_json::to_value(&bare).unwrap();
    assert!(wire.get("source").is_none() && wire.get("line").is_none());
    let log = ErrorLog {
        records: vec![rec, bare],
    };
    let text = serde_json::to_string(&log).unwrap();
    assert_eq!(serde_json::from_str::<ErrorLog>(&text).unwrap(), log);
}
