//! Calendar subscriptions, read-only: the person pastes the address of a
//! calendar feed (an `.ics` address, such as Google's "secret address in
//! iCal format" or an Outlook published calendar), and its events show in
//! the Calendar and on Home beside their own notes. Nothing is ever written
//! back to the calendar, and nothing is written to the vault.
//!
//! - `ics` reads feeds, with its own parser and recurrence code;
//! - `fetch` gets a feed over the web (conditional, limited);
//! - `store` keeps the list, the addresses (in the keychain) and the copies;
//! - `service` and `refresh` are what the commands do, and `commands` the
//!   Tauri side.

pub mod commands;
mod fetch;
pub mod ics;
mod refresh;
mod service;
mod store;

#[cfg(test)]
mod service_tests;
#[cfg(test)]
mod test_server;

pub use commands::start;
pub use service::Calendars;
