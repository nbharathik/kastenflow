//! The data-safety rules, checked over every Rust file in the workspace
//! (test code aside): history is never rewritten, the working tree is
//! never forced over, the app never restarts without writing first, and
//! every delete is one this list names with its reason. A new delete, reset
//! or forced checkout fails here until it is reviewed and added.

use std::fs;
use std::path::{Path, PathBuf};

/// A pattern the rules forbid, with the places allowed to use it and why.
struct Rule {
    pattern: &'static str,
    why: &'static str,
    allowed: &'static [(&'static str, usize, &'static str)],
}

const RULES: &[Rule] = &[
    Rule {
        pattern: "ResetType",
        why: "history only grows: no git reset",
        allowed: &[],
    },
    Rule {
        pattern: ".reset(",
        why: "history only grows: no git reset",
        allowed: &[(
            "app/src-tauri/src/chat/commands.rs",
            1,
            "clears a chat thread in memory, not git",
        )],
    },
    Rule {
        pattern: "+refs",
        why: "the remote is never forced, and no ref is overwritten",
        allowed: &[],
    },
    Rule {
        pattern: "format!(\"+",
        why: "a refspec that starts with + forces the ref it names",
        allowed: &[
            (
                "crates/kasten-core/src/history/fetch.rs",
                1,
                "Kasten's own ref for what a fetch found, which only Get latest reads, as git moves a remote-tracking branch; never a branch",
            ),
            (
                "crates/kasten-core/src/diff.rs",
                1,
                "an added line in a shown diff, not a refspec",
            ),
        ],
    },
    Rule {
        pattern: "force_push",
        why: "the remote is never forced",
        allowed: &[],
    },
    Rule {
        pattern: ".force()",
        why: "a checkout never overwrites files in the vault",
        allowed: &[
            (
                "crates/kasten-core/src/history/bundle.rs",
                1,
                "checks out into a fresh hidden folder Kasten just made, before it becomes the vault",
            ),
            (
                "crates/kasten-core/src/history/fetch.rs",
                1,
                "checks out into a fresh hidden folder Kasten just made, before it becomes the vault",
            ),
        ],
    },
    Rule {
        pattern: ".restart()",
        why: "restarting must write open pages first: use request_restart",
        allowed: &[],
    },
    Rule {
        pattern: "remove_dir_all",
        why: "nothing deletes content",
        allowed: &[
            (
                "crates/kasten-core/src/history/bundle.rs",
                2,
                "the scratch repository a check made, and a half-built restore Kasten made, both in folders of its own",
            ),
            (
                "crates/kasten-core/src/history/fetch.rs",
                1,
                "a half-built restore in the hidden folder Kasten made for it",
            ),
            (
                "crates/kasten-core/src/engine/stage/mod.rs",
                1,
                "a chat's staged changes in the local cache, never vault content",
            ),
            (
                "crates/kasten-core/benches/core.rs",
                2,
                "the benchmark's own generated vault under the system temp folder",
            ),
            (
                "app/src-tauri/src/drops.rs",
                1,
                "copies of files an earlier drop staged in the app's own cache for Import, never the files they came from",
            ),
            (
                "app/src-tauri/src/plugins/clean.rs",
                1,
                "a plugin's own payload folder in the app's data (a half-unpacked copy, the copy an upgrade replaces, or the whole payload when a person removes the plugin's download): a copy of a pinned download, never anything in the vault",
            ),
            (
                "app/src-tauri/src/plugins/latex/cache.rs",
                1,
                "leftovers inside one LaTeX build's own cache folder (.kasten/cache/latex/<hash>/, never committed, rebuilt from the document's folder at the next build); refuses any path that is not strictly below that folder and never follows a link",
            ),
        ],
    },
    Rule {
        pattern: "remove_file",
        why: "nothing deletes content",
        allowed: &[
            (
                "crates/kasten-core/src/atomic.rs",
                5,
                "the temporary file of an atomic write, and ones interrupted writes left an hour or more ago",
            ),
            (
                "crates/kasten-core/src/bridge/files.rs",
                1,
                "a request, an answer, the shared selection or a link in the mailbox (.kasten/cache/bridge/, never committed): the request once it is taken up or has gone unanswered, the answer once it is read or too old, the selection when the app closes or no client has asked for two minutes; refuses any path that is not strictly inside the mailbox and removes a link itself, never what it points to",
            ),
            (
                "crates/kasten-core/src/engine/backup_file.rs",
                3,
                "a half-written backup file, or an old one whose history the new, checked file holds",
            ),
            (
                "crates/kasten-core/src/engine/empty_trash.rs",
                1,
                "a trashed file whose bytes history holds at HEAD, when a person empties the trash",
            ),
            (
                "crates/kasten-core/src/engine/latest.rs",
                1,
                "Get latest's own journal in the cache",
            ),
            (
                "crates/kasten-core/src/engine/latest_apply.rs",
                1,
                "a file the backup's history removed, only while it holds what this vault's last commit does, so history keeps it",
            ),
            (
                "crates/kasten-core/src/engine/mod.rs",
                1,
                "the search index, rebuilt from the files",
            ),
            (
                "crates/kasten-core/src/engine/undo.rs",
                1,
                "a file the undone commit made and nothing changed since; its text stays in that commit",
            ),
            (
                "crates/kasten-core/src/history/locks.rs",
                3,
                "lock files Kasten made",
            ),
            (
                "crates/kasten-core/src/rollback.rs",
                1,
                "a file the failed op itself made",
            ),
            (
                "crates/kasten-core/src/vectors/store.rs",
                1,
                "the search-by-meaning cache, rebuilt from the notes",
            ),
            (
                "app/src-tauri/src/plugins/clean.rs",
                1,
                "a download of a plugin's payload that did not check out: a file the installer wrote in the app's own data folder, never anything in the vault",
            ),
            (
                "app/src-tauri/src/plugins/latex/cache.rs",
                2,
                "a file or a link left inside one LaTeX build's own cache folder (.kasten/cache/latex/<hash>/, never committed, rebuilt from the document's folder at the next build); refuses any path that is not strictly below that folder, removes a link itself and never what it points to",
            ),
            (
                "app/src-tauri/src/chat/store/remove.rs",
                1,
                "the app's own copy of a chat the person deleted (one by one, or archived chats they named in a bulk delete: a list size only archives, it never deletes), of an attachment they took off a message or whose last chat they deleted, or the half-written temporary file of a save that failed: files in the app's data folder, never anything in the vault, and never on a cap, a timer or at start; only a plain file under the folder it is given",
            ),
            (
                "app/src-tauri/src/calendars/store.rs",
                2,
                "the cached copy of a calendar feed and what its server said about it, in the app's cache folder, when the person removes that calendar: re-fetched from the feed, never anything in the vault",
            ),
        ],
    },
];

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every Rust source file outside test folders and build output.
fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if !matches!(
                name.as_str(),
                "target" | "node_modules" | "tests" | "gen" | ".git" | "dist"
            ) {
                sources(&path, out);
            }
        } else if name.ends_with(".rs") && !name.ends_with("_tests.rs") && name != "tests.rs" {
            out.push(path);
        }
    }
}

/// The file's lines outside `#[cfg(test)]` items, with their numbers.
fn live_lines(text: &str) -> Vec<(usize, &str)> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim() == "#[cfg(test)]" {
            // Skip the item the attribute is on: to its closing brace, or
            // one line when it has none.
            i += 1;
            let mut depth = 0i32;
            let mut opened = false;
            while i < lines.len() {
                let line = lines[i];
                depth += line.matches('{').count() as i32 - line.matches('}').count() as i32;
                opened |= line.contains('{');
                i += 1;
                if (opened && depth <= 0) || (!opened && line.trim_end().ends_with(';')) {
                    break;
                }
            }
            continue;
        }
        out.push((i + 1, lines[i]));
        i += 1;
    }
    out
}

#[test]
fn every_delete_reset_and_forced_write_is_one_the_rules_allow() {
    let root = workspace();
    let mut files = Vec::new();
    for dir in ["crates", "app/src-tauri/src"] {
        sources(&root.join(dir), &mut files);
    }
    assert!(files.len() > 100, "found only {} files", files.len());
    let me = Path::new(file!()).file_name().unwrap().to_owned();
    let mut problems = Vec::new();
    for file in &files {
        if file.file_name() == Some(me.as_os_str()) {
            continue;
        }
        let rel = file
            .strip_prefix(&root)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let text = fs::read_to_string(file).unwrap();
        let live = live_lines(&text);
        for rule in RULES {
            let found: Vec<usize> = live
                .iter()
                .filter(|(_, line)| {
                    !line.trim_start().starts_with("//") && line.contains(rule.pattern)
                })
                .map(|(n, _)| *n)
                .collect();
            let allowed = rule
                .allowed
                .iter()
                .find(|(path, _, _)| rel.ends_with(path))
                .map_or(0, |(_, n, _)| *n);
            // Exactly as many as allowed: a new one needs review, and an
            // allowance nothing uses any more goes.
            if found.len() != allowed {
                problems.push(format!(
                    "{rel} lines {found:?}: `{}` ({}); allowed here {allowed} time(s)",
                    rule.pattern, rule.why
                ));
            }
        }
    }
    assert!(
        problems.is_empty(),
        "Review these, then allow them with a reason:\n{}",
        problems.join("\n")
    );
}

#[test]
fn skips_only_the_test_items() {
    let text = "fn a() { remove_file(); }\n#[cfg(test)]\nuse x;\nfn b() {}\n#[cfg(test)]\nmod tests {\n    fn c() { remove_file(); }\n}\nfn d() {}\n";
    let kept: Vec<&str> = live_lines(text).into_iter().map(|(_, l)| l).collect();
    assert_eq!(
        kept,
        ["fn a() { remove_file(); }", "fn b() {}", "fn d() {}"]
    );
}
