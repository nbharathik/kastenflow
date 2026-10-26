//! Where GitHub is asked, and which GitHub app "Sign in with GitHub" goes
//! through. The addresses are values, so tests can point them at a mock
//! server on this computer; the real ones are the default.

/// The public client id of KastenFlow's GitHub app. A client id is not a
/// secret (it is sent to GitHub in every sign-in). Empty until the owner
/// puts the id of the registered app here; `KASTEN_GITHUB_CLIENT_ID`, set
/// when the app is built or run, takes its place.
pub const DEFAULT_CLIENT_ID: &str = "";

/// GitHub's own site.
pub const WEB: &str = "https://github.com";
const API: &str = "https://api.github.com";

/// The addresses of GitHub's API and sign-in pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub api: String,
    pub device_code: String,
    pub access_token: String,
}

impl Endpoints {
    /// The real GitHub.
    pub fn github() -> Endpoints {
        Endpoints {
            api: API.to_owned(),
            device_code: format!("{WEB}/login/device/code"),
            access_token: format!("{WEB}/login/oauth/access_token"),
        }
    }

    /// One server for everything, as a test double.
    #[cfg(test)]
    pub fn at(base: &str) -> Endpoints {
        let base = base.trim_end_matches('/');
        Endpoints {
            api: base.to_owned(),
            device_code: format!("{base}/login/device/code"),
            access_token: format!("{base}/login/oauth/access_token"),
        }
    }
}

/// The client id to use: the one named when the app runs, else the one it
/// was built with, else the default in the source. Blank ones do not count.
pub fn pick_client_id(runtime: Option<&str>, built: Option<&str>) -> Option<String> {
    [runtime, built, Some(DEFAULT_CLIENT_ID)]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|id| !id.is_empty())
        .map(str::to_owned)
}

/// The client id of this copy of KastenFlow, if it has one.
pub fn client_id() -> Option<String> {
    pick_client_id(
        std::env::var("KASTEN_GITHUB_CLIENT_ID").ok().as_deref(),
        option_env!("KASTEN_GITHUB_CLIENT_ID"),
    )
}

/// The page where GitHub lets the person take the app's access back: the
/// app's own page when its id is known, else the list of authorised apps.
pub fn revoke_url(client_id: Option<&str>) -> String {
    match client_id.filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')) {
        Some(id) if !id.is_empty() => {
            format!("{WEB}/settings/connections/applications/{id}")
        }
        _ => format!("{WEB}/settings/applications"),
    }
}

/// GitHub's page for making a fine-grained token, filled in: named
/// "KastenFlow backup", with the one permission a backup needs (contents,
/// read and write). The person picks the repository there.
pub fn token_page_url() -> String {
    format!(
        "{WEB}/settings/personal-access-tokens/new?name=KastenFlow+backup\
         &description=Backs+up+a+KastenFlow+vault+to+one+repository\
         &contents=write&metadata=read"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_runtime_id_beats_the_built_one_and_the_default() {
        assert_eq!(
            pick_client_id(Some(" Ov23run "), Some("Ov23built")).as_deref(),
            Some("Ov23run")
        );
        assert_eq!(
            pick_client_id(Some("  "), Some("Ov23built")).as_deref(),
            Some("Ov23built")
        );
        assert_eq!(
            pick_client_id(None, Some("")).as_deref(),
            Some(DEFAULT_CLIENT_ID).filter(|id| !id.is_empty())
        );
    }

    #[test]
    fn revoke_pages_never_take_odd_ids() {
        assert_eq!(
            revoke_url(Some("Ov23li")),
            "https://github.com/settings/connections/applications/Ov23li"
        );
        assert_eq!(
            revoke_url(Some("x/../y")),
            "https://github.com/settings/applications"
        );
        assert_eq!(revoke_url(None), "https://github.com/settings/applications");
    }

    #[test]
    fn the_token_page_asks_for_contents_only() {
        let url = token_page_url();
        assert!(url.starts_with("https://github.com/settings/personal-access-tokens/new?"));
        assert!(url.contains("name=KastenFlow+backup") && url.contains("contents=write"));
    }
}
