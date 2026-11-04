//! The sites whose players and pages load more than the one address a deck names. A YouTube player is one address in a slide, and goes on to
//! load its own helpers in frames of its own (a consent page, the other YouTube host); the guard would refuse each, since it allows only
//! the origins a presentation named. So when a deck embeds a page of one of these sites over https, that site's few helper origins are
//! allowed with it, and no others: the list is explicit and short, and a deck that embeds no such site gets none of it.
//!
//! What is not here, on purpose: `accounts.google.com`. A Google document that is not public sends a visitor to sign in, and the sign-in
//! page refuses to be framed whatever the guard says, so allowing it would change nothing but the places a frame may go. A document that
//! is public needs no sign-in.

/// One site: the hosts a deck's embed may be on, and every origin its player or page loads in frames once it is allowed.
struct Site {
    /// The hosts that make the site's helpers allowed when a deck embeds one of them.
    named: &'static [&'static str],
    /// The hosts allowed with it, over https on the default port.
    helpers: &'static [&'static str],
}

const SITES: &[Site] = &[
    // The privacy-friendly player the editor makes of a YouTube link, its consent page, and the thumbnail host.
    Site {
        named: &[
            "www.youtube-nocookie.com",
            "youtube-nocookie.com",
            "www.youtube.com",
            "youtube.com",
            "m.youtube.com",
        ],
        helpers: &[
            "www.youtube-nocookie.com",
            "www.youtube.com",
            "consent.youtube.com",
            "i.ytimg.com",
        ],
    },
    Site {
        named: &["player.vimeo.com", "vimeo.com", "www.vimeo.com"],
        helpers: &["player.vimeo.com", "vimeo.com", "f.vimeocdn.com"],
    },
    Site {
        named: &["www.loom.com", "loom.com"],
        helpers: &["www.loom.com"],
    },
    Site {
        named: &["docs.google.com"],
        helpers: &["docs.google.com"],
    },
    Site {
        named: &["www.figma.com", "figma.com"],
        helpers: &["www.figma.com"],
    },
];

/// The helper origins (`https://host:443`) that go with an allowed origin, or none when it is not an https origin of a known site.
pub fn helpers_for(origin: &str) -> Vec<String> {
    let Some(host) = origin
        .strip_prefix("https://")
        .and_then(|rest| rest.strip_suffix(":443"))
    else {
        return Vec::new();
    };
    SITES
        .iter()
        .filter(|site| site.named.contains(&host))
        .flat_map(|site| site.helpers.iter().map(|h| format!("https://{h}:443")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::Embeds;
    use tauri::Url;

    fn allowed(embeds: &Embeds, text: &str) -> bool {
        embeds.allows(&Url::parse(text).unwrap())
    }

    #[test]
    fn a_youtube_player_brings_its_helpers_and_only_those() {
        let embeds = Embeds::default();
        embeds.set(&["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&rel=0".into()]);
        for yes in [
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://consent.youtube.com/m?continue=x",
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        ] {
            assert!(allowed(&embeds, yes), "{yes}");
        }
        for no in [
            // Another site, another port or scheme, a look-alike, and the accounts page.
            "https://accounts.google.com/ServiceLogin",
            "https://www.youtube.com.evil.example/",
            "https://evilyoutube.com/",
            "http://www.youtube.com/embed/x",
            "https://www.youtube.com:8443/embed/x",
            "https://player.vimeo.com/video/1",
            "https://example.com/",
            "tauri://localhost/",
        ] {
            assert!(!allowed(&embeds, no), "{no}");
        }
    }

    #[test]
    fn each_site_brings_its_own_helpers() {
        let embeds = Embeds::default();
        embeds.set(&["https://player.vimeo.com/video/76979871".into()]);
        for yes in [
            "https://player.vimeo.com/video/1",
            "https://vimeo.com/76979871",
            "https://f.vimeocdn.com/p/x.js",
        ] {
            assert!(allowed(&embeds, yes), "{yes}");
        }
        assert!(!allowed(
            &embeds,
            "https://www.youtube-nocookie.com/embed/x"
        ));

        embeds.set(&[
            "https://www.loom.com/embed/0123456789abcdef".into(),
            "https://docs.google.com/presentation/d/1AbC-dEf_123/embed".into(),
            "https://www.figma.com/embed?embed_host=kastenflow&url=x".into(),
        ]);
        for yes in [
            "https://www.loom.com/share/x",
            "https://docs.google.com/document/d/x/preview",
            "https://www.figma.com/file/x",
        ] {
            assert!(allowed(&embeds, yes), "{yes}");
        }
        assert!(!allowed(&embeds, "https://accounts.google.com/"));
        assert!(!allowed(&embeds, "https://player.vimeo.com/video/1"));
    }

    #[test]
    fn a_deck_that_embeds_no_known_site_gets_no_helpers() {
        let embeds = Embeds::default();
        embeds.set(&["https://example.com/talk".into()]);
        assert!(allowed(&embeds, "https://example.com/other"));
        for no in [
            "https://www.youtube-nocookie.com/embed/x",
            "https://www.youtube.com/",
            "https://consent.youtube.com/",
        ] {
            assert!(!allowed(&embeds, no), "{no}");
        }
        // Nothing once the presentation is over, helpers included.
        embeds.set(&["https://www.youtube-nocookie.com/embed/x".into()]);
        embeds.set(&[]);
        assert!(!allowed(&embeds, "https://www.youtube.com/"));
    }

    #[test]
    fn a_site_named_over_plain_http_or_another_port_brings_nothing() {
        let embeds = Embeds::default();
        embeds.set(&[
            "http://www.youtube.com/embed/x".into(),
            "https://www.youtube.com:8443/embed/x".into(),
        ]);
        assert!(allowed(&embeds, "http://www.youtube.com/anything"));
        assert!(!allowed(&embeds, "https://consent.youtube.com/"));
        assert!(!allowed(&embeds, "https://www.youtube-nocookie.com/"));
        assert!(helpers_for("http://www.youtube.com:80").is_empty());
        assert!(helpers_for("https://www.youtube.com:8443").is_empty());
        assert!(helpers_for("not an origin").is_empty());
    }

    #[test]
    fn only_the_main_window_may_ask_the_core_about_embeds() {
        use crate::guard::may_call;
        for command in ["allow_embeds", "frame_policy", "fetch_poster"] {
            assert!(may_call("main", command), "{command}");
            for window in [
                "capture",
                "presenter",
                "web-t1abc",
                "web-preview",
                "unknown",
            ] {
                assert!(!may_call(window, command), "{window} {command}");
            }
        }
    }

    #[test]
    fn the_list_is_short_and_explicit() {
        let all: Vec<&str> = SITES
            .iter()
            .flat_map(|s| s.helpers.iter().copied())
            .collect();
        assert!(all.len() <= 16, "{} helper hosts", all.len());
        for host in all {
            assert!(!host.contains('*'), "{host}");
            assert!(host.contains('.'), "{host}");
        }
        // Sign-in pages are not framed by anyone, so none is allowed.
        assert!(
            SITES
                .iter()
                .all(|s| !s.helpers.iter().any(|h| h.starts_with("accounts.")))
        );
    }
}
