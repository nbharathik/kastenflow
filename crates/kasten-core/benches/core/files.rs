//! Boards, decks, counts and projects with the parsed files remembered and
//! without, on a vault apart from the one the other benchmarks use so that
//! their numbers stay comparable run to run.

use std::path::PathBuf;
use std::sync::OnceLock;

use criterion::{BatchSize, Criterion};
use kasten_core::index::Index;
use kasten_core::{Instant, Kasten};

use super::NOTES;

/// The 10,000-note vault with 50 decks and 30 more projects added.
fn extras_vault() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("kasten-bench-{NOTES}-extras"));
        let done = dir.join(".extras-done");
        if !done.exists() {
            // The generator writes the same files again over an earlier, unfinished try.
            kasten_core::generate::generate_vault(&dir, NOTES, 50, 42).unwrap();
            kasten_core::generate::generate_decks(&dir, 50, 11).unwrap();
            kasten_core::generate::generate_projects(&dir, 30, 7).unwrap();
            Kasten::open(&dir).unwrap();
            std::fs::write(&done, "built\n").unwrap();
        }
        dir
    })
}

/// Each pair is the same call, "cold" after `forget_file_cache`.
pub fn facts(c: &mut Criterion) {
    let k = Kasten::open(extras_vault()).unwrap();
    let mut group = c.benchmark_group("files");
    group.sample_size(30);
    group.bench_function("board facts (boards list), 50 boards, cold", |b| {
        b.iter(|| {
            k.forget_file_cache();
            k.boards().unwrap()
        })
    });
    group.bench_function("board facts (boards list), 50 boards, warm", |b| {
        b.iter(|| k.boards().unwrap())
    });
    group.bench_function("deck facts (decks list), 50 decks, cold", |b| {
        b.iter(|| {
            k.forget_file_cache();
            k.decks().unwrap()
        })
    });
    group.bench_function("deck facts (decks list), 50 decks, warm", |b| {
        b.iter(|| k.decks().unwrap())
    });
    group.bench_function("boards with a note", |b| {
        b.iter(|| k.boards_with("projects/p3/pages/n3.md").unwrap())
    });
    group.bench_function("note stats, 10k notes, warm", |b| {
        b.iter(|| k.note_stats().unwrap())
    });
    group.bench_function("note stats, 10k notes, cold", |b| {
        b.iter(|| {
            k.forget_file_cache();
            k.note_stats().unwrap()
        })
    });
    // Cold reads every note's text (seconds on 10,000 notes, so fewer samples);
    // warm reads none: each note's pictures are remembered like a board's facts.
    group.sample_size(10);
    group.bench_function("assets usage, warm", |b| {
        b.iter(|| k.assets_usage().unwrap())
    });
    group.bench_function("assets usage, cold", |b| {
        b.iter(|| {
            k.forget_file_cache();
            k.assets_usage().unwrap()
        })
    });
    group.finish();
    // "50 projects in the 10,000-note vault: under 50 ms", asked again with the
    // index as it was (the index's rows are kept; the walk for boards and
    // decks is not).
    let projects = k.project_summaries("2026-10-06").unwrap().len();
    assert!(projects >= 50, "{projects} projects");
    c.bench_function("project summaries, 50 projects, 10k notes", |b| {
        b.iter(|| k.project_summaries("2026-10-06").unwrap())
    });
    // The first read after a note changed: only the project the note is in is
    // asked of the index again (the setup, which indexes the same unchanged
    // file once more, is not timed).
    c.bench_function(
        "project summaries, first read after a change, 50 projects, 10k notes",
        |b| {
            b.iter_batched(
                || {
                    k.outside_changes(
                        &["projects/p3/pages/n3.md".to_owned()],
                        Instant::now().millis,
                    )
                },
                |()| k.project_summaries("2026-10-06").unwrap(),
                BatchSize::PerIteration,
            )
        },
    );
    // Before that was incremental, the first read after a change paid all of
    // the index's queries again, on top of the walk: this is that, taken apart.
    let index = Index::open(&extras_vault().join(".kasten/cache/index.sqlite")).unwrap();
    c.bench_function("project summaries part: index queries", |b| {
        b.iter(|| index.project_rows("2026-10-06").unwrap())
    });
    c.bench_function("project summaries part: walk for boards and decks", |b| {
        b.iter(|| k.vault().files_among(&[".canvas", ".deck"]).unwrap())
    });
    c.bench_function("health report, 10k notes", |b| {
        b.iter(|| k.health(Instant::now().millis))
    });
}
