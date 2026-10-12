//! The one draw.io release Kasten installs, and what it must be. Upgrading is
//! a deliberate change of these four values: the editor's embed protocol
//! shifts between versions, so what the app speaks to it is tied to this one.

/// The version of the diagram editor (draw.io, diagrams.net; Apache-2.0).
pub const VERSION: &str = "32.2.0";
/// Where the release's web app is downloaded from.
pub const URL: &str = "https://github.com/jgraph/drawio/releases/download/v32.2.0/draw.war";
/// The SHA-256 of the download, which must match before anything is unpacked.
pub const SHA256: &str = "32b9aa48b9b4dfb8b70b8c3a47bc2ee4265ae462bbce1b53492d30ef79916c5d";
/// The size of the download, in bytes.
pub const SIZE: u64 = 48_235_802;

/// A release to install: where it is, how big it is and what it hashes to.
#[derive(Debug, Clone)]
pub struct Source {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

impl Source {
    /// The release Kasten is built for.
    pub fn pinned() -> Source {
        Source {
            version: VERSION.to_owned(),
            url: URL.to_owned(),
            sha256: SHA256.to_owned(),
            size: SIZE,
        }
    }
}
