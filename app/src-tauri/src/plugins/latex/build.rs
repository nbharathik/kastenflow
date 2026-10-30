//! One build, start to end: the tree is made from the document's folder and
//! the unsaved buffers, the engine runs in it, and what it left (log, PDF) is
//! read back into an outcome. Output goes to the vault's cache only.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use super::cache::forget;
use super::collect::{Reading, diagnostics, pdf_path, pdf_stamp};
use super::engines::{CommandSpec, Resolved, command};
use super::paths::{plain_dir, plain_folders_below};
use super::proc::{End, run};
use super::service::{BuildError, Ended, Outcome};
use super::snapshot::{Buffer, Places, VAULT_BIB, check_buffers, sync};

/// Everything one build needs, decided when it was asked for.
#[derive(Debug)]
pub struct Job {
    /// The document's folder, as a vault path: the document's name.
    pub folder: String,
    /// The vault's folder on disk.
    pub root: PathBuf,
    /// The root file, relative to the folder.
    pub main: String,
    pub engine: Resolved,
    /// Where Tectonic keeps the TeX packages it fetches.
    pub package_cache: PathBuf,
    /// Unsaved text from the window.
    pub buffers: Vec<Buffer>,
    /// Copy the vault's bibliography in as `references.bib`.
    pub vault_bib: bool,
    pub timeout: Duration,
    /// A preview of text that is not saved: the build is made in a scratch
    /// folder of this name (see `preview_dir`), so neither the document's own
    /// build, nor its last good PDF, nor its log are touched.
    pub scratch: Option<String>,
}

/// Where previews are built: below the vault's cache, one folder for each.
pub const PREVIEW_PARENT: &str = ".kasten/cache/latex-preview";

/// The scratch folder of the preview called `name` (a plain name).
pub fn preview_dir(name: &str) -> String {
    format!("{PREVIEW_PARENT}/{name}")
}

impl Job {
    pub fn src(&self) -> PathBuf {
        self.root.join(&self.folder)
    }

    /// This document's folder in the vault's cache (or the preview's scratch folder).
    pub fn build(&self) -> PathBuf {
        match &self.scratch {
            Some(name) => self.root.join(preview_dir(name)),
            None => self.root.join(kasten_core::latex::build_dir(&self.folder)),
        }
    }

    pub fn tree(&self) -> PathBuf {
        self.build().join("tree")
    }

    pub fn out(&self) -> PathBuf {
        self.build().join("out")
    }

    /// The root file's name without its ending: what the engine names its output by.
    pub fn stem(&self) -> String {
        stem_of(&self.main)
    }
}

/// The tree and the output folder of the document in `folder`'s last build,
/// when the way to them in the cache holds no link.
pub fn built_places(root: &Path, folder: &str) -> Option<(PathBuf, PathBuf)> {
    let rel = kasten_core::latex::build_dir(folder);
    let (tree, out) = (format!("{rel}/tree"), format!("{rel}/out"));
    (plain_folders_below(root, &tree) && plain_folders_below(root, &out))
        .then(|| (root.join(tree), root.join(out)))
}

pub fn stem_of(main: &str) -> String {
    Path::new(main)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The text of a note for a line the engine printed, when it says packages
/// are being fetched (Tectonic does, the first time).
fn note_for(line: &str) -> Option<&'static str> {
    line.to_ascii_lowercase()
        .contains("download")
        .then_some("Downloading TeX packages…")
}

/// Builds `job`. `cancel` stops it; `note` hears what a long build is doing;
/// `wrap` may change the command before it runs (it is the identity for a
/// real build).
pub fn execute(
    job: &Job,
    cancel: &AtomicBool,
    note: &dyn Fn(&str),
    wrap: &dyn Fn(CommandSpec) -> CommandSpec,
) -> Outcome {
    let started = Instant::now();
    let ms = || started.elapsed().as_millis() as u64;
    let (src, build, tree, out) = (job.src(), job.build(), job.tree(), job.out());
    let vault_bib = job
        .vault_bib
        .then(|| job.root.join("sources").join(VAULT_BIB));
    let places = Places {
        root: &job.root,
        src: &src,
        build: &build,
        tree: &tree,
        folder: &job.folder,
    };
    if let Err(why) = sync(&places, &job.buffers, vault_bib.as_deref()) {
        return Outcome::failed(BuildError::new("snapshot", why.to_string()), ms());
    }
    if let Err(err) = std::fs::create_dir_all(&out) {
        let why = format!("Could not make the build's output folder: {err}");
        return Outcome::failed(BuildError::new("snapshot", why), ms());
    }
    if !plain_dir(&out) {
        let why = "The build's output folder is not a plain folder";
        return Outcome::failed(BuildError::new("snapshot", why), ms());
    }
    // latexmk writes `\include`d chapters' files into the same folders below `out`.
    if job.engine.engine.is_latexmk() {
        super::out_dirs::mirror_folders(&tree, &out);
    }
    let stem = job.stem();
    let pdf = pdf_path(&out, &stem);
    let before = pdf_stamp(&pdf);
    // The last build's log is not this build's: without one, the log is read as empty.
    forget(&build, &out.join(format!("{stem}.log")));
    let spec = wrap(command(
        job.engine.engine,
        &job.engine.program,
        &job.main,
        &tree,
        &out,
        &job.package_cache,
    ));
    let _ = std::fs::create_dir_all(&job.package_cache);
    let mut told = false;
    let ran = run(&spec, job.timeout, cancel, &mut |line| {
        if !told && let Some(text) = note_for(line) {
            told = true;
            note(text);
        }
    });
    let ran = match ran {
        Ok(ran) => ran,
        Err(err) => {
            let why = format!("The LaTeX engine could not be started: {err}");
            return Outcome::failed(BuildError::new("engine-failed", why), ms());
        }
    };
    let ms = ran.ms;
    let ok = match ran.end {
        End::Cancelled => {
            return Outcome {
                ended: Ended::Cancelled,
                ms,
                diagnostics: Vec::new(),
                pdf: false,
                error: None,
            };
        }
        End::TimedOut => false,
        End::Exited(code) => code == Some(0),
    };
    let unsaved: HashSet<String> = check_buffers(&job.folder, &job.buffers)
        .map(|b| b.into_keys().collect())
        .unwrap_or_default();
    let reading = Reading {
        src: &src,
        tree: &tree,
        out: &out,
        stem: &stem,
        engine: job.engine.engine,
        unsaved: &unsaved,
    };
    let found = diagnostics(&reading, &ran.output, !ok);
    // A PDF counts when this build wrote it, or when it succeeded and the
    // engine saw nothing to redo (latexmk leaves an up-to-date PDF alone).
    let after = pdf_stamp(&pdf);
    let pdf_made = after.is_some() && (after != before || ok);
    let error = match ran.end {
        End::TimedOut => Some(BuildError::new(
            "timeout",
            format!(
                "The build took longer than {} seconds, so it was stopped",
                job.timeout.as_secs()
            ),
        )),
        _ if ok && !pdf_made => Some(BuildError::new(
            "engine-failed",
            "The build finished without making a PDF",
        )),
        _ => None,
    };
    let ended = if ok && error.is_none() {
        Ended::Done
    } else {
        Ended::Failed
    };
    Outcome {
        ended,
        ms,
        diagnostics: found,
        pdf: pdf_made,
        error,
    }
}
