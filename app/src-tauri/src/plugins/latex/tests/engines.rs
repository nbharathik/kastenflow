//! The command lines are exactly what they are meant to be, and the engine
//! is chosen the way the settings and the computer say.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use super::support::Dir;
use crate::plugins::latex::engines::{
    Engine, Found, Next, Origin, TECTONIC_PROGRAM, choose, command, find_program, main_argument,
    payload_program,
};

fn strings(args: &[OsString]) -> Vec<String> {
    args.iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

fn env(spec: &[(OsString, OsString)], key: &str) -> Option<String> {
    spec.iter()
        .find(|(k, _)| k == OsStr::new(key))
        .map(|(_, v)| v.to_string_lossy().into_owned())
}

fn tree() -> PathBuf {
    Path::new("tree").to_path_buf()
}

#[test]
fn tectonic_runs_untrusted_with_synctex_in_the_tree_and_a_cache_of_its_own() {
    let spec = command(
        Engine::Tectonic,
        Path::new("/app/tectonic"),
        "main.tex",
        &tree(),
        Path::new("out"),
        Path::new("cache"),
    );
    assert_eq!(spec.program, Path::new("/app/tectonic"));
    assert_eq!(spec.cwd, tree());
    assert_eq!(
        strings(&spec.args),
        [
            "-X",
            "compile",
            "main.tex",
            "--outdir",
            "out",
            "--synctex",
            "--keep-intermediates",
            "--keep-logs",
            "--untrusted",
        ]
    );
    assert_eq!(
        env(&spec.env, "TECTONIC_CACHE_DIR").as_deref(),
        Some("cache")
    );
    assert_eq!(
        env(&spec.env, "TECTONIC_UNTRUSTED_MODE").as_deref(),
        Some("1")
    );
}

#[test]
fn latexmk_never_allows_shell_escape_reads_no_settings_file_and_keeps_to_the_tree() {
    for (engine, flavour) in [
        (Engine::LatexmkPdf, "-pdf"),
        (Engine::LatexmkXe, "-xelatex"),
        (Engine::LatexmkLua, "-lualatex"),
    ] {
        let spec = command(
            engine,
            Path::new("/usr/bin/latexmk"),
            "sub/main.tex",
            &tree(),
            Path::new("out"),
            Path::new("cache"),
        );
        assert_eq!(
            strings(&spec.args),
            [
                flavour,
                "-interaction=nonstopmode",
                "-synctex=1",
                "-no-shell-escape",
                "-norc",
                "-outdir=out",
                "sub/main.tex",
            ],
            "{engine:?}"
        );
        assert_eq!(env(&spec.env, "openout_any").as_deref(), Some("p"));
        assert_eq!(env(&spec.env, "openin_any").as_deref(), Some("p"));
        assert_eq!(
            env(&spec.env, "NoDefaultCurrentDirectoryInExePath").as_deref(),
            Some("1")
        );
        assert_eq!(env(&spec.env, "TECTONIC_CACHE_DIR"), None);
        assert_eq!(spec.cwd, tree());
        // Never the flag that turns shell escape on.
        assert!(!strings(&spec.args).iter().any(|a| a == "-shell-escape"));
    }
}

#[test]
fn a_root_file_named_like_an_option_is_never_read_as_one() {
    // `-pdflatex=…` would name a program for latexmk to run; `-shell-escape`
    // would undo the safe flags before it. The name is only ever a file.
    for engine in [Engine::Tectonic, Engine::LatexmkPdf] {
        for main in ["-pdflatex=sh x.tex", "-shell-escape.tex", "--untrusted.tex"] {
            let spec = command(
                engine,
                Path::new("/app/program"),
                main,
                &tree(),
                Path::new("out"),
                Path::new("cache"),
            );
            let args = strings(&spec.args);
            let wanted = format!("./{main}");
            assert!(args.contains(&wanted), "{engine:?} {main}: {args:?}");
            assert!(
                !args.iter().any(|a| a.starts_with('-') && a.contains(main)),
                "{args:?}"
            );
        }
    }
    assert_eq!(main_argument("sub/-x.tex"), "sub/-x.tex");
    assert_eq!(main_argument("main.tex"), "main.tex");
}

#[test]
fn engine_ids_are_the_ones_the_settings_file_uses() {
    for (id, engine) in [
        ("tectonic", Engine::Tectonic),
        ("latexmk-pdf", Engine::LatexmkPdf),
        ("latexmk-xe", Engine::LatexmkXe),
        ("latexmk-lua", Engine::LatexmkLua),
    ] {
        assert_eq!(Engine::parse(id), Some(engine));
        assert_eq!(engine.id(), id);
    }
    assert_eq!(Engine::parse("pdflatex"), None);
    assert_eq!(Engine::parse(""), None);
    assert!(!Engine::Tectonic.is_latexmk() && Engine::LatexmkXe.is_latexmk());
}

fn found(payload: bool, latexmk: bool) -> Found {
    Found {
        payload: payload.then(|| PathBuf::from("/data/tectonic")),
        latexmk: latexmk.then(|| PathBuf::from("/usr/bin/latexmk")),
    }
}

#[test]
fn a_document_without_a_choice_uses_tectonic_then_the_installed_tex() {
    let both = choose(None, &found(true, true)).unwrap();
    assert_eq!(
        (both.engine, both.origin),
        (Engine::Tectonic, Origin::Payload)
    );
    assert_eq!(both.program, Path::new("/data/tectonic"));
    let tex = choose(None, &found(false, true)).unwrap();
    assert_eq!((tex.engine, tex.origin), (Engine::LatexmkPdf, Origin::Path));
    assert_eq!(tex.program, Path::new("/usr/bin/latexmk"));
    // An engine name nobody knows is no choice.
    assert_eq!(
        choose(Some("pdflatex"), &found(true, false))
            .unwrap()
            .engine,
        Engine::Tectonic
    );
}

#[test]
fn a_named_engine_is_the_only_one_used() {
    let xe = choose(Some("latexmk-xe"), &found(true, true)).unwrap();
    assert_eq!((xe.engine, xe.origin), (Engine::LatexmkXe, Origin::Path));
    let tectonic = choose(Some("tectonic"), &found(true, true)).unwrap();
    assert_eq!(tectonic.engine, Engine::Tectonic);
    // The named engine is missing: it is not swapped for another.
    let missing = choose(Some("tectonic"), &found(false, true)).unwrap_err();
    assert_eq!(missing.next, Next::InstallTectonic);
    let missing = choose(Some("latexmk-lua"), &found(true, false)).unwrap_err();
    assert_eq!(missing.next, Next::InstallTex);
}

#[test]
fn with_no_engine_at_all_the_answer_says_what_to_do_next() {
    let none = choose(None, &found(false, false)).unwrap_err();
    assert_eq!(none.next, Next::InstallTectonic);
    assert!(
        none.message.contains("Install Tectonic"),
        "{}",
        none.message
    );
    assert!(none.message.contains("TeX Live"), "{}", none.message);
    let tex = choose(Some("latexmk-pdf"), &found(true, false)).unwrap_err();
    assert!(tex.message.contains("latexmk"), "{}", tex.message);
    assert!(tex.message.contains("TeX Live"), "{}", tex.message);
    for message in [&none.message, &tex.message] {
        // Plain words for a person: no ids, no paths.
        assert!(
            !message.contains("payload") && !message.contains("PATH"),
            "{message}"
        );
    }
}

#[test]
fn no_engine_reaches_the_window_as_a_typed_error_with_the_next_step() {
    use crate::plugins::latex::commands::no_engine;
    let tectonic = no_engine(choose(None, &found(false, false)).unwrap_err());
    assert_eq!(tectonic.kind, "no-engine");
    assert_eq!(tectonic.next, Some("install-tectonic"));
    let tex = no_engine(choose(Some("latexmk-xe"), &found(true, false)).unwrap_err());
    assert_eq!((tex.kind, tex.next), ("no-engine", Some("install-tex")));
    let json = serde_json::to_value(&tex).unwrap();
    assert_eq!(json["kind"], "no-engine");
    assert_eq!(json["next"], "install-tex");
    assert!(json["message"].as_str().unwrap().contains("TeX Live"));
}

#[test]
fn programs_are_found_on_the_path_by_absolute_entries_only() {
    let dir = Dir::new("path");
    let bin = dir.join("bin");
    let other = dir.join("other");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    let name = if cfg!(windows) {
        "latexmk.exe"
    } else {
        "latexmk"
    };
    std::fs::write(bin.join(name), "x").unwrap();
    // A folder with the program's name is not a program.
    std::fs::create_dir_all(other.join(name)).unwrap();

    let joined = std::env::join_paths([other.clone(), bin.clone()]).unwrap();
    assert_eq!(find_program("latexmk", &joined), Some(bin.join(name)));
    assert_eq!(find_program("pdflatex", &joined), None);

    // The current folder, and a relative entry, are never searched.
    let relative = std::env::join_paths([Path::new("."), Path::new("bin"), Path::new("")]).unwrap();
    assert_eq!(find_program("latexmk", &relative), None);
    assert_eq!(find_program("latexmk", OsStr::new("")), None);
}

#[test]
fn the_downloaded_tectonic_counts_only_when_whole_and_of_the_pinned_version() {
    let dir = Dir::new("payload");
    let root = dir.join("latex");
    assert_eq!(payload_program(&root, "0.15.0"), None);
    let version = root.join("0.15.0");
    std::fs::create_dir_all(&version).unwrap();
    std::fs::write(version.join(TECTONIC_PROGRAM), "x").unwrap();
    // No VERSION file: a copy that is not whole.
    assert_eq!(payload_program(&root, "0.15.0"), None);
    std::fs::write(version.join("VERSION"), "0.15.0").unwrap();
    assert_eq!(
        payload_program(&root, "0.15.0"),
        Some(version.join(TECTONIC_PROGRAM))
    );
    // A copy marked as another version is not this one.
    std::fs::write(version.join("VERSION"), "0.14.0").unwrap();
    assert_eq!(payload_program(&root, "0.15.0"), None);
}
