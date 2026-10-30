//! What the tests of the agent ops that bring pictures, citations and pages
//! into a LaTeX document share: a vault with an article and a locked
//! document, the three modes, and a few small files.

use crate::common;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub use common::NOW;
use common::{TempVault, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::{Error, Kasten, Outcome};
use serde_json::Value;

pub const BASE: &str = "projects/photo-organiser/latex";
pub const ARTICLE: &str = "projects/photo-organiser/latex/article";
pub const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
pub const LOCKED: &str = "projects/photo-organiser/latex/twocolumn";

/// A 1 by 1 PNG.
pub const PNG: &[u8] =
    b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89";
pub const JPG: &[u8] = b"\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\0\0\x01\0\x01\0\0\xff\xd9";
pub const PDF: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";

pub fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A vault with the article and the locked two-column document, with history.
pub fn open() -> (TempVault, Kasten, Session) {
    let t = dev_vault();
    for name in ["article", "twocolumn"] {
        let from = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/latex")
            .join(name);
        copy_dir(&from, &t.vault.root().join(BASE).join(name));
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

pub fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

pub fn put(t: &TempVault, path: &str, bytes: &[u8]) {
    let file = t.vault.root().join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, bytes).unwrap();
}

pub fn bytes_of(t: &TempVault, path: &str) -> Vec<u8> {
    fs::read(t.vault.root().join(path)).unwrap()
}

pub fn text_of(t: &TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

pub fn exists(t: &TempVault, path: &str) -> bool {
    t.vault.root().join(path).exists()
}

pub fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

pub fn pending(outcome: Outcome) -> String {
    match outcome {
        Outcome::PendingReview { proposal, .. } => proposal,
        other => panic!("expected a proposal, got {other:?}"),
    }
}

/// The sentence of a refusal (any error, since a missing file is one too).
pub fn why(result: Result<Outcome, Error>) -> String {
    match result {
        Err(err) => err.to_string(),
        Ok(other) => panic!("expected a refusal, got {other:?}"),
    }
}

/// Every file of the vault but git's folder and the cache, with its bytes.
pub fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

/// Standard base64, for the tests only.
pub fn b64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A picture of `bytes` for the document in `doc`, sent as base64.
pub fn picture(doc: &str, name: &str, bytes: &[u8]) -> AgentOp {
    AgentOp::AddLatexAsset {
        doc: doc.into(),
        name: name.into(),
        base64: Some(b64(bytes)),
        vault_path: None,
        reason: None,
    }
}
