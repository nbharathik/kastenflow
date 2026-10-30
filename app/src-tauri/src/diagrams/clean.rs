//! The diagram editor removes what its installer made through the plugin
//! installer's own helper (`plugins::clean`), which keeps to the app's data
//! folder and never reaches the vault.

pub(super) use crate::plugins::clean::forget_folder;
