//! What the server and the commands share: the paired list, the code waiting,
//! the limits, whether the door is open, and the two things the app lends
//! (the open vault, and a way to tell the window something was written).

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};

use kasten_core::Kasten;

use super::limit::Limits;
use super::pairing::Pairing;
use super::store::Store;

/// The open vault, or why none is open.
pub(super) type VaultFn = Box<dyn Fn() -> Result<Arc<Kasten>, String> + Send + Sync>;
/// Tells the window which files a capture wrote.
pub(super) type ChangedFn = Box<dyn Fn(Vec<String>) + Send + Sync>;

pub(super) struct Shared {
    pub vault: VaultFn,
    pub changed: ChangedFn,
    pub store: Mutex<Store>,
    pub pairing: Mutex<Pairing>,
    pub limits: Mutex<Limits>,
    /// The switch in Settings: while off, every request is refused.
    pub on: AtomicBool,
}

impl Shared {
    pub fn new(
        vault: VaultFn,
        changed: ChangedFn,
        store: Store,
        pairing: Pairing,
        limits: Limits,
    ) -> Shared {
        Shared {
            vault,
            changed,
            store: Mutex::new(store),
            pairing: Mutex::new(pairing),
            limits: Mutex::new(limits),
            on: AtomicBool::new(false),
        }
    }
}

/// A lock that a panic elsewhere did not poison for good.
pub(super) fn held<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
