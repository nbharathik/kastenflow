//! The release each plugin's payload is pinned to, per kind of computer.
//! Upgrading a payload is a deliberate change of its pin here; plugins are
//! not updated on their own, only with the app.

use super::latex::pinned as latex_pinned;
use super::payload::Source;
use crate::diagrams::pinned;

/// One downloadable release: where it is, what it hashes to, how big it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pin {
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

/// A plugin's payload: its version, and a pin for each kind of computer
/// (`<arch>-<os>`, such as `x86_64-windows`; `*` is every kind).
struct Pinned {
    id: &'static str,
    version: &'static str,
    per_target: &'static [(&'static str, Pin)],
}

impl Pin {
    /// Whether this is a pin that can be downloaded against: a SHA-256 of 64
    /// hex digits and a size. The LaTeX engine's pins are `TODO_PIN` until
    /// their values are supplied, and such a pin is no pin.
    pub fn is_real(&self) -> bool {
        self.sha256.len() == 64
            && self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            && self.size > 0
    }
}

/// The pins this build knows.
const PINNED: &[Pinned] = &[
    Pinned {
        id: "diagrams",
        version: pinned::VERSION,
        per_target: &[(
            "*",
            Pin {
                url: pinned::URL,
                sha256: pinned::SHA256,
                size: pinned::SIZE,
            },
        )],
    },
    Pinned {
        id: "latex",
        version: latex_pinned::VERSION,
        per_target: latex_pinned::PER_TARGET,
    },
];

/// Every pin declared for plugin `id`, real or not: its version and one
/// (target, pin) for each kind of computer. For the release check.
#[cfg(test)]
pub fn declared(id: &str) -> Option<(&'static str, &'static [(&'static str, Pin)])> {
    let found = PINNED.iter().find(|p| p.id == id)?;
    Some((found.version, found.per_target))
}

/// The kind of computer this is, as the pins name it.
pub fn target() -> String {
    format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS)
}

fn pick(pinned: &Pinned, target: &str) -> Option<Pin> {
    pinned
        .per_target
        .iter()
        .find(|(t, _)| *t == target)
        .or_else(|| pinned.per_target.iter().find(|(t, _)| *t == "*"))
        .map(|(_, pin)| *pin)
}

/// The version and pin of plugin `id`'s payload for `target`, if it has one
/// that can be downloaded against.
pub fn for_target(id: &str, target: &str) -> Option<(&'static str, Pin)> {
    let found = PINNED.iter().find(|p| p.id == id)?;
    pick(found, target)
        .filter(Pin::is_real)
        .map(|pin| (found.version, pin))
}

/// `for_target` for this computer.
pub fn current(id: &str) -> Option<(&'static str, Pin)> {
    for_target(id, &target())
}

/// The release to install for plugin `id` on this computer.
pub fn source(id: &str) -> Option<Source> {
    let (version, pin) = current(id)?;
    Some(Source {
        version: version.to_owned(),
        url: pin.url.to_owned(),
        sha256: pin.sha256.to_owned(),
        size: pin.size,
    })
}
