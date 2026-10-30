//! Helpers for the LaTeX tests: scratch folders, a document in a scratch
//! vault, and a fake engine. No TeX is needed: the "engine" is this test
//! program itself, started again with `fake_engine` as the only test to run
//! (`wrap` swaps a real command for it), and it does what the mode in its
//! environment says: make a PDF and a log, fail, hang, or start a helper
//! that keeps writing to a file so a test can see whether the whole tree of
//! processes was ended.

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use crate::plugins::latex::build::Job;
use crate::plugins::latex::engines::{CommandSpec, Engine, Origin, Resolved};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A scratch folder that goes when the test ends.
pub struct Dir(PathBuf);

impl Dir {
    pub fn new(name: &str) -> Dir {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("kasten-latex-{name}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Dir(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn join(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Makes a symbolic link at `at` to `target`; false (and a note in the test
/// output) on a machine that does not let a test make links.
pub fn link(target: &Path, at: &Path, dir: bool) -> bool {
    #[cfg(windows)]
    let made = if dir {
        std::os::windows::fs::symlink_dir(target, at).is_ok()
    } else {
        std::os::windows::fs::symlink_file(target, at).is_ok()
    };
    #[cfg(unix)]
    let made = {
        let _ = dir;
        std::os::unix::fs::symlink(target, at).is_ok()
    };
    if !made {
        eprintln!("SKIPPED: this machine does not let a test make links");
    }
    made
}

/// Writes `text` at `rel` under `base`, making the folders.
pub fn put(base: &Path, rel: &str, text: &str) {
    let path = base.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

pub const FOLDER: &str = "projects/p/latex/a";

/// A vault with one document: `main.tex` and `sections/intro.tex`.
pub fn vault(dir: &Dir) -> PathBuf {
    let root = dir.join("vault");
    put(
        &root,
        &format!("{FOLDER}/main.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n",
    );
    put(&root, &format!("{FOLDER}/sections/intro.tex"), "Hello.\n");
    put(&root, "notes/secret.md", "do not read\n");
    root
}

/// A job for the document in `vault`, built with `engine`.
pub fn job(root: &Path, engine: Engine) -> Job {
    Job {
        folder: FOLDER.to_owned(),
        root: root.to_path_buf(),
        main: "main.tex".to_owned(),
        engine: Resolved {
            engine,
            program: PathBuf::from("not-used-the-fake-engine-runs-instead"),
            origin: Origin::Payload,
        },
        package_cache: root.join("..").join("packages"),
        buffers: Vec::new(),
        vault_bib: false,
        timeout: Duration::from_secs(60),
        scratch: None,
    }
}

/// The part of this test's own name that selects `fake_engine` to run.
fn entry_name() -> String {
    let path = module_path!();
    let inside = path.split_once("::").map_or(path, |(_, rest)| rest);
    format!("{inside}::fake_engine")
}

/// A wrapper that turns any engine command into a run of the fake engine in
/// `mode`, which writes into `out` (see `fake`). `beat` is the file a helper
/// process writes to.
pub fn wrap(
    mode: &'static str,
    out: PathBuf,
    stem: &'static str,
    beat: Option<PathBuf>,
) -> impl Fn(CommandSpec) -> CommandSpec {
    move |spec| {
        let argv: Vec<String> = spec
            .args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let mut env = spec.env.clone();
        let mut set = |key: &str, value: OsString| env.push((OsString::from(key), value));
        set("KASTEN_FAKE_ENGINE", mode.into());
        set("KASTEN_FAKE_ARGV", argv.join("\u{1f}").into());
        set("KASTEN_FAKE_OUT", out.clone().into_os_string());
        set("KASTEN_FAKE_STEM", stem.into());
        if let Some(beat) = &beat {
            set("KASTEN_FAKE_BEAT", beat.clone().into_os_string());
        }
        CommandSpec {
            program: std::env::current_exe().unwrap(),
            args: vec![
                "--exact".into(),
                entry_name().into(),
                "--nocapture".into(),
                "--test-threads=1".into(),
            ],
            env,
            cwd: spec.cwd,
        }
    }
}

fn need(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

/// The fake engine. As a test it does nothing; started by `wrap` it does
/// what `KASTEN_FAKE_ENGINE` says and ends the process.
#[test]
fn fake_engine() {
    let Ok(mode) = std::env::var("KASTEN_FAKE_ENGINE") else {
        return;
    };
    let out = PathBuf::from(need("KASTEN_FAKE_OUT"));
    let stem = need("KASTEN_FAKE_STEM");
    let _ = fs::create_dir_all(&out);
    // What the engine was given, for the test to read.
    let mut seen = need("KASTEN_FAKE_ARGV").replace('\u{1f}', "\n");
    for key in [
        "TECTONIC_CACHE_DIR",
        "TECTONIC_UNTRUSTED_MODE",
        "openin_any",
        "openout_any",
    ] {
        seen.push_str(&format!("\n{key}={}", need(key)));
    }
    seen.push_str(&format!(
        "\ncwd={}",
        std::env::current_dir().unwrap().display()
    ));
    // The files it can see from where it runs, to show what the tree held.
    let mut files: Vec<String> = fs::read_dir(".")
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    seen.push_str(&format!("\nfiles={}", files.join(",")));
    if let Ok(text) = fs::read_to_string("sections/intro.tex") {
        seen.push_str(&format!("\nintro={}", text.trim()));
    }
    let _ = fs::write(out.join("seen.txt"), seen);
    let pdf = || {
        let _ = fs::write(out.join(format!("{stem}.pdf")), "%PDF-1.4\nfake\n");
    };
    let log = |text: &str| {
        let _ = fs::write(out.join(format!("{stem}.log")), text);
    };
    let code = match mode.as_str() {
        "ok" => {
            eprintln!("note: downloading a package");
            pdf();
            log("(./main.tex\n)\n");
            0
        }
        "fail" => {
            log("(./main.tex\n! Undefined control sequence.\nl.3 \\foo\n\n)\n");
            1
        }
        "escape" => {
            // The tree itself, as an engine that prints full paths names it.
            let inside = std::env::current_dir()
                .unwrap()
                .display()
                .to_string()
                .replace('\\', "/");
            log(&format!(
                "(/etc/passwd\n! Undefined control sequence.\nl.1 \\a\n\n)\n\
                 (../../notes/secret.md\n! Missing $ inserted.\nl.2 x\n\n)\n\
                 (C:\\Windows\\win.ini\n! Undefined control sequence.\nl.3 \\y\n\n)\n\
                 (./sections/intro.tex\n! Undefined control sequence.\nl.4 \\b\n\n)\n\
                 (./missing.tex\n! Undefined control sequence.\nl.5 \\c\n\n)\n\
                 ({inside}/sections/intro.tex\n! Undefined control sequence.\nl.6 \\d\n\n)\n"
            ));
            1
        }
        "silent" => {
            // On stdout, after the test program's own "test … ..." start, so it is the last line.
            println!("fatal: the engine is confused");
            3
        }
        "nopdf" => {
            log("(./main.tex\n)\n");
            0
        }
        "noisy" => {
            let line = "x".repeat(200);
            for _ in 0..20_000 {
                eprintln!("{line}");
            }
            println!("the last line");
            pdf();
            0
        }
        "hang" => loop {
            std::thread::sleep(Duration::from_millis(50));
        },
        "tree" => {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", &entry_name(), "--nocapture", "--test-threads=1"])
                .env("KASTEN_FAKE_ENGINE", "heartbeat")
                .env("KASTEN_FAKE_BEAT", need("KASTEN_FAKE_BEAT"))
                .env("KASTEN_FAKE_OUT", out.as_os_str())
                .env("KASTEN_FAKE_STEM", &stem)
                .spawn();
            let _keep = child;
            loop {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        "chatty" => {
            // Prints a line and writes a beat, over and over.
            let mut beat = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(need("KASTEN_FAKE_BEAT"))
                .unwrap();
            loop {
                println!("still working");
                let _ = beat.write_all(b".");
                let _ = beat.flush();
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        "heartbeat" => {
            let mut beat = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(need("KASTEN_FAKE_BEAT"))
                .unwrap();
            loop {
                let _ = beat.write_all(b".");
                let _ = beat.flush();
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        _ => 9,
    };
    std::process::exit(code);
}
