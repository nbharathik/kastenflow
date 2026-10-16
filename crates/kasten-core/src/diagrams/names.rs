//! Names of diagrams. A diagram has no title inside its file, so its title
//! is its file's name: `OAuth-flow.drawio` reads "OAuth flow". The name
//! keeps the case it was typed in (so a title survives the round trip) and
//! is otherwise made as every file name is: letters and digits of any
//! script stay, everything else becomes one dash.

use super::format::{EXT, SIDECAR_EXT};
use crate::error::{Error, Result};
use crate::vault::Vault;

const MAX_CHARS: usize = 80;
const MAX_BYTES: usize = 120;

/// The trimmed title, or why it cannot name a diagram.
pub(crate) fn checked_title(title: &str) -> Result<String> {
    let title = title.trim();
    if title.is_empty() || title.contains(['[', ']', '|']) || title.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "A title needs some text and no [ ] or | characters, on one line".to_owned(),
        ));
    }
    Ok(title.to_owned())
}

/// A file-name-safe stem from a title, keeping its case; `untitled` when
/// nothing usable remains.
pub(crate) fn stem_of_title(title: &str) -> String {
    let mut out = String::new();
    let mut chars = 0;
    let mut dash = false;
    for c in title.chars() {
        if c.is_alphanumeric() {
            let dash = dash && !out.is_empty();
            if out.len() + usize::from(dash) + c.len_utf8() > MAX_BYTES {
                break;
            }
            if dash {
                out.push('-');
            }
            out.push(c);
            chars += 1 + usize::from(dash);
        }
        dash = !c.is_alphanumeric();
        if chars >= MAX_CHARS {
            break;
        }
    }
    if out.is_empty() {
        "untitled".to_owned()
    } else if crate::slug::windows_device(&out) {
        format!("{out}-1")
    } else {
        out
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The file's name without its folder or extension.
pub(crate) fn stem_of_path(path: &str) -> &str {
    let name = file_name(path);
    name.strip_suffix(SIDECAR_EXT)
        .or_else(|| name.strip_suffix(EXT))
        .unwrap_or(name)
}

/// What people call the diagram at `path`: its file's name with the dashes
/// and underscores read as spaces.
pub fn title_of(path: &str) -> String {
    let title: String = stem_of_path(path)
        .chars()
        .map(|c| if matches!(c, '-' | '_') { ' ' } else { c })
        .collect();
    let title = title.trim();
    if title.is_empty() {
        file_name(path).to_owned()
    } else {
        title.to_owned()
    }
}

/// The folder of a path.
pub(crate) fn folder_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// The first `dir/stem.drawio`, `dir/stem-2.drawio`, … whose source and
/// picture are both free, so a leftover picture is never taken over.
pub(crate) fn free_pair(vault: &Vault, dir: &str, stem: &str) -> String {
    free_pair_besides(vault, dir, stem, &std::collections::HashSet::new())
}

/// `free_pair` that also passes over `planned`, paths a staged change means to use.
pub(crate) fn free_pair_besides(
    vault: &Vault,
    dir: &str,
    stem: &str,
    planned: &std::collections::HashSet<String>,
) -> String {
    let taken = |path: &str| {
        if planned.contains(path) {
            return true;
        }
        let source = vault.file_of(path, &[EXT]).is_ok_and(|p| p.exists());
        let picture = vault
            .file_of(&format!("{path}.svg"), &[SIDECAR_EXT])
            .is_ok_and(|p| p.exists());
        source || picture
    };
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{dir}/{stem}{EXT}")
        } else {
            format!("{dir}/{stem}-{n}{EXT}")
        };
        if !taken(&name) {
            return name;
        }
        n += 1;
    }
}
