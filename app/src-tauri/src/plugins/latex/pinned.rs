//! The one Tectonic release the LaTeX plugin installs, for each kind of
//! computer. Upgrading is a deliberate change of this file: the command line
//! the app builds (`engines.rs`) was written for this version.
//!
//! The checksums and sizes below are still to be supplied. They are marked
//! `TODO_PIN` on purpose: such a pin is never offered for download (the
//! plugin says the engine cannot be installed from this build, and a person's
//! own TeX installation still works), and the release check
//! (`cargo test --release plugins::tests::latex_pins`) fails until all four
//! are real. To fill one in: download the release file at its URL (check the
//! file name against the release's asset list), take its SHA-256
//! (`sha256sum`, or `Get-FileHash` on Windows) and its size in bytes, and
//! check that `tectonic -X compile --help` lists every flag
//! `engines::command` passes.

use crate::plugins::pins::Pin;

/// The placeholder for a value still to be supplied.
pub const TODO_PIN: &str = "TODO_PIN";

/// The Tectonic release (MIT licence).
pub const VERSION: &str = "0.15.0";

/// A pin for each kind of computer (`<arch>-<os>`).
pub const PER_TARGET: &[(&str, Pin)] = &[
    (
        "x86_64-windows",
        Pin {
            url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-pc-windows-msvc.zip",
            sha256: TODO_PIN,
            size: 0,
        },
    ),
    (
        "x86_64-linux",
        Pin {
            url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz",
            sha256: TODO_PIN,
            size: 0,
        },
    ),
    (
        "aarch64-macos",
        Pin {
            url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-aarch64-apple-darwin.tar.gz",
            sha256: TODO_PIN,
            size: 0,
        },
    ),
    (
        "x86_64-macos",
        Pin {
            url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-apple-darwin.tar.gz",
            sha256: TODO_PIN,
            size: 0,
        },
    ),
];
