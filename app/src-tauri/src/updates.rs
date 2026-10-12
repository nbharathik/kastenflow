//! The update check: asks GitHub for Kasten's latest release, and finds
//! the installer for this computer among its files. It installs nothing
//! itself: a build that can install in place does so through
//! `update_install.rs`; any other offers the download.

use std::time::Duration;

use reqwest::header::{ACCEPT, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::chat::commands::ChatState;

const WAIT: Duration = Duration::from_secs(15);

/// What the update check found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    /// The latest release is newer than this app.
    pub newer: bool,
    /// The release's page, with its downloads.
    pub url: String,
    pub name: String,
    pub published: Option<String>,
    /// Its release notes, in Markdown.
    pub notes: String,
    /// The installer for this computer, when the release has one.
    pub download: Option<Download>,
}

/// One file of a release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Download {
    pub name: String,
    #[serde(rename(deserialize = "browser_download_url"))]
    pub url: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<Download>,
}

/// The owner and name of a GitHub repository, from its web address.
fn github_repo(repository: &str) -> Option<(&str, &str)> {
    let path = repository
        .trim_end_matches('/')
        .strip_prefix("https://github.com/")?;
    let mut parts = path.split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    if owner.is_empty() || repo.is_empty() || parts.next().is_some() {
        return None;
    }
    Some((owner, repo))
}

/// Where GitHub lists a repository's latest release, from its web address.
fn releases_api(repository: &str) -> Option<String> {
    let (owner, repo) = github_repo(repository)?;
    Some(format!(
        "https://api.github.com/repos/{owner}/{repo}/releases/latest"
    ))
}

/// Where the installers' manifest of the latest release is, for installing
/// in place: `latest.json`, which the release workflow publishes beside
/// the installers and their signatures.
pub fn manifest_url(repository: &str) -> Option<String> {
    let (owner, repo) = github_repo(repository)?;
    Some(format!(
        "https://github.com/{owner}/{repo}/releases/latest/download/latest.json"
    ))
}

/// The page of a repository's releases, for "what's new" after an update.
pub fn releases_page(repository: &str) -> Option<String> {
    let (owner, repo) = github_repo(repository)?;
    Some(format!("https://github.com/{owner}/{repo}/releases"))
}

/// The numbers of a version such as `v1.2.3-beta.1`, and whether it is a
/// pre-release.
fn parts(version: &str) -> (Vec<u64>, bool) {
    let version = version.trim().trim_start_matches(['v', 'V']);
    let (numbers, pre) = match version.split_once(['-', '+']) {
        Some((numbers, rest)) => (
            numbers,
            version[numbers.len()..].starts_with('-') && !rest.is_empty(),
        ),
        None => (version, false),
    };
    let numbers = numbers.split('.').map(|n| n.parse().unwrap_or(0)).collect();
    (numbers, pre)
}

/// Whether `latest` is a newer version than `current`: by number, and a
/// release before its own pre-releases.
fn is_newer(latest: &str, current: &str) -> bool {
    let (mut a, a_pre) = parts(latest);
    let (mut b, b_pre) = parts(current);
    let width = a.len().max(b.len());
    a.resize(width, 0);
    b.resize(width, 0);
    match a.cmp(&b) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => b_pre && !a_pre,
    }
}

/// The installer for a computer running `os` on `arch` (as Rust names
/// them): the setup program on Windows, the disk image on macOS. Linux
/// has several kinds (AppImage, deb, rpm), so there the release page lets
/// the person pick the one they installed. Only files GitHub itself serves
/// are offered.
fn pick_download(assets: &[Download], os: &str, arch: &str) -> Option<Download> {
    let names: &[&str] = match arch {
        "x86_64" => &["x64", "x86_64", "amd64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => return None,
    };
    let kinds: &[&str] = match os {
        "windows" => &["-setup.exe", ".msi"],
        "macos" => &[".dmg"],
        _ => return None,
    };
    let fits = |asset: &&Download| {
        asset.url.starts_with("https://github.com/")
            && names.iter().any(|name| asset.name.contains(name))
    };
    kinds.iter().find_map(|kind| {
        assets
            .iter()
            .filter(fits)
            .find(|asset| asset.name.ends_with(kind))
            .cloned()
    })
}

fn update_info(release: Release, current: &str, os: &str, arch: &str) -> UpdateInfo {
    let latest = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_owned();
    UpdateInfo {
        current: current.to_owned(),
        newer: is_newer(&latest, current),
        name: release
            .name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| format!("KastenFlow {latest}")),
        download: pick_download(&release.assets, os, arch),
        latest,
        // The release's page, where "What's new" links: GitHub's own, or
        // the list of releases should the answer name anywhere else.
        url: if release.html_url.starts_with("https://github.com/") {
            release.html_url
        } else {
            releases_page(env!("CARGO_PKG_REPOSITORY")).unwrap_or_default()
        },
        published: release.published_at,
        notes: release.body.unwrap_or_default(),
    }
}

/// Asks GitHub for the latest release of Kasten.
#[tauri::command]
pub async fn check_update(chat: State<'_, ChatState>) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");
    let api = releases_api(env!("CARGO_PKG_REPOSITORY"))
        .ok_or("This build does not say where its releases are")?;
    // The client that follows no redirect: the answer comes from GitHub's
    // API itself.
    let response = chat
        .http()?
        .get(&api)
        .header(USER_AGENT, format!("KastenFlow/{current}"))
        .header(ACCEPT, "application/vnd.github+json")
        .timeout(WAIT)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Err("No release has been published yet".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("GitHub's answer could not be read: {e}"))?;
    let release: Release = serde_json::from_str(&text)
        .map_err(|e| format!("GitHub's answer could not be read: {e}"))?;
    Ok(update_info(
        release,
        current,
        std::env::consts::OS,
        std::env::consts::ARCH,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_releases_of_a_github_repository() {
        assert_eq!(
            releases_api("https://github.com/example/kasten").as_deref(),
            Some("https://api.github.com/repos/example/kasten/releases/latest")
        );
        assert!(releases_api("https://github.com/example/kasten/").is_some());
        assert!(releases_api("https://gitlab.com/a/b").is_none());
        assert!(releases_api("https://github.com/only-owner").is_none());
        assert!(releases_api("").is_none());
        assert!(manifest_url("").is_none());
        assert!(releases_page("").is_none());
        assert_eq!(
            releases_page("https://github.com/example/kasten/").as_deref(),
            Some("https://github.com/example/kasten/releases")
        );
        assert!(releases_page("https://example.com/a/b").is_none());
        assert_eq!(
            manifest_url("https://github.com/example/kasten").as_deref(),
            Some("https://github.com/example/kasten/releases/latest/download/latest.json")
        );
        assert!(manifest_url("https://gitlab.com/a/b").is_none());
    }

    #[test]
    fn compares_versions_by_number_with_pre_releases_first() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("v0.10.0", "0.9.3"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(is_newer("1.2.0", "1.2.0-beta.2"));
        assert!(!is_newer("1.2.0-beta.2", "1.2.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(!is_newer("1.2.0+build.5", "1.2.0"));
    }

    fn file(name: &str) -> Download {
        Download {
            name: name.into(),
            url: format!("https://github.com/example/kasten/releases/download/v0.3.0/{name}"),
            size: 1,
        }
    }

    /// The files the release workflow uploads.
    fn release_files() -> Vec<Download> {
        [
            "Kasten_0.3.0_x64-setup.exe",
            "Kasten_0.3.0_x64_en-US.msi",
            "Kasten_0.3.0_aarch64.dmg",
            "Kasten_0.3.0_x64.dmg",
            "Kasten_0.3.0_amd64.AppImage",
            "Kasten_0.3.0_amd64.deb",
            "kasten-cli-v0.3.0-windows-x64.zip",
            "SHA256SUMS.txt",
            // What installing in place reads, never offered to download.
            "Kasten_0.3.0_x64-setup.exe.sig",
            "Kasten_0.3.0_x64_en-US.msi.sig",
            "Kasten_0.3.0_aarch64.app.tar.gz",
            "Kasten_0.3.0_aarch64.app.tar.gz.sig",
            "Kasten_0.3.0_x64.app.tar.gz",
            "latest.json",
        ]
        .into_iter()
        .map(file)
        .collect()
    }

    #[test]
    fn picks_the_installer_for_this_computer() {
        let files = release_files();
        let pick = |os, arch| pick_download(&files, os, arch).map(|d| d.name);
        assert_eq!(
            pick("windows", "x86_64").as_deref(),
            Some("Kasten_0.3.0_x64-setup.exe")
        );
        assert_eq!(
            pick("macos", "aarch64").as_deref(),
            Some("Kasten_0.3.0_aarch64.dmg")
        );
        assert_eq!(
            pick("macos", "x86_64").as_deref(),
            Some("Kasten_0.3.0_x64.dmg")
        );
        // Linux has several kinds of package: the person picks on the page.
        assert_eq!(pick("linux", "x86_64"), None);
        // No installer for this computer: the page, not a wrong file.
        assert_eq!(pick("windows", "aarch64"), None);
        assert_eq!(pick("freebsd", "x86_64"), None);
    }

    #[test]
    fn falls_back_to_the_msi_and_offers_only_github_files() {
        let msi = vec![file("Kasten_0.3.0_x64_en-US.msi")];
        assert_eq!(
            pick_download(&msi, "windows", "x86_64")
                .map(|d| d.name)
                .as_deref(),
            Some("Kasten_0.3.0_x64_en-US.msi")
        );
        let elsewhere = vec![Download {
            url: "https://example.com/Kasten_0.3.0_x64-setup.exe".into(),
            ..file("Kasten_0.3.0_x64-setup.exe")
        }];
        assert_eq!(pick_download(&elsewhere, "windows", "x86_64"), None);
    }

    #[test]
    fn reads_a_release() {
        let release: Release = serde_json::from_value(serde_json::json!({
            "tag_name": "v0.3.0",
            "html_url": "https://github.com/example/kasten/releases/tag/v0.3.0",
            "name": "",
            "published_at": "2026-10-01T09:00:00Z",
            "body": "- Mind maps",
            "assets": [{
                "name": "Kasten_0.3.0_x64-setup.exe",
                "browser_download_url": "https://github.com/example/kasten/releases/download/v0.3.0/Kasten_0.3.0_x64-setup.exe",
                "size": 5_000_000,
                "content_type": "application/octet-stream"
            }]
        }))
        .unwrap();
        let info = update_info(release, "0.2.1", "windows", "x86_64");
        assert_eq!(info.latest, "0.3.0");
        assert!(info.newer);
        assert_eq!(info.name, "KastenFlow 0.3.0");
        assert_eq!(info.notes, "- Mind maps");
        assert_eq!(info.download.as_ref().map(|d| d.size), Some(5_000_000));
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["published"], "2026-10-01T09:00:00Z");
        assert_eq!(
            json["download"]["url"],
            "https://github.com/example/kasten/releases/download/v0.3.0/Kasten_0.3.0_x64-setup.exe"
        );
        assert_eq!(
            info.url,
            "https://github.com/example/kasten/releases/tag/v0.3.0"
        );
    }

    #[test]
    fn links_only_to_a_release_page_on_github() {
        let release: Release = serde_json::from_value(serde_json::json!({
            "tag_name": "v0.3.0",
            "html_url": "https://evil.example/kasten",
            "assets": []
        }))
        .unwrap();
        let info = update_info(release, "0.2.1", "linux", "x86_64");
        assert_eq!(
            info.url,
            releases_page(env!("CARGO_PKG_REPOSITORY")).unwrap_or_default()
        );
    }
}
