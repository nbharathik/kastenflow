//! The commands, each a thin call into kasten-core (the CLI
//! never writes vault files itself).

use std::path::PathBuf;

use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};

use crate::args::Args;
use crate::show::say;

pub type Outcome = Result<i32, String>;

pub fn open(args: &Args) -> Result<Kasten, String> {
    Kasten::open(args.vault()?).map_err(|e| e.to_string())
}

pub fn json_text(value: serde_json::Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

pub fn when(millis: u64) -> String {
    let stamp = Instant { millis }.rfc3339();
    format!("{} {}", &stamp[..10], &stamp[11..16])
}

/// `kasten init [DIR] [--name NAME]`
pub fn init(args: &Args) -> Outcome {
    let dir = match args.positional.get(1) {
        Some(dir) => PathBuf::from(dir),
        None => args
            .vault()
            .or_else(|_| std::env::current_dir().map_err(|e| e.to_string()))?,
    };
    let name = args.value("--name").map(str::to_owned).unwrap_or_else(|| {
        dir.file_name()
            .map_or_else(|| "Kasten".to_owned(), |n| n.to_string_lossy().into_owned())
    });
    let kasten = Kasten::init(&dir, &name).map_err(|e| e.to_string())?;
    say!(
        "Vault ready at {} ({} notes, history on).",
        dir.display(),
        kasten.list().map(|l| l.len()).unwrap_or(0)
    );
    Ok(0)
}

/// `kasten capture TEXT... [--tags a,b]`
pub fn capture(args: &Args) -> Outcome {
    let text = args.positional[1..].join(" ");
    let text = if text.trim().is_empty() || text.trim() == "-" {
        std::io::read_to_string(std::io::stdin()).map_err(|e| e.to_string())?
    } else {
        text
    };
    if text.trim().is_empty() {
        return Err("Nothing to capture: pass the text or pipe it in".into());
    }
    let tags: Vec<String> = args
        .value("--tags")
        .map(|t| {
            t.split(',')
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let kasten = open(args)?;
    let note = kasten
        .capture(&Actor::Human, &text, &tags, Instant::now())
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(note.meta)));
    } else {
        say!("Captured “{}” in {}", note.meta.title, note.meta.path);
    }
    Ok(0)
}

/// `kasten search QUERY [--limit N]`
pub fn search(args: &Args) -> Outcome {
    let query = args.positional[1..].join(" ");
    let kasten = open(args)?;
    let hits = kasten
        .search(&query, args.number("--limit", 20)?)
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(hits)));
    } else if hits.is_empty() {
        say!("No matches.");
    } else {
        for hit in &hits {
            say!("{}  {}", hit.title, hit.path);
            if !hit.snippet.is_empty() {
                say!(
                    "    {}",
                    hit.snippet.split_whitespace().collect::<Vec<_>>().join(" ")
                );
            }
        }
    }
    Ok(0)
}

/// `kasten verify` exits 1 when it finds problems. The backup remote is
/// reached only with `--remote`: the vault's config names it, so reaching
/// it is the person's choice.
pub fn verify(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let remote = kasten.config().git.remote;
    if args.has("--remote") {
        kasten.confirm_remote(remote.as_deref());
    }
    let report = kasten.verify().map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(report)));
    } else {
        // Slide decks are mentioned only when the vault has some.
        let decks = match report.decks {
            0 => String::new(),
            1 => ", 1 deck".to_owned(),
            n => format!(", {n} decks"),
        };
        say!(
            "Checked {} notes, {} boards{decks} and {} git objects.",
            report.notes,
            report.boards,
            report.git_objects
        );
        for p in &report.problems {
            say!(
                "  {:<16} {}  {}",
                p.kind,
                p.path.as_deref().unwrap_or("-"),
                p.detail
            );
        }
        if report.problems.is_empty() {
            say!("No problems found.");
        }
        if remote.is_some() && !args.has("--remote") {
            say!("The backup remote was not reached; add --remote to check it.");
        }
    }
    Ok(if report.problems.is_empty() { 0 } else { 1 })
}

/// A note named by path or by title.
fn note_path(kasten: &Kasten, name: &str) -> Result<String, String> {
    if name.ends_with(".md") && kasten.vault().exists(name) {
        return Ok(name.to_owned());
    }
    kasten
        .path_of_title(name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No note called {name}"))
}

/// `kasten history [NOTE] [--limit N]`
pub fn history(args: &Args) -> Outcome {
    let kasten = open(args)?;
    if !kasten.has_history() {
        return Err(format!(
            "This vault has no history yet (run {} init in it)",
            crate::program()
        ));
    }
    let path = match args.positional.get(1) {
        Some(name) => Some(
            note_path(&kasten, &args.positional[1..].join(" "))
                .or_else(|_| note_path(&kasten, name))?,
        ),
        None => None,
    };
    let log = kasten
        .log(path.as_deref(), args.number("--limit", 20)?)
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!("{}", json_text(serde_json::json!(log)));
    } else {
        for c in &log {
            say!(
                "{}  {}  {:<20} {}",
                &c.id[..10],
                when(c.time),
                c.author,
                c.summary
            );
        }
    }
    Ok(0)
}

/// `kasten restore NOTE COMMIT`, or `kasten restore --vault-wide COMMIT`
pub fn restore(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let now = Instant::now();
    if args.has("--vault-wide") {
        let rev = args.positional.get(1).ok_or_else(|| {
            format!(
                "Which commit? {} restore --vault-wide COMMIT",
                crate::program()
            )
        })?;
        let report = kasten
            .restore_vault(&Actor::Human, rev, now)
            .map_err(|e| e.to_string())?;
        say!(
            "Restored {} files; {} made since went to the trash.",
            report.written.len() - report.trashed.len(),
            report.trashed.len()
        );
        return Ok(0);
    }
    let usage = || format!("Usage: {} restore NOTE COMMIT", crate::program());
    let [_, name @ .., rev] = args.positional.as_slice() else {
        return Err(usage());
    };
    if name.is_empty() {
        return Err(usage());
    }
    let path = note_path(&kasten, &name.join(" "))?;
    let note = kasten
        .restore_version(&Actor::Human, &path, rev, now)
        .map_err(|e| e.to_string())?;
    say!("Restored “{}” as its newest version.", note.meta.title);
    Ok(0)
}

/// `kasten reindex`
pub fn reindex(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let started = std::time::Instant::now();
    let count = kasten.reindex().map_err(|e| e.to_string())?;
    say!(
        "Indexed {count} notes in {} ms.",
        started.elapsed().as_millis()
    );
    Ok(0)
}

/// `kasten dev-generate DIR [--notes N] [--boards N]`: the big vault for
/// performance checks. Never a real vault.
pub fn generate(args: &Args) -> Outcome {
    let dir = args.positional.get(1).ok_or_else(|| {
        format!(
            "Usage: {} dev-generate DIR [--notes N] [--boards N]",
            crate::program()
        )
    })?;
    let dir = PathBuf::from(dir);
    if dir.exists()
        && std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(format!("{} is not empty", dir.display()));
    }
    let notes = args.number("--notes", 10_000)?;
    let boards = args.number("--boards", 50)?;
    kasten_core::generate::generate_vault(&dir, notes, boards, 42).map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    let kasten = Kasten::open(&dir).map_err(|e| e.to_string())?;
    say!(
        "Generated {} notes and {boards} boards in {}; indexed in {} ms.",
        kasten.list().map(|l| l.len()).unwrap_or(0),
        dir.display(),
        started.elapsed().as_millis()
    );
    Ok(0)
}
