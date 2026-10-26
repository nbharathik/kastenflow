//! Installing a plugin's payload (a program or a web app it needs, too big
//! for the installer): the pinned release is downloaded over HTTPS with the
//! app's own client, streamed to a file under the app's data folder, checked
//! against the pinned size and SHA-256 while it streams and again before
//! anything is unpacked, unpacked into a folder of its own, and moved into
//! place in one step. A download that does not match, an archive that breaks
//! the rules of its unpacker and a cancel all leave nothing behind, and a copy
//! already installed is replaced only by a new one that checked out whole.

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

/// The file the download is streamed to, in the plugin's folder.
pub const PARTIAL: &str = "download.partial";
/// The file in an installed copy that names its version.
pub const VERSION_FILE: &str = "VERSION";

/// A release to install: where it is, how big it is and what it hashes to.
#[derive(Debug, Clone)]
pub struct Source {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// Why an install stopped.
#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    Cancelled,
    Failed(String),
}

impl Failure {
    /// What to tell the person.
    pub fn message(&self) -> String {
        match self {
            Failure::Cancelled => "The installation was cancelled".to_owned(),
            Failure::Failed(why) => why.clone(),
        }
    }
}

pub fn failed<T>(why: impl Into<String>) -> Result<T, Failure> {
    Err(Failure::Failed(why.into()))
}

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

/// Unpacks the downloaded file at the first path into the (new, empty)
/// folder at the second; hears progress as entries done of entries; stops
/// with `Cancelled` when the flag is set.
pub type Unpack =
    Arc<dyn Fn(&Path, &Path, &AtomicBool, &dyn Fn(u64, u64)) -> Result<(), Failure> + Send + Sync>;

/// What differs between plugins: how the payload is called in a sentence, the
/// file an unpacked copy must hold, and how it is unpacked.
#[derive(Clone)]
pub struct Spec {
    /// "the diagram editor": fits after "the" in a sentence.
    pub label: String,
    /// A file the unpacked folder must hold to count as whole; empty for none.
    pub required: &'static str,
    pub unpack: Unpack,
}

/// Where a payload may be fetched from: GitHub, which serves a release's
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
        .map_err(|err| {
            format!("KastenFlow cannot make a secure connection to download this: {err}")
        })
}

/// Streams the release to `partial`, hashing as it comes; returns the hash.
/// The caller removes `partial` when this fails.
async fn download(
    client: &reqwest::Client,
    source: &Source,
    label: &str,
    partial: &Path,
    cancel: &AtomicBool,
    report: &(dyn Fn(Progress) + Send + Sync),
) -> Result<String, Failure> {
    let tell = |what: &str, err: &dyn std::fmt::Display| {
        Failure::Failed(format!("Could not download {label} ({what}): {err}"))
    };
    let too_big = || {
        Failure::Failed(
            "The download is bigger than the release KastenFlow expects, so it was not kept"
                .to_owned(),
        )
    };
    let mut response = client
        .get(&source.url)
        .send()
        .await
        .map_err(|err| tell("connecting", &err))?;
    if !response.status().is_success() {
        return failed(format!(
            "The download address answered {}: {label} could not be fetched",
            response.status()
        ));
    }
    if response.content_length().is_some_and(|n| n > source.size) {
        return Err(too_big());
    }
    let mut file = File::create(partial).map_err(|err| tell("saving", &err))?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        let piece = match response.chunk().await {
            Ok(Some(piece)) => piece,
            Ok(None) => break,
            Err(err) => return Err(tell("receiving", &err)),
        };
        done += piece.len() as u64;
        if done > source.size {
            return Err(too_big());
        }
        hasher.update(&piece);
        file.write_all(&piece).map_err(|err| tell("saving", &err))?;
        report(Progress {
            phase: Phase::Downloading,
            done,
            total: source.size,
        });
    }
    file.sync_all().map_err(|err| tell("saving", &err))?;
    if done != source.size {
        return failed(format!(
            "Only {done} of {} bytes of {label} arrived",
            source.size
        ));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Moves the unpacked folder into place, keeping what was there until the
/// new one is: a failure puts the old one back.
fn place(staging: &Path, target: &Path, label: &str) -> Result<(), String> {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let old = target.with_file_name(format!("{name}.replaced"));
    forget_folder(&old);
    let had = target.exists();
    if had {
        fs::rename(target, &old)
            .map_err(|err| format!("The old copy of {label} could not be set aside: {err}"))?;
    }
    if let Err(err) = fs::rename(staging, target) {
        if had {
            let _ = fs::rename(&old, target);
        }
        return Err(format!("{label} could not be put in place: {err}"));
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
    spec: &Spec,
    cancel: Arc<AtomicBool>,
    report: Arc<dyn Fn(Progress) + Send + Sync>,
) -> Result<(), Failure> {
    let label = spec.label.as_str();
    fs::create_dir_all(root)
        .map_err(|err| Failure::Failed(format!("Could not make a folder for {label}: {err}")))?;
    let partial = root.join(PARTIAL);
    let staging = root.join(format!("{}.installing", source.version));
    let target = root.join(&source.version);
    forget_file(&partial);
    forget_folder(&staging);

    let fetched = download(client, source, label, &partial, &cancel, report.as_ref()).await;
    let digest = match fetched {
        Ok(digest) => digest,
        Err(failure) => {
            forget_file(&partial);
            return Err(failure);
        }
    };
    if cancel.load(Ordering::Relaxed) {
        forget_file(&partial);
        return Err(Failure::Cancelled);
    }
    report(Progress {
        phase: Phase::Verifying,
        done: source.size,
        total: source.size,
    });
    if !digest.eq_ignore_ascii_case(&source.sha256) {
        forget_file(&partial);
        return failed(
            "The download does not match the release KastenFlow expects (the file arrived damaged or changed), so nothing was installed. Try again",
        );
    }

    let unpack = {
        let (partial, staging, cancel, report, unpack) = (
            partial.clone(),
            staging.clone(),
            Arc::clone(&cancel),
            Arc::clone(&report),
            Arc::clone(&spec.unpack),
        );
        tokio::task::spawn_blocking(move || {
            unpack(&partial, &staging, &cancel, &|done, total| {
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
        Ok(Ok(())) => {}
        Ok(Err(failure)) => {
            forget_folder(&staging);
            return Err(failure);
        }
        Err(err) => {
            forget_folder(&staging);
            return failed(format!(
                "The install stopped unexpectedly. Try again: {err}"
            ));
        }
    }
    let finish = || -> Result<(), String> {
        if !spec.required.is_empty() && !staging.join(spec.required).is_file() {
            return Err(format!("The unpacked {label} has no {}", spec.required));
        }
        fs::write(staging.join(VERSION_FILE), &source.version)
            .map_err(|err| format!("Could not mark the version of {label}: {err}"))?;
        place(&staging, &target, label)
    };
    if let Err(why) = finish() {
        forget_folder(&staging);
        return failed(why);
    }
    Ok(())
}

/// Takes in a copy an earlier version of the app kept in its own folder:
/// when `old` is there and `new` is not, `old` becomes `new`, in one move.
/// Answers whether it moved. Only the app's own files are ever touched.
pub fn adopt_legacy(old: &Path, new: &Path) -> bool {
    if !old.is_dir() || new.exists() {
        return false;
    }
    if let Some(parent) = new.parent()
        && fs::create_dir_all(parent).is_err()
    {
        return false;
    }
    fs::rename(old, new).is_ok()
}

/// The version an installed copy names, when `dir` holds a whole one: a
/// VERSION file saying `version` and the `required` file (none: any).
pub fn installed_version(dir: &Path, version: &str, required: &str) -> bool {
    let marked = fs::read_to_string(dir.join(VERSION_FILE)).ok();
    marked.is_some_and(|m| m.trim() == version)
        && (required.is_empty() || dir.join(required).is_file())
}
