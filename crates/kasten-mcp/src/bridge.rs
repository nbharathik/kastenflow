//! The mailbox between this server and the desktop app (kasten-core's
//! `bridge`), with the care the MCP token gets: ids from the operating
//! system's random source, and files only their owner can read (owner-only
//! access lists on Windows, permission bits elsewhere). The app opens its side
//! with the same platform.

use std::path::Path;

use kasten_core::bridge::{Mailbox, Platform};
use kasten_core::{Kasten, Result};

/// The strict platform for the mailbox.
pub fn platform() -> Platform {
    Platform {
        write: crate::token::write_private_bytes,
        is_private: crate::token::private_file,
        random_id: crate::token::random_hex,
    }
}

/// The mailbox of the vault at `root`.
pub fn mailbox(root: &Path) -> Result<Mailbox> {
    Mailbox::open(root, platform())
}

/// The mailbox of an open vault.
pub fn mailbox_of(kasten: &Kasten) -> Result<Mailbox> {
    mailbox(kasten.root())
}
