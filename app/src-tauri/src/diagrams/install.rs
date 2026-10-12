//! Installing the diagram editor: the pinned release's WAR is downloaded over
//! HTTPS with the app's own client, streamed to a file under the app's data
//! folder, checked against the pinned SHA-256 before anything is unpacked,
//! unpacked into a folder of its own, and moved into place in one step. A
//! download that does not match, an archive that breaks the rules of
//! `extract` and a cancel all leave no editor behind, and one already
//! installed is replaced only by a new one that checked out whole.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::clean::{forget_file, forget_folder};
use super::extract::{Failure, Limits, extract, failed};
use super::pinned::Source;

/// The file the download is streamed to, in the editor's folder.
pub const PARTIAL: &str = "download.partial";
/// The file in an installed copy that names its version.
pub const VERSION_FILE: &str = "VERSION";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Downloading,
    Verifying,
    Extracting,
}

/// How far an install is: the phase, and how much of its work is done.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: Phase,
    pub done: u64,
    pub total: u64,
}

/// Where the editor may be fetched from: GitHub, which serves a release's
/// files from its own and its content hosts, and only over HTTPS.
pub fn release_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && (host == "github.com"
            || host == "githubusercontent.com"
            || host.ends_with(".githubusercontent.com"))
}

/// The client for the download: it follows a few redirects, each only to an
/// address `allowed` accepts, so the file always comes from where it is
/// pinned to come from. System proxy settings apply.
pub fn client(allowed: fn(&Url) -> bool) -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("the download redirected too many times")
        } else if !allowed(attempt.url()) {
            attempt.error("the download was sent somewhere it is not allowed to come from")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!("KastenFlow/", env!("CARGO_PKG_VERSION")))
        .redirect(policy)
        .build()
        .map_err(|err| format!("KastenFlow cannot make HTTPS connections: {err}"))
}

/// Streams the release to `partial`, hashing as it comes; returns the hash.
async fn download(
    client: &reqwest::Client,
    source: &Source,
    partial: &Path,
    cancel: &AtomicBool,
    report: &(dyn Fn(Progress) + Send + Sync),
) -> Result<String, Failure> {
    let tell = |what: &str, err: &dyn std::fmt::Display| {
        Failure::Failed(format!(
            "Could not download the diagram editor ({what}): {err}"
        ))
    };
    let mut response = client
        .get(&source.url)
        .send()
        .await
        .map_err(|err| tell("connecting", &err))?;
    if !response.status().is_success() {
        return failed(format!(
            "The download address answered {}: the diagram editor could not be fetched",
            response.status()
        ));
    }
    if response.content_length().is_some_and(|n| n > source.size) {
        return failed(
            "The download is bigger than the release KastenFlow expects, so it was not kept",
        );
    }
    let mut file = File::create(partial).map_err(|err| tell("saving", &err))?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            forget_file(partial);
            return Err(Failure::Cancelled);
        }
        let piece = match response.chunk().await {
            Ok(Some(piece)) => piece,
            Ok(None) => break,
            Err(err) => {
                drop(file);
                forget_file(partial);
                return Err(tell("receiving", &err));
            }
        };
        done += piece.len() as u64;
        if done > source.size {
            drop(file);
            forget_file(partial);
            return failed(
                "The download is bigger than the release KastenFlow expects, so it was not kept",
            );
        }
        hasher.update(&piece);
        if let Err(err) = file.write_all(&piece) {
            drop(file);
            forget_file(partial);
            return Err(tell("saving", &err));
        }
        report(Progress {
            phase: Phase::Downloading,
            done,
            total: source.size,
        });
    }
    file.sync_all().map_err(|err| tell("saving", &err))?;
    if done != source.size {
        forget_file(partial);
        return failed(format!(
            "Only {done} of {} bytes of the diagram editor arrived",
            source.size
        ));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Moves the unpacked folder into place, keeping what was there until the
/// new one is: a failure puts the old one back.
fn place(staging: &Path, target: &Path) -> Result<(), String> {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let old = target.with_file_name(format!("{name}.replaced"));
    forget_folder(&old);
    let had = target.exists();
    if had {
        fs::rename(target, &old)
            .map_err(|err| format!("The old copy of the editor could not be set aside: {err}"))?;
    }
    if let Err(err) = fs::rename(staging, target) {
        if had {
            let _ = fs::rename(&old, target);
        }
        return Err(format!("The editor could not be put in place: {err}"));
    }
    forget_folder(&old);
    Ok(())
}

/// Downloads, checks, unpacks and installs `source` as `<root>/<version>/`.
/// `report` hears each step. On any failure nothing of the new copy is left,
/// and an installed one is untouched.
pub async fn install(
    client: &reqwest::Client,
    source: &Source,
    root: &Path,
    limits: Limits,
    cancel: Arc<AtomicBool>,
    report: Arc<dyn Fn(Progress) + Send + Sync>,
) -> Result<(), Failure> {
    fs::create_dir_all(root).map_err(|err| {
        Failure::Failed(format!(
            "Could not make a folder for the diagram editor: {err}"
        ))
    })?;
    let partial = root.join(PARTIAL);
    let staging = root.join(format!("{}.installing", source.version));
    let target = root.join(&source.version);
    forget_file(&partial);
    forget_folder(&staging);

    let digest = download(client, source, &partial, &cancel, report.as_ref()).await?;
    report(Progress {
        phase: Phase::Verifying,
        done: source.size,
        total: source.size,
    });
    if !digest.eq_ignore_ascii_case(&source.sha256) {
        forget_file(&partial);
        return failed(
            "The download does not match the release KastenFlow expects (its checksum differs), so nothing was installed",
        );
    }

    let unpack = {
        let (partial, staging, cancel, report) = (
            partial.clone(),
            staging.clone(),
            Arc::clone(&cancel),
            Arc::clone(&report),
        );
        tokio::task::spawn_blocking(move || {
            extract(&partial, &staging, &limits, &cancel, &|done, total| {
                report(Progress {
                    phase: Phase::Extracting,
                    done,
                    total,
                });
            })
        })
        .await
    };
    forget_file(&partial);
    match unpack {
        Ok(Ok(_)) => {}
        Ok(Err(failure)) => {
            forget_folder(&staging);
            return Err(failure);
        }
        Err(err) => {
            forget_folder(&staging);
            return failed(format!("The installer stopped unexpectedly: {err}"));
        }
    }
    let finish = || -> Result<(), String> {
        if !staging.join("index.html").is_file() {
            return Err("The unpacked editor has no index.html".to_owned());
        }
        fs::write(staging.join(VERSION_FILE), &source.version)
            .map_err(|err| format!("Could not mark the editor's version: {err}"))?;
        place(&staging, &target)
    };
    if let Err(why) = finish() {
        forget_folder(&staging);
        return failed(why);
    }
    Ok(())
}
