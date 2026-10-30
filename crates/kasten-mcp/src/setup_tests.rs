use super::*;

const FIXTURE: &str = include_str!("../../../fixtures/mcp-setup.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the fixture is JSON")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn every_line_is_what_the_shared_fixture_says_and_settings_says_the_same() {
    let fixture = fixture();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 4);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let server = Server {
            command: case["command"].as_str().unwrap().to_owned(),
            args: strings(&case["args"]),
        };
        let vault = case["vault"].as_str().unwrap();
        assert_eq!(
            claude_code(&server, vault),
            case["claudeCode"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(mcp_config(&server, vault), case["mcpConfig"], "{name}");
        assert_eq!(
            http_command(&server, vault),
            case["httpCommand"].as_str().unwrap(),
            "{name}"
        );
    }
    assert_eq!(
        http_url(crate::DEFAULT_PORT),
        fixture["url"].as_str().unwrap()
    );
    assert_eq!(url_config(crate::DEFAULT_PORT), fixture["urlConfig"]);
    for pair in fixture["tokenPaths"].as_array().unwrap() {
        assert_eq!(
            token_path(pair[0].as_str().unwrap()),
            pair[1].as_str().unwrap()
        );
    }
}

#[test]
fn the_app_is_asked_to_serve_with_mcp_and_the_command_line_program_is_not() {
    let app = Server::of("/usr/bin/kasten-app", true);
    assert_eq!(app.args, ["--mcp"]);
    assert_eq!(
        claude_code(&app, "/v"),
        "claude mcp add --scope user kasten -- /usr/bin/kasten-app --mcp --vault \"/v\""
    );
    assert!(Server::of("/usr/bin/kasten-mcp", false).args.is_empty());
}

#[test]
fn what_is_printed_is_ready_to_paste_and_names_the_token() {
    let server = Server::of("kasten-mcp", false);
    let code = text(Target::ClaudeCode, &server, "/v", 7433);
    assert!(
        code.starts_with("claude mcp add") && code.ends_with("\"/v\"\n"),
        "{code}"
    );
    let desktop = text(Target::ClaudeDesktop, &server, "/v", 7433);
    let parsed: Value = serde_json::from_str(&desktop).unwrap();
    assert_eq!(parsed, mcp_config(&server, "/v"));
    let http = text(Target::Http, &server, "/v", 7433);
    assert!(
        http.contains("kasten-mcp --vault \"/v\" --http")
            && http.contains("http://127.0.0.1:7433/mcp")
            && http.contains("/v/.kasten/cache/mcp-token")
            && http.contains("Bearer <token>"),
        "{http}"
    );
    assert_eq!(Target::parse("claude-code"), Some(Target::ClaudeCode));
    assert_eq!(Target::parse("claude-desktop"), Some(Target::ClaudeDesktop));
    assert_eq!(Target::parse("http"), Some(Target::Http));
    assert_eq!(Target::parse("cursor"), None);
}

/// What a TOML reader finds in the block: tables and their `key = value`
/// lines, with strings unescaped and arrays of strings read. Anything
/// else in the block fails the test, so a line that is not TOML is found.
fn read_toml(text: &str) -> std::collections::BTreeMap<String, Value> {
    fn string(rest: &str) -> (String, &str) {
        let mut chars = rest
            .strip_prefix('"')
            .expect("a string starts with a quote")
            .chars();
        let mut out = String::new();
        while let Some(c) = chars.next() {
            match c {
                '"' => return (out, chars.as_str()),
                '\\' => match chars.next().expect("an escape") {
                    '\\' => out.push('\\'),
                    '"' => out.push('"'),
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    'r' => out.push('\r'),
                    'u' => {
                        let hex: String = chars.by_ref().take(4).collect();
                        out.push(char::from_u32(u32::from_str_radix(&hex, 16).unwrap()).unwrap());
                    }
                    other => panic!("not a TOML escape: \\{other}"),
                },
                c => {
                    assert!(!c.is_control(), "a raw control character in a string");
                    out.push(c);
                }
            }
        }
        panic!("a string is never closed: {rest}");
    }
    let mut found = std::collections::BTreeMap::new();
    let mut table = String::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[') {
            let name = name.strip_suffix(']').expect("a table header closes");
            assert!(!name.starts_with('['), "no arrays of tables here");
            table = name.to_owned();
            continue;
        }
        let (key, value) = line.split_once(" = ").expect("key = value");
        assert!(
            key.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "a bare key: {key}"
        );
        let value = value.trim();
        let parsed = if let Some(inner) = value.strip_prefix('[') {
            let mut rest = inner.trim_start();
            let mut items = Vec::new();
            while !rest.starts_with(']') {
                let (item, after) = string(rest);
                items.push(Value::String(item));
                rest = after.trim_start().trim_start_matches(',').trim_start();
            }
            assert_eq!(&rest[1..], "", "nothing after the array");
            Value::Array(items)
        } else {
            let (item, after) = string(value);
            assert_eq!(after.trim(), "", "nothing after the string");
            Value::String(item)
        };
        assert!(
            found.insert(format!("{table}.{key}"), parsed).is_none(),
            "{key} twice"
        );
    }
    found
}

/// The part of what `--setup codex` prints that goes into the file.
fn block(printed: &str) -> &str {
    &printed[printed
        .find("[mcp_servers")
        .expect("the block starts with its table")..]
}

#[test]
fn the_codex_block_is_toml_with_the_program_and_the_vault() {
    let cases = [
        ("/usr/bin/kasten-mcp", "/home/me/Notes"),
        (
            r"C:\Program Files\KastenFlow\kasten-mcp.exe",
            r"C:\Users\me\My Notes",
        ),
        ("/opt/a \"b\"/kasten-mcp", "/home/me/Notes \"2026\"\tdone"),
        ("/usr/bin/kasten-mcp", "/home/me/Ünïcode ノート"),
    ];
    for (exe, vault) in cases {
        let server = Server::of(exe, false);
        let printed = text(Target::Codex, &server, vault, 7433);
        let found = read_toml(block(&printed));
        assert_eq!(found["mcp_servers.kasten.command"], exe, "{printed}");
        assert_eq!(found["mcp_servers.kasten.args"], json!([]), "{printed}");
        assert_eq!(
            found["mcp_servers.kasten.env.KASTEN_VAULT"], vault,
            "{printed}"
        );
        assert_eq!(found.len(), 3, "{found:?}");
    }
}

#[test]
fn the_codex_block_for_the_app_serves_with_mcp_and_says_where_to_paste() {
    let server = Server::of("/usr/bin/kasten-app", true);
    let printed = text(Target::Codex, &server, "/v", 7433);
    let found = read_toml(block(&printed));
    assert_eq!(found["mcp_servers.kasten.args"], json!(["--mcp"]));
    // It only prints: where to paste comes first, in plain words.
    let before = &printed[..printed.find("[mcp_servers").unwrap()];
    assert!(before.contains("~/.codex/config.toml"), "{before}");
    assert!(before.contains(".codex\\config.toml"), "{before}");
    assert!(printed.ends_with('\n'));
    assert_eq!(Target::parse("codex"), Some(Target::Codex));
}

#[test]
fn the_codex_block_has_the_keys_codex_reads_and_no_token_or_extra() {
    let printed = text(Target::Codex, &Server::of("kasten-mcp", false), "/v", 7433);
    assert_eq!(
        block(&printed),
        "[mcp_servers.kasten]\ncommand = \"kasten-mcp\"\nargs = []\n\n[mcp_servers.kasten.env]\nKASTEN_VAULT = \"/v\"\n"
    );
}

#[test]
fn a_resolved_windows_path_is_written_the_way_a_person_writes_it() {
    assert_eq!(
        plain(Path::new(r"\\?\C:\Users\me\Notes")),
        r"C:\Users\me\Notes"
    );
    assert_eq!(
        plain(Path::new(r"\\?\UNC\server\share\Notes")),
        r"\\server\share\Notes"
    );
    assert_eq!(plain(Path::new("/home/me/Notes")), "/home/me/Notes");
}
