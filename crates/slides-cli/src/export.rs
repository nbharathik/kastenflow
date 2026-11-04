//! `slides export <deck> -o <out.pptx> [--assets <dir>] [--steps expand|final]`: the
//! deck as a PowerPoint file (or, for `-o out.pdf`, `out.png` and `out.html`, drawn by a browser: see `drawn`). Pictures are read from the assets folder, which is the
//! deck's own folder unless `--assets` names another. A slide with steps is a slide
//! for each state, or with `--steps final` just the state after the last click. A
//! citation is written as the editor draws it (its label or number, the list of
//! references) from the `.bib` files beside the deck, and as its keys where there are none.

use std::fs;
use std::path::{Component, Path, PathBuf};

use slides_pptx::{Media, Options, StepsMode, export_with, pages};

use crate::args::Args;
use crate::commands::Failure;
use crate::{deckfile, drawn, refs};

/// The pictures of a deck, read from a folder and never from outside it.
struct Folder {
    /// The folder, as the file system spells it, so that a link out of it can be seen.
    root: PathBuf,
}

/// The path a deck names a picture by, if it stays inside the folder it is
/// relative to: no `..`, no root or drive, no backslash to mean either on
/// another system.
fn inside(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains(['\\', '\0']) {
        return None;
    }
    let mut clean = PathBuf::new();
    for part in Path::new(path).components() {
        match part {
            Component::Normal(name) => clean.push(name),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

impl Media for Folder {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        let real = self.root.join(inside(path)?).canonicalize().ok()?;
        // A link inside the folder may point out of it; that is out of bounds too.
        real.starts_with(&self.root)
            .then(|| fs::read(real).ok())
            .flatten()
    }
}

/// What a slide with steps becomes: `--steps expand` (the default) or `--steps final`.
fn steps_mode(args: &Args) -> Result<StepsMode, Failure> {
    match args.value("steps") {
        None | Some("expand") => Ok(StepsMode::Expand),
        Some("final") => Ok(StepsMode::Final),
        Some("animate") => Ok(StepsMode::Animate),
        Some(other) => Err(Failure::Usage(format!(
            "--steps is `expand` (a slide for each state), `final` (the last state only) or `animate` (one slide with PowerPoint animations), not `{other}`"
        ))),
    }
}

pub fn run(args: &Args) -> Result<(), Failure> {
    let (deck_path, out) = drawn::paths(args, "export")?;
    // PDF, PNG pictures and the offline web page are drawn by a browser; PowerPoint is written.
    if let Some(format) = drawn::Format::of(args, out.as_deref())? {
        return drawn::export(args, &deck_path, out, format);
    }
    let options = Options {
        steps: steps_mode(args)?,
        ..Options::default()
    };
    let out = out.unwrap_or_else(|| deck_path.with_extension("pptx"));
    let deck = deckfile::read(&deck_path)?;
    let root = drawn::assets_dir(args, &deck_path)?;
    let refs = refs::beside(&deck_path);
    let exported = export_with(&deck, &Folder { root }, &options, refs.as_ref())
        .map_err(|e| Failure::Error(e.to_string()))?;
    for warning in &exported.warnings {
        eprintln!(
            "warning: {}{}{}",
            warning
                .slide
                .as_deref()
                .map(|s| format!("slide {s}: "))
                .unwrap_or_default(),
            warning
                .element
                .as_deref()
                .map(|e| format!("element {e}: "))
                .unwrap_or_default(),
            warning.message
        );
    }
    drawn::write_file(&out, &exported.bytes)?;
    let written = pages(&deck, &options).len();
    let from = if written == deck.slides.len() {
        String::new()
    } else {
        format!(" from {} in the deck", deck.slides.len())
    };
    println!(
        "Wrote {} ({written} slides{from}, {} warnings)",
        out.display(),
        exported.warnings.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_path_inside_the_folder_is_kept() {
        assert_eq!(
            inside("assets/figure.png"),
            Some(PathBuf::from("assets/figure.png"))
        );
        assert_eq!(inside("./a/./b.png"), Some(PathBuf::from("a/b.png")));
    }

    #[test]
    fn a_path_that_leaves_the_folder_is_refused() {
        for bad in [
            "",
            ".",
            "../secret.png",
            "a/../../secret.png",
            "a/..",
            "/etc/passwd",
            "C:\\x.png",
            "a\\b.png",
            "a\0b",
        ] {
            assert_eq!(inside(bad), None, "{bad:?}");
        }
        #[cfg(windows)]
        assert_eq!(inside("C:x.png"), None);
    }

    #[test]
    fn a_link_out_of_the_folder_is_not_followed() {
        let dir = std::env::temp_dir().join(format!("slides-export-{}", std::process::id()));
        let inner = dir.join("assets");
        fs::create_dir_all(&inner).unwrap_or_else(|e| panic!("{e}"));
        fs::write(dir.join("secret.txt"), b"secret").unwrap_or_else(|e| panic!("{e}"));
        fs::write(inner.join("ok.txt"), b"fine").unwrap_or_else(|e| panic!("{e}"));
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("secret.txt"), inner.join("link.txt"))
            .unwrap_or_else(|e| panic!("{e}"));
        let folder = Folder {
            root: inner.canonicalize().unwrap_or_else(|e| panic!("{e}")),
        };
        assert_eq!(folder.read("ok.txt"), Some(b"fine".to_vec()));
        assert_eq!(folder.read("../secret.txt"), None);
        assert_eq!(folder.read("missing.txt"), None);
        #[cfg(unix)]
        assert_eq!(folder.read("link.txt"), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
