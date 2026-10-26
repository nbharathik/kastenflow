//! The programs that build a document and the exact way each is run. The
//! command lines are pure functions of their inputs, so what a build is
//! allowed to do (no shell escape, no files outside the tree and the output)
//! can be read and tested without running TeX. Which engine a document uses
//! is chosen here too: its settings, else the downloaded Tectonic, else the
//! person's own TeX installation, else a typed "no engine" answer.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// The engines a document can name (`kasten-latex.yaml`'s `engine`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Engine {
    Tectonic,
    LatexmkPdf,
    LatexmkXe,
    LatexmkLua,
}

impl Engine {
    pub fn parse(id: &str) -> Option<Engine> {
        match id {
            "tectonic" => Some(Engine::Tectonic),
            "latexmk-pdf" => Some(Engine::LatexmkPdf),
            "latexmk-xe" => Some(Engine::LatexmkXe),
            "latexmk-lua" => Some(Engine::LatexmkLua),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Engine::Tectonic => "tectonic",
            Engine::LatexmkPdf => "latexmk-pdf",
            Engine::LatexmkXe => "latexmk-xe",
            Engine::LatexmkLua => "latexmk-lua",
        }
    }

    pub fn is_latexmk(self) -> bool {
        self != Engine::Tectonic
    }

    /// latexmk's flag for the TeX it drives.
    fn flavour(self) -> &'static str {
        match self {
            Engine::LatexmkXe => "-xelatex",
            Engine::LatexmkLua => "-lualatex",
            _ => "-pdf",
        }
    }
}

/// A program to run: where, with what, in which folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(OsString, OsString)>,
    pub cwd: PathBuf,
}

fn os(text: &str) -> OsString {
    OsString::from(text)
}

/// The root file as the engine's argument. A file name is document content,
/// and one that starts with `-` would be read as an option (latexmk's
/// `-pdflatex=…` names a program to run, `-shell-escape` undoes the safe
/// flags before it), so such a name is given as `./name`.
pub fn main_argument(main: &str) -> String {
    if main.starts_with('-') {
        format!("./{main}")
    } else {
        main.to_owned()
    }
}

/// How `engine` (the program at `program`) builds `main` (a path inside
/// `tree`, the folder the build runs in) into `out`. TeX can read the tree
/// and write the tree and `out` and nothing else: shell escape is off in
/// every engine, Tectonic runs untrusted, and TeX Live's paranoid file
/// access (`openin_any`, `openout_any`) keeps it inside the current folder.
/// `cache` is where Tectonic keeps the TeX packages it downloads.
pub fn command(
    engine: Engine,
    program: &Path,
    main: &str,
    tree: &Path,
    out: &Path,
    cache: &Path,
) -> CommandSpec {
    let main = &main_argument(main);
    let (args, env) = match engine {
        Engine::Tectonic => (
            vec![
                os("-X"),
                os("compile"),
                os(main),
                os("--outdir"),
                out.as_os_str().to_owned(),
                os("--synctex"),
                os("--keep-intermediates"),
                os("--keep-logs"),
                os("--untrusted"),
            ],
            vec![
                (os("TECTONIC_CACHE_DIR"), cache.as_os_str().to_owned()),
                (os("TECTONIC_UNTRUSTED_MODE"), os("1")),
            ],
        ),
        _ => {
            let mut outdir = os("-outdir=");
            outdir.push(out);
            (
                vec![
                    os(engine.flavour()),
                    os("-interaction=nonstopmode"),
                    os("-synctex=1"),
                    os("-no-shell-escape"),
                    // A `latexmkrc` is a Perl program: none is read.
                    os("-norc"),
                    outdir,
                    os(main),
                ],
                vec![
                    (os("openout_any"), os("p")),
                    (os("openin_any"), os("p")),
                    // On Windows, helpers latexmk starts are not looked for in the build
                    // folder first, where a document could have written one.
                    (os("NoDefaultCurrentDirectoryInExePath"), os("1")),
                ],
            )
        }
    };
    CommandSpec {
        program: program.to_path_buf(),
        args,
        env,
        cwd: tree.to_path_buf(),
    }
}

/// Where a program called `name` is on `path_var` (a `PATH`). Only absolute
/// entries count (never the current folder, never a name relative to it) and
/// only a plain file; on Windows the name is looked for as a `.exe`.
pub fn find_program(name: &str, path_var: &OsStr) -> Option<PathBuf> {
    for dir in std::env::split_paths(path_var) {
        if !dir.is_absolute() {
            continue;
        }
        let candidate = if cfg!(windows) {
            dir.join(format!("{name}.exe"))
        } else {
            dir.join(name)
        };
        if std::fs::metadata(&candidate).is_ok_and(|m| m.is_file()) {
            return Some(candidate);
        }
    }
    None
}

/// What was found on this computer.
#[derive(Debug, Clone, Default)]
pub struct Found {
    /// The Tectonic the plugin downloaded.
    pub payload: Option<PathBuf>,
    /// `latexmk` on the `PATH`.
    pub latexmk: Option<PathBuf>,
}

/// Where the engine that was chosen comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Downloaded by the plugin.
    Payload,
    /// The person's own TeX installation.
    Path,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub engine: Engine,
    pub program: PathBuf,
    pub origin: Origin,
}

/// What to do about a missing engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Next {
    #[serde(rename = "install-tectonic")]
    InstallTectonic,
    #[serde(rename = "install-tex")]
    InstallTex,
}

/// No engine to build with, and the one thing that fixes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoEngine {
    pub message: String,
    pub next: Next,
}

/// The engine for a document whose settings name `chosen` (nothing: it has no
/// choice): the one it names, else the downloaded Tectonic, else the
/// person's `latexmk`.
pub fn choose(chosen: Option<&str>, found: &Found) -> Result<Resolved, NoEngine> {
    let payload = |engine| {
        found.payload.as_ref().map(|program| Resolved {
            engine,
            program: program.clone(),
            origin: Origin::Payload,
        })
    };
    let latexmk = |engine| {
        found.latexmk.as_ref().map(|program| Resolved {
            engine,
            program: program.clone(),
            origin: Origin::Path,
        })
    };
    match chosen.and_then(Engine::parse) {
        Some(Engine::Tectonic) => payload(Engine::Tectonic).ok_or_else(|| NoEngine {
            message: "This document builds with Tectonic, which is not installed yet. Install it in Settings → Plugins → LaTeX, or choose your own TeX installation for this document.".to_owned(),
            next: Next::InstallTectonic,
        }),
        Some(engine) => latexmk(engine).ok_or_else(|| NoEngine {
            message: "This document builds with your TeX installation, but latexmk was not found. Install TeX Live (or MiKTeX), or switch the document to Tectonic.".to_owned(),
            next: Next::InstallTex,
        }),
        None => payload(Engine::Tectonic)
            .or_else(|| latexmk(Engine::LatexmkPdf))
            .ok_or_else(|| NoEngine {
                message: "There is no LaTeX engine to build with. Install Tectonic in Settings → Plugins → LaTeX, or install TeX Live and KastenFlow will use it.".to_owned(),
                next: Next::InstallTectonic,
            }),
    }
}

/// The file name of the program the Tectonic payload holds.
pub const TECTONIC_PROGRAM: &str = if cfg!(windows) {
    "tectonic.exe"
} else {
    "tectonic"
};

/// The Tectonic installed under `root` (the plugin's payload folder) at
/// `version`, when the copy is whole.
pub fn payload_program(root: &Path, version: &str) -> Option<PathBuf> {
    let dir = root.join(version);
    let marked = std::fs::read_to_string(dir.join(crate::plugins::payload::VERSION_FILE)).ok()?;
    let program = dir.join(TECTONIC_PROGRAM);
    (marked.trim() == version && program.is_file()).then_some(program)
}
