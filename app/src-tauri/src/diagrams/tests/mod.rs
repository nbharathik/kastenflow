//! The diagram editor's installer and its `diagrams` scheme, against a fake
//! WAR built here and a one-purpose web server on 127.0.0.1. The real
//! release is never downloaded: these tests prove the rules (the pinned hash,
//! the unpacking limits, the paths, what is served and how), not draw.io.

mod extract;
mod install;
mod protocol;
mod support;
