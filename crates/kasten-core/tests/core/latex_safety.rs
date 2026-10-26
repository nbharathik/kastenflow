//! LaTeX sources under attack: paths that try to leave a document or reach
//! private folders, locks that must hold from every side (nested documents,
//! settings that cannot be read, a root that is gone, other spellings of a
//! folder), two writers at once, a merge that must never lose a side, files
//! that are not text, settings kept byte for byte, and what a chat that
//! previews its changes may do.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;
use kasten_core::latex::{LatexConfig, SourceSaved};
use kasten_core::merge::merge3;
use kasten_core::{Error, Kasten, Outcome};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const TWO: &str = "projects/photo-organiser/latex/twocolumn";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    for name in ["article", "twocolumn"] {
        let from = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/latex")
            .join(name);
        copy_dir(&from, &t.vault.root().join(BASE).join(name));
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn put(t: &common::TempVault, path: &str, text: &str) {
    let file = t.vault.root().join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn rewrite(t: &common::TempVault, path: &str, text: &str) -> AgentOp {
    AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: text_of(t, path),
        reason: None,
    }
}

fn new_file(path: &str, text: &str) -> AgentOp {
    AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: String::new(),
        reason: None,
    }
}

fn refused_with(result: Result<Outcome, Error>, word: &str) {
    match result {
        Err(err) => assert!(err.to_string().contains(word), "{err}"),
        other => panic!("expected a refusal naming {word}, got {other:?}"),
    }
}

/// Every file of the vault but git's folder and the cache, with its bytes.
fn snapshot(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = std::collections::BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn no_path_escapes_a_document_or_reaches_a_private_folder() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let paths = [
        "../x.tex".to_owned(),
        "/abs.tex".to_owned(),
        "C:/x.tex".to_owned(),
        "C:\\x.tex".to_owned(),
        format!("{ARTICLE}\\win.tex"),
        format!("{ARTICLE}/sub\\win.tex"),
        ".git/hooks/x.tex".to_owned(),
        ".GIT/x.tex".to_owned(),
        ".kasten/x.tex".to_owned(),
        ".KASTEN/cache/x.tex".to_owned(),
        format!("{ARTICLE}/.git/x.tex"),
        format!("{ARTICLE}/.kasten/x.tex"),
        format!("{ARTICLE}/.hidden.tex"),
        format!("{ARTICLE}/../../x.tex"),
        format!("{ARTICLE}/../article/x.tex"),
        format!("{ARTICLE}//x.tex"),
        format!("{ARTICLE}/./x.tex"),
        format!("{ARTICLE}/x.tex\0.pdf"),
        format!("{ARTICLE}/x.tex::$DATA"),
        format!("{ARTICLE}/x.tex."),
        format!("{ARTICLE}/x.tex "),
        format!("{ARTICLE}/x.TEX"),
        format!("{ARTICLE}/x.tex/"),
        format!("{ARTICLE}/.tex"),
        ".tex".to_owned(),
        String::new(),
    ];
    let mut paths = paths.to_vec();
    if cfg!(windows) {
        // Names Windows reads as devices or as a short alias of another file.
        paths.push(format!("{ARTICLE}/CON.tex"));
        paths.push(format!("{ARTICLE}/nul.bib"));
        paths.push(format!("{ARTICLE}/MAIN~1.tex"));
        paths.push(format!("{BASE}/ARTICL~1/x.tex"));
    }
    for path in &paths {
        let human = k.save_source(&Actor::Human, path, "", "\\documentclass{article}\n", NOW);
        assert!(human.is_err(), "a person saved {path:?}");
        let root_file = new_file(path, "\\documentclass{article}\n");
        assert!(k.agent_run(&s, &root_file, NOW).is_err(), "agent {path:?}");
        assert!(k.source(path).is_err(), "read {path:?}");
    }
    k.commit_edits().unwrap();
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_link_inside_the_document_is_never_followed() {
    let (t, k, s) = open();
    let outside = std::env::temp_dir().join(format!("kasten-latex-out-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    let link = t.vault.root().join(ARTICLE).join("linked");
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&outside, &link);
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&outside, &link);
    if made.is_err() {
        // No right to make links here: nothing to attack.
        let _ = fs::remove_dir_all(&outside);
        return;
    }
    let path = format!("{ARTICLE}/linked/evil.tex");
    assert!(
        k.save_source(&Actor::Human, &path, "", "\\documentclass{a}\n", NOW)
            .is_err()
    );
    assert!(k.agent_run(&s, &new_file(&path, "words\n"), NOW).is_err());
    assert!(k.source(&path).is_err());
    assert!(!outside.join("evil.tex").exists());
    let _ = fs::remove_dir(&link);
    let _ = fs::remove_dir_all(&outside);
}

#[test]
fn a_locked_document_covers_documents_inside_it() {
    let (t, k, s) = open();
    // A standalone figure with its own class, in a folder of the locked document.
    let figure = format!("{TWO}/figures/fig.tex");
    put(
        &t,
        &figure,
        "\\documentclass{standalone}\n\\begin{document}x\\end{document}\n",
    );
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder == format!("{TWO}/figures"))
    );
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let edit = rewrite(&t, &figure, "\\documentclass{standalone}\nchanged\n");
        refused_with(k.agent_run(&s, &edit, NOW), "locked");
        let fresh = new_file(&format!("{TWO}/figures/two.tex"), "\\documentclass{a}\n");
        refused_with(k.agent_run(&s, &fresh, NOW), "locked");
        let deeper = new_file(&format!("{TWO}/a/b/c/main.tex"), "\\documentclass{a}\n");
        refused_with(k.agent_run(&s, &deeper, NOW), "locked");
    }
    assert!(text_of(&t, &figure).contains("\\end{document}"));
    assert!(!t.vault.root().join(TWO).join("a").exists());
    // The person is not held by their own lock.
    let loaded = k.source(&figure).unwrap();
    k.save_source(
        &Actor::Human,
        &figure,
        &loaded.hash,
        "\\documentclass{standalone}\nmine\n",
        NOW,
    )
    .unwrap();
}

#[test]
fn settings_that_cannot_be_read_keep_agents_out() {
    let (t, k, s) = open();
    put(
        &t,
        &format!("{ARTICLE}/kasten-latex.yaml"),
        "locked: true\nengine: [unclosed\n",
    );
    let edit = rewrite(
        &t,
        MAIN,
        &text_of(&t, MAIN).replace("fixed rate", "steady rate"),
    );
    refused_with(k.agent_run(&s, &edit, NOW), "locked");
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder == ARTICLE && d.locked)
    );
    // The person can still write, and the file is still not written over.
    let loaded = k.source(MAIN).unwrap();
    assert!(
        k.save_source(
            &Actor::Human,
            MAIN,
            &loaded.hash,
            &format!("{}%\n", loaded.text),
            NOW
        )
        .is_ok()
    );
    assert!(
        k.set_latex_config(&Actor::Human, ARTICLE, &LatexConfig::default(), NOW)
            .is_err()
    );
    assert_eq!(
        text_of(&t, &format!("{ARTICLE}/kasten-latex.yaml")),
        "locked: true\nengine: [unclosed\n"
    );
}

#[test]
fn a_lock_whose_root_is_gone_still_keeps_agents_out() {
    let (t, k, s) = open();
    put(
        &t,
        "inbox/gone/kasten-latex.yaml",
        "locked: true\nmain: missing.tex\n",
    );
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .all(|d| d.folder != "inbox/gone")
    );
    for path in ["inbox/gone/main.tex", "inbox/gone/deep/main.tex"] {
        refused_with(
            k.agent_run(&s, &new_file(path, "\\documentclass{a}\n"), NOW),
            "locked",
        );
        assert!(!t.vault.root().join(path).exists());
    }
}

#[test]
fn another_spelling_of_a_locked_folder_is_the_same_folder() {
    let (t, k, s) = open();
    let upper = format!("{BASE}/TWOCOLUMN");
    if !t.vault.root().join(&upper).exists() {
        // A vault that tells the two apart: they really are two folders.
        return;
    }
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let fresh = new_file(&format!("{upper}/extra.tex"), "\\documentclass{a}\n");
        refused_with(k.agent_run(&s, &fresh, NOW), "locked");
        let edit = rewrite(&t, &format!("{upper}/main.tex"), "changed\n");
        refused_with(k.agent_run(&s, &edit, NOW), "locked");
    }
    assert!(!t.vault.root().join(TWO).join("extra.tex").exists());
}

#[test]
fn agents_that_were_approved_are_agents_for_every_public_op() {
    let (_t, k, _) = open();
    let approved = Actor::Approved {
        client: "claude-code".into(),
        session: "s1".into(),
        by: "me".into(),
    };
    let loaded = k.source(MAIN).unwrap();
    assert!(
        k.save_source(&approved, MAIN, &loaded.hash, "x", NOW)
            .is_err()
    );
    assert!(k.create_latex_doc(&approved, "T", None, NOW).is_err());
    assert!(
        k.export_pdf(&approved, ARTICLE, b"%PDF-1.7\n", NOW)
            .is_err()
    );
    assert!(
        k.set_latex_config(&approved, ARTICLE, &LatexConfig::default(), NOW)
            .is_err()
    );
    assert_eq!(k.source(MAIN).unwrap().text, loaded.text);
}

#[test]
fn a_proposal_is_refused_when_its_document_was_locked_meanwhile() {
    let (t, k, s) = open();
    let op = rewrite(&t, MAIN, "\\documentclass{article}\n");
    let Outcome::PendingReview { proposal, .. } = k.agent_run(&s, &op, NOW).unwrap() else {
        panic!("expected a proposal");
    };
    let config = LatexConfig {
        locked: true,
        ..k.latex_config(ARTICLE).unwrap()
    };
    k.set_latex_config(&Actor::Human, ARTICLE, &config, NOW)
        .unwrap();
    let why = k
        .accept_proposal(&proposal, "me", NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("locked"), "{why}");
    assert!(text_of(&t, MAIN).contains("Gaussian"));
}

#[test]
fn a_chat_that_previews_its_changes_never_writes_a_source() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let mut set = k.begin_changes(&s, NOW);
    let op = rewrite(&t, MAIN, &before.replace("fixed rate", "steady rate"));
    // Not previewed: it waits for review as a proposal that has not run.
    match k.stage(&mut set, &s, &op, NOW).unwrap() {
        Outcome::PendingReview { .. } => {}
        other => panic!("expected a proposal, got {other:?}"),
    }
    assert_eq!(text_of(&t, MAIN), before);
    // A new document is held the same way, and nothing is made.
    let fresh = new_file("inbox/chat/main.tex", "\\documentclass{a}\n");
    assert!(matches!(
        k.stage(&mut set, &s, &fresh, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    assert!(!t.vault.root().join("inbox/chat").exists());
    // The refusals hold there too.
    let locked = rewrite(&t, &format!("{TWO}/main.tex"), "x\n");
    assert!(k.stage(&mut set, &s, &locked, NOW).is_err());
    // And a batch cannot carry a source.
    let batch = AgentOp::Batch {
        ops: vec![op],
        reason: None,
    };
    assert!(k.agent_run(&s, &batch, NOW).is_err());
    assert!(k.stage(&mut set, &s, &batch, NOW).is_err());
    assert_eq!(text_of(&t, MAIN), before);
}

#[test]
fn two_writers_at_once_lose_nothing() {
    let (t, k, _) = open();
    let other = Kasten::open(t.vault.root()).unwrap();
    for round in 0..4 {
        let ours = k.source(MAIN).unwrap();
        let theirs = other.source(MAIN).unwrap();
        let from_a = format!("% Edit A{round}\n{}", ours.text);
        // Different places: both land in the file. The same place: one lands
        // in the file, the other in a copy.
        let from_b = if round % 2 == 0 {
            format!("{}% Edit B{round}\n", theirs.text)
        } else {
            format!("% Edit B{round}\n{}", theirs.text)
        };
        let gate = std::sync::Barrier::new(2);
        let (ra, rb) = std::thread::scope(|scope| {
            let one = scope.spawn(|| {
                gate.wait();
                k.save_source(&Actor::Human, MAIN, &ours.hash, &from_a, NOW)
            });
            let two = scope.spawn(|| {
                gate.wait();
                other.save_source(&Actor::Human, MAIN, &theirs.hash, &from_b, NOW)
            });
            (one.join().unwrap().unwrap(), two.join().unwrap().unwrap())
        });
        let file = text_of(&t, MAIN);
        let mut everything = file.clone();
        for saved in [&ra, &rb] {
            if let SourceSaved::Conflict { copy, .. } = saved {
                everything.push_str(&text_of(&t, copy));
            }
        }
        assert!(
            everything.contains(&format!("Edit A{round}")),
            "round {round}"
        );
        assert!(
            everything.contains(&format!("Edit B{round}")),
            "round {round}"
        );
        if round % 2 == 0 {
            // Different places: nothing needed a copy.
            assert!(
                file.contains(&format!("Edit A{round}"))
                    && file.contains(&format!("Edit B{round}"))
            );
        }
        k.commit_edits().unwrap();
    }
}

#[test]
fn a_merge_never_loses_a_side() {
    // Deterministic pseudo-random edits of unique lines on both sides.
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut next = move |n: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % n as u64) as usize
    };
    let base: Vec<String> = (0..24).map(|i| format!("base {i}\n")).collect();
    let edit = |lines: &[String], tag: &str, next: &mut dyn FnMut(usize) -> usize| {
        let mut out = lines.to_vec();
        let mut added = Vec::new();
        for n in 0..1 + next(4) {
            let at = next(out.len());
            match next(3) {
                0 => {
                    out.remove(at);
                }
                1 => {
                    let line = format!("{tag} replaced {n}\n");
                    out[at] = line.clone();
                    added.push(line);
                }
                _ => {
                    let line = format!("{tag} added {n}\n");
                    out.insert(at, line.clone());
                    added.push(line);
                }
            }
        }
        // A later step of the same side may have taken an earlier addition out again.
        added.retain(|line| out.contains(line));
        (out, added)
    };
    let mut merged_runs = 0;
    for _ in 0..400 {
        let (ours, ours_added) = edit(&base, "ours", &mut next);
        let (theirs, theirs_added) = edit(&base, "theirs", &mut next);
        let (ours_text, theirs_text, base_text) = (ours.concat(), theirs.concat(), base.concat());
        let Some(merged) = merge3(&base_text, &ours_text, &theirs_text) else {
            continue;
        };
        merged_runs += 1;
        for line in ours_added.iter().chain(&theirs_added) {
            assert_eq!(
                merged.matches(line.as_str()).count(),
                1,
                "{line:?} in {merged}"
            );
        }
        // A base line neither side took out is still there once.
        for line in &base {
            if ours.contains(line) && theirs.contains(line) {
                assert_eq!(merged.matches(line.as_str()).count(), 1, "{line:?}");
            }
        }
    }
    assert!(merged_runs > 50, "only {merged_runs} merges to look at");
}

#[test]
fn a_file_too_long_to_merge_is_kept_in_a_copy_not_lost() {
    let (t, k, _) = open();
    let lines: Vec<String> = (0..5000).map(|i| format!("line {i}\n")).collect();
    let base = lines.concat();
    let path = format!("{ARTICLE}/long.tex");
    k.save_source(&Actor::Human, &path, "", &base, NOW).unwrap();
    let loaded = k.source(&path).unwrap();
    let theirs = base.replace("line 10\n", "their line 10\n");
    put(&t, &path, &theirs);
    let ours = base.replace("line 4000\n", "our line 4000\n");
    let SourceSaved::Conflict { copy, .. } = k
        .save_source(&Actor::Human, &path, &loaded.hash, &ours, NOW)
        .unwrap()
    else {
        panic!("a file this long is not merged");
    };
    assert_eq!(text_of(&t, &path), theirs);
    assert_eq!(text_of(&t, &copy), ours);
}

#[test]
fn a_file_that_is_not_text_is_never_written_over() {
    let (t, k, s) = open();
    let file = t.vault.root().join(ARTICLE).join("latin1.tex");
    fs::write(&file, b"caf\xe9 \\documentclass{article}\n").unwrap();
    let path = format!("{ARTICLE}/latin1.tex");
    assert!(k.source(&path).is_err());
    assert!(
        k.save_source(&Actor::Human, &path, "abc", "text\n", NOW)
            .is_err()
    );
    assert!(
        k.save_source(&Actor::Human, &path, "", "text\n", NOW)
            .is_err()
    );
    let op = AgentOp::SaveSource {
        path: path.clone(),
        text: "text\n".into(),
        base: "caf\n".into(),
        reason: None,
    };
    assert!(k.agent_run(&s, &op, NOW).is_err());
    assert_eq!(
        fs::read(&file).unwrap(),
        b"caf\xe9 \\documentclass{article}\n"
    );
    // And a search or a listing over it does not fail.
    k.set_plugin_enabled(&Actor::Human, "latex", true, NOW)
        .unwrap();
    assert!(k.search("documentclass", 10).is_ok());
    assert!(k.latex_docs().is_ok());
}

#[test]
fn settings_are_changed_line_by_line_and_the_rest_stays_as_written() {
    let (t, k, _) = open();
    let file = format!("{ARTICLE}/kasten-latex.yaml");
    let original = "# Settings for the article\nengine:   latexmk-pdf   # keep this\nfuture_flag: 3\nshelf:\n  tags: [a,   2026]\n\n# last words\n";
    put(&t, &file, original);
    let mut config = k.latex_config(ARTICLE).unwrap();
    config.engine = Some("tectonic".into());
    config.locked = true;
    k.set_latex_config(&Actor::Human, ARTICLE, &config, NOW)
        .unwrap();
    let text = text_of(&t, &file);
    assert!(
        text.starts_with("# Settings for the article\nengine: tectonic"),
        "{text}"
    );
    assert!(text.contains("# keep this"), "{text}");
    assert!(
        text.contains("future_flag: 3\nshelf:\n  tags: [a,   2026]\n\n# last words\n"),
        "{text}"
    );
    assert!(text.contains("locked: true"), "{text}");
    assert_eq!(k.latex_config(ARTICLE).unwrap(), config);
    // Taking the lock off again takes only that line away.
    config.locked = false;
    k.set_latex_config(&Actor::Human, ARTICLE, &config, NOW)
        .unwrap();
    let text = text_of(&t, &file);
    assert!(!text.contains("locked"), "{text}");
    assert!(text.ends_with("future_flag: 3\nshelf:\n  tags: [a,   2026]\n\n# last words\n"));
}

#[test]
fn settings_with_windows_line_endings_and_a_flow_map_survive() {
    let (t, k, _) = open();
    let file = format!("{ARTICLE}/kasten-latex.yaml");
    put(
        &t,
        &file,
        "# note\r\nengine: latexmk-xe\r\nfuture: [1, 2]\r\n",
    );
    let mut config = k.latex_config(ARTICLE).unwrap();
    config.bibliography = Some("vault".into());
    k.set_latex_config(&Actor::Human, ARTICLE, &config, NOW)
        .unwrap();
    let text = text_of(&t, &file);
    assert_eq!(
        text.replace("\r\n", "").matches('\n').count(),
        0,
        "{text:?}"
    );
    assert!(
        text.starts_with("# note\r\nengine: latexmk-xe\r\nfuture: [1, 2]\r\n"),
        "{text:?}"
    );
    assert!(text.contains("bibliography: vault"), "{text:?}");
    // A file that is one flow map cannot be patched line by line: it is written whole, and still reads the same.
    put(&t, &file, "{engine: latexmk-xe, future: [1, 2]}\n");
    let mut config = k.latex_config(ARTICLE).unwrap();
    config.engine = Some("tectonic".into());
    k.set_latex_config(&Actor::Human, ARTICLE, &config, NOW)
        .unwrap();
    let again = k.latex_config(ARTICLE).unwrap();
    assert_eq!(again, config);
    assert_eq!(again.extra["future"][1], 2);
}

#[test]
fn an_export_never_replaces_a_file_that_is_not_a_pdf() {
    let (t, k, _) = open();
    let target = format!("{ARTICLE}/main.pdf");
    put(&t, &target, "my own notes, not a pdf\n");
    let why = k
        .export_pdf(&Actor::Human, ARTICLE, b"%PDF-1.7\n", NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("not a PDF"), "{why}");
    assert_eq!(text_of(&t, &target), "my own notes, not a pdf\n");
    // An empty file is not a PDF either.
    put(&t, &target, "");
    assert!(
        k.export_pdf(&Actor::Human, ARTICLE, b"%PDF-1.7\n", NOW)
            .is_err()
    );
    // A PDF is replaced.
    put(&t, &target, "%PDF-1.4\nold\n");
    k.export_pdf(&Actor::Human, ARTICLE, b"%PDF-1.7\nnew\n", NOW)
        .unwrap();
    assert_eq!(text_of(&t, &target), "%PDF-1.7\nnew\n");
    // The folder may be spelled with a closing slash, but not another way out.
    assert!(
        k.export_pdf(&Actor::Human, &format!("{ARTICLE}/"), b"%PDF-1.7\n", NOW)
            .is_ok()
    );
    for folder in [
        format!("{ARTICLE}/.."),
        format!("{ARTICLE}/../article"),
        "..".to_owned(),
        String::new(),
    ] {
        assert!(
            k.export_pdf(&Actor::Human, &folder, b"%PDF-1.7\n", NOW)
                .is_err(),
            "{folder:?}"
        );
    }
}

#[test]
fn a_new_source_is_judged_by_the_mode_of_its_project() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        projects: [(
            "photo-organiser".to_owned(),
            ProjectAgents {
                mode: Some(AgentMode::Review),
                ..ProjectAgents::default()
            },
        )]
        .into_iter()
        .collect(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    // A section and a whole new document in the project wait for review.
    for path in [
        format!("{ARTICLE}/sections/new.tex"),
        format!("{BASE}/fresh/main.tex"),
    ] {
        let op = new_file(&path, "\\documentclass{a}\n");
        assert!(
            matches!(
                k.agent_run(&s, &op, NOW).unwrap(),
                Outcome::PendingReview { .. }
            ),
            "{path}"
        );
        assert!(!t.vault.root().join(&path).exists(), "{path}");
    }
    // The library follows the vault's mode.
    let library = new_file("library/latex/fresh/main.tex", "\\documentclass{a}\n");
    assert!(matches!(
        k.agent_run(&s, &library, NOW).unwrap(),
        Outcome::Done { .. }
    ));
}

#[test]
fn a_file_over_the_limit_that_came_from_outside_is_not_read_merged_or_written_over() {
    let (t, k, s) = open();
    let path = format!("{ARTICLE}/huge.tex");
    let huge = "x".repeat(kasten_core::latex::MAX_SOURCE_BYTES + 1);
    put(&t, &path, &huge);
    assert!(k.source(&path).is_err());
    assert!(
        k.save_source(&Actor::Human, &path, "", "small\n", NOW)
            .is_err()
    );
    let op = AgentOp::SaveSource {
        path: path.clone(),
        text: "small\n".into(),
        base: huge.clone(),
        reason: None,
    };
    assert!(k.agent_run(&s, &op, NOW).is_err());
    assert_eq!(text_of(&t, &path), huge);
}
