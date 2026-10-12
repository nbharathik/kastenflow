use std::collections::HashMap;

use super::*;

fn query(url: &str) -> HashMap<String, String> {
    Url::parse(url)
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

fn request<'a>() -> Authorization<'a> {
    Authorization {
        client_id: None,
        redirect_uri: "http://127.0.0.1:51234/auth/callback",
        state: "state-1",
        nonce: "nonce-1",
        challenge: "challenge-1",
        host_id: "urn:uuid:11111111-1111-4111-8111-111111111111",
        email_hint: None,
        reconsent: false,
    }
}

#[test]
fn the_first_sign_in_registers_a_client_for_this_installation() {
    let url = authorize_url(&Endpoints::official(), &request()).unwrap();
    assert!(
        url.starts_with("https://auth.openai.com/api/accounts/authorize?"),
        "{url}"
    );
    let q = query(&url);
    assert_eq!(q["client_id"], "dynamic_agent_client");
    assert_eq!(q["agent_name_hint"], "KastenFlow");
    assert_eq!(
        q["ext_agent_host_id"],
        "urn:uuid:11111111-1111-4111-8111-111111111111"
    );
    assert_eq!(q["response_type"], "code");
    assert_eq!(q["redirect_uri"], "http://127.0.0.1:51234/auth/callback");
    assert_eq!(q["resource"], "https://api.openai.com/v1");
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["code_challenge"], "challenge-1");
    assert_eq!(
        (q["state"].as_str(), q["nonce"].as_str()),
        ("state-1", "nonce-1")
    );
    assert_eq!(
        q["scope"],
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    );
    assert!(!q.contains_key("login_hint") && !q.contains_key("prompt"));
    // The redirect address is encoded, not pasted into the query.
    assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A51234%2Fauth%2Fcallback"));
}

#[test]
fn a_later_sign_in_reuses_its_client_and_starts_from_the_email() {
    let mut again = request();
    again.client_id = Some("oaiapp_abc123");
    again.email_hint = Some("me+kasten@example.com");
    again.reconsent = true;
    let url = authorize_url(&Endpoints::official(), &again).unwrap();
    let q = query(&url);
    assert_eq!(q["client_id"], "oaiapp_abc123");
    assert!(
        !q.contains_key("agent_name_hint"),
        "the name goes with the first request only"
    );
    assert_eq!(q["login_hint"], "me+kasten@example.com");
    assert_eq!(q["prompt"], "consent");
    assert!(
        url.contains("login_hint=me%2Bkasten%40example.com"),
        "{url}"
    );
}

#[test]
fn only_openais_own_discovery_document_is_believed() {
    let own = r#"{"issuer":"https://auth.openai.com",
        "authorization_endpoint":"https://auth.openai.com/api/accounts/authorize",
        "token_endpoint":"https://auth.openai.com/api/accounts/oauth/token",
        "revocation_endpoint":"https://auth.openai.com/api/accounts/oauth/revoke"}"#;
    let found = Endpoints::from_discovery(own).unwrap();
    assert_eq!(
        found.token,
        "https://auth.openai.com/api/accounts/oauth/token"
    );
    assert_eq!(
        found.revoke.as_deref(),
        Some("https://auth.openai.com/api/accounts/oauth/revoke")
    );
    let no_revoke = own.replace("revocation_endpoint", "other");
    assert_eq!(Endpoints::from_discovery(&no_revoke).unwrap().revoke, None);
    // Another issuer, or an endpoint elsewhere, would send the code and the
    // tokens to a stranger.
    let stranger = own.replace("https://auth.openai.com\"", "https://evil.example\"");
    assert!(Endpoints::from_discovery(&stranger).is_none());
    let moved = own.replace(
        "https://auth.openai.com/api/accounts/oauth/token",
        "https://auth.openai.com.evil.example/token",
    );
    assert!(Endpoints::from_discovery(&moved).is_none());
    let plain = own.replace(
        "https://auth.openai.com/api/accounts/authorize",
        "http://auth.openai.com/authorize",
    );
    assert!(Endpoints::from_discovery(&plain).is_none());
    assert!(Endpoints::from_discovery("<html>").is_none());
}
