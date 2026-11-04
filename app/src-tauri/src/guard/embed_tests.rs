//! Which hosts a deck may name as an embed: not the app's own pages, whatever way the name is written.

use super::*;

fn url(text: &str) -> Url {
    Url::parse(text).unwrap()
}

#[test]
fn the_apps_own_hosts_and_their_look_alikes_are_not_embeds() {
    let named: Vec<String> = [
        "http://tauri.localhost./",
        "http://TAURI.localhost/",
        "http://diagrams.localhost/",
        "http://ipc.localhost/index.html",
        "https://anything.localhost:8443/",
        "http://localhost:1420/",
        "http://localhost./",
        "http://example.com./",
    ]
    .map(str::to_owned)
    .into();
    // Beside them, three that are fine, so the count shows the list is read at all.
    let mut all = named.clone();
    all.extend(
        [
            "http://localhost:3000/",
            "http://127.0.0.1:8080/",
            "https://example.com/",
        ]
        .map(str::to_owned),
    );
    let embeds = Embeds::default();
    assert_eq!(embeds.set(&all), 3);
    for text in &named {
        assert!(origin_of(&url(text)).is_none(), "{text}");
        assert!(!embeds.allows(&url(text)), "{text}");
    }
    for text in [
        "http://localhost:3000/x",
        "http://127.0.0.1:8080/",
        "https://example.com/y",
    ] {
        assert!(embeds.allows(&url(text)), "{text}");
    }
}
