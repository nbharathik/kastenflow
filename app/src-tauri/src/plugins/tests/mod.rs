//! The plugin platform: the shared payload installer against a one-purpose
//! web server on 127.0.0.1 (the real releases are never downloaded), and the
//! catalog and the guard that every plugin command calls first.

mod catalog;
mod latex_pins;
mod payload;
