//! Kasten Slides drawn by a headless Chrome or Chromium.
//!
//! [`Renderer`] keeps a browser running with one page in it, the render page (`packages/slides-render-page`, built
//! into the program), and draws decks with it: one slide or a grid of them as PNG, the deck as PDF, as the offline
//! HTML export, and the size that the words of every element come out at, which lint needs to tell whether text
//! fits its box. The browser is never on a network: every request the page makes is answered by this program, from
//! the page's own files and the deck's pictures, and anything else is refused.
//!
//! Without a Chrome, Chromium or Edge on the machine, [`Renderer::launch`] says so ([`Error::NoBrowser`]) and
//! nothing can be drawn; the rest of Kasten Slides does not need one.
//!
//! # Safety
//!
//! A deck can come from an agent, and the browser decodes the pictures it names, so the browser runs in its sandbox.
//! Only a person switches that off (`SLIDES_RENDER_NO_SANDBOX=1`, or [`Options::no_sandbox`] in a program); it is
//! never dropped because something failed, and as the administrator, where the browser cannot sandbox, nothing is
//! started without that. The folders made for the browser are private to the user ([`private`]). It is driven over a
//! debugging port on the loopback interface that has no password: see the README about machines shared with others.
//!
//! # Building
//!
//! The render page is built by `node scripts/build-render-page.mjs` (`just render-page`) and embedded by
//! `build.rs`, so build it before the program. Without it everything still compiles, [`Renderer::launch`] fails
//! with [`Error::NoPage`], and the tests that need a browser print `SKIPPED` and pass.

pub mod browser;
pub mod bundle;
pub mod error;
mod jobs;
mod launch;
pub mod media;
pub mod private;
pub mod profile;
pub mod references;
mod renderer;
pub mod route;
mod serve;
mod session;
mod shared;
mod types;
mod worker;

pub use browser::find_browser;
pub use error::{Error, Result};
pub use media::{FolderMedia, Media, NoMedia};
pub use renderer::{Options, Renderer};
pub use shared::{
    Draw, IDLE, draw, draw_with, measure, measure_with, shared, shared_with, shutdown,
};
pub use types::{HtmlFile, HtmlOptions, Pdf, PdfOptions, Picture, Png, PngOptions, Scope, Steps};
