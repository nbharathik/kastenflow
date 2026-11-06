//! A journal for each project: one note a day at
//! `projects/<project>/journal/<year>/<date>.md`, made, appended to, undone,
//! found from the index, and held to the agent modes like any note.

use std::fs;

use crate::change_sets::open;
use crate::common::NOW;
use crate::parity::{lock, refused};
use crate::smart_support::set_mode;
use crate::structure::{commits, done, pending};
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{
    Kind, NewNote, create_note, frontmatter, journal_day, journal_path, journal_path_in,
    project_journal_of,
};

const PROJECT: &str = "photo-organiser";
const OTHER: &str = "note-taking-study";
const DAY: &str = "2026-11-03";

fn project_day(project: &str, date: &str) -> String {
    format!("projects/{project}/journal/{}/{date}.md", &date[..4])
}

fn append(project: Option<&str>, date: &str, markdown: &str) -> AgentOp {
    AgentOp::JournalAppend {
        date: date.into(),
        markdown: markdown.into(),
        heading: None,
        project: project.map(str::to_owned),
    }
}

fn open_day(project: Option<&str>, date: &str) -> AgentOp {
    AgentOp::JournalDay {
        date: date.into(),
        project: project.map(str::to_owned),
    }
}

#[test]
fn the_path_helper_names_the_vault_journal_and_a_projects() {
    assert_eq!(
        journal_path(None, DAY).unwrap(),
        "journal/2026/2026-11-03.md"
    );
    assert_eq!(
        journal_path(Some(PROJECT), DAY).unwrap(),
        "projects/photo-organiser/journal/2026/2026-11-03.md"
    );
    assert_eq!(
        project_journal_of("projects/photo-organiser/journal/2026/2026-11-03.md"),
        Some((PROJECT, DAY))
    );
    assert!(journal_path(None, "24.09.2026").is_err());
    assert!(journal_path(Some(PROJECT), "soon").is_err());
}

#[test]
fn the_path_helper_refuses_a_way_out_of_the_projects_folder() {
    for project in ["../x", "..", "a/b", "a\\b", ".hidden", "", "projects/x"] {
        assert!(
            journal_path(Some(project), DAY).is_err(),
            "{project:?} was taken for a project"
        );
    }
}

#[test]
fn the_checked_helper_asks_the_vault_for_the_project() {
    let (t, _k, _s) = open();
    let known = journal_path_in(&t.vault, Some(PROJECT), DAY).unwrap();
    assert_eq!(known, project_day(PROJECT, DAY));
    // A title finds the folder it makes.
    assert_eq!(
        journal_path_in(&t.vault, Some("Photo organiser"), DAY).unwrap(),
        known
    );
    let err = journal_path_in(&t.vault, Some("no-such-project"), DAY).unwrap_err();
    assert!(err.to_string().contains("No project called"), "{err}");
    // The vault's own journal needs no project.
    assert!(journal_path_in(&t.vault, None, DAY).is_ok());
}

#[test]
fn a_project_day_is_made_once_as_a_journal_note_of_the_project() {
    let (t, k, _s) = open();
    let before = commits(&k);
    let day = k.journal(&Actor::Human, Some(PROJECT), DAY, NOW).unwrap();
    assert_eq!(day.meta.path, project_day(PROJECT, DAY));
    assert_eq!(day.meta.kind, "journal");
    assert_eq!(day.meta.project.as_deref(), Some(PROJECT));
    assert_eq!(day.meta.title, DAY);
    assert!(day.text.contains("type: journal"), "{}", day.text);
    assert!(t.vault.root().join(&day.meta.path).is_file());
    assert_eq!(commits(&k), before + 1);
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "journal: 2026-11-03 in Photo organiser"
    );
    // Opened again, it is only read.
    let again = k.journal(&Actor::Human, Some(PROJECT), DAY, NOW).unwrap();
    assert_eq!(again.hash, day.hash);
    assert_eq!(commits(&k), before + 1);
    // The vault's journal of the same day is another note, still not there.
    assert!(!t.vault.root().join("journal/2026/2026-11-03.md").exists());
    // The index has it, with its project.
    let meta = k
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.path == day.meta.path)
        .unwrap();
    assert_eq!(
        (meta.kind.as_str(), meta.project.as_deref()),
        ("journal", Some(PROJECT))
    );
}

#[test]
fn an_unknown_project_or_a_bad_day_makes_nothing() {
    let (_t, k, _s) = open();
    let before = commits(&k);
    for (project, date) in [
        (Some("no-such-project"), DAY),
        (Some("../x"), DAY),
        (Some(PROJECT), "tomorrow"),
        (Some(PROJECT), "2026-11-3"),
    ] {
        assert!(
            k.journal(&Actor::Human, project, date, NOW).is_err(),
            "{project:?} {date}"
        );
    }
    assert_eq!(commits(&k), before);
}

#[test]
fn a_project_day_starts_from_the_project_journal_template_then_the_journal_template() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    // No project template: the journal template, as the vault's days use it.
    fs::write(
        root.join("templates/journal.md"),
        "---\ntitle: \"{{date}}\"\ntype: journal\n---\n## Plan for {{date}}\n",
    )
    .unwrap();
    let first = k
        .journal(&Actor::Human, Some(PROJECT), "2026-11-04", NOW)
        .unwrap();
    assert!(
        first.text.contains("## Plan for 2026-11-04"),
        "{}",
        first.text
    );
    // A project template wins for a project, and not for the vault.
    fs::write(
        root.join("templates/project-journal.md"),
        "---\ntitle: \"{{date}}\"\ntype: journal\n---\n## Done in {{project}}\n",
    )
    .unwrap();
    let second = k
        .journal(&Actor::Human, Some(PROJECT), "2026-11-05", NOW)
        .unwrap();
    assert!(
        second.text.contains("## Done in photo-organiser"),
        "{}",
        second.text
    );
    assert!(!second.text.contains("Plan for"), "{}", second.text);
    let vault_day = k.journal(&Actor::Human, None, "2026-11-05", NOW).unwrap();
    assert!(vault_day.text.contains("## Plan for 2026-11-05"));
    assert!(!vault_day.text.contains("Done in"));
    // Without either template a day starts blank (the shipped one is blank).
    fs::remove_file(root.join("templates/project-journal.md")).unwrap();
    fs::remove_file(root.join("templates/journal.md")).unwrap();
    let blank = k
        .journal(&Actor::Human, Some(PROJECT), "2026-11-06", NOW)
        .unwrap();
    assert!(frontmatter::split(&blank.text).body.trim().is_empty());
    assert!(blank.text.contains("type: journal"));
}

#[test]
fn the_core_function_makes_the_same_day_without_the_engine() {
    let (t, _k, _s) = open();
    let day = journal_day(&t.vault, Some(OTHER), DAY, NOW).unwrap();
    assert_eq!(day.meta.path, project_day(OTHER, DAY));
    assert_eq!(
        journal_day(&t.vault, Some(OTHER), DAY, NOW).unwrap().hash,
        day.hash
    );
    let new = NewNote {
        kind: Kind::Journal,
        title: "ignored".into(),
        date: "2026-11-07".into(),
        project: Some(OTHER.into()),
        parent: None,
        template: None,
        icon: None,
    };
    assert_eq!(
        create_note(&t.vault, &new, NOW).unwrap().meta.path,
        project_day(OTHER, "2026-11-07")
    );
    let missing = NewNote {
        project: Some("no-such-project".into()),
        ..new
    };
    assert!(create_note(&t.vault, &missing, NOW).is_err());
}

#[test]
fn appending_makes_the_day_and_adds_under_a_heading_in_one_commit() {
    let (_t, k, _s) = open();
    let before = commits(&k);
    let day = k
        .journal_append(
            &Actor::Human,
            Some(PROJECT),
            DAY,
            "- 09:10 Sorted the duplicates",
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(day.meta.path, project_day(PROJECT, DAY));
    assert!(
        day.text.ends_with("- 09:10 Sorted the duplicates\n"),
        "{}",
        day.text
    );
    let more = k
        .journal_append(
            &Actor::Human,
            Some(PROJECT),
            DAY,
            "- 11:30 Lunch",
            None,
            NOW,
        )
        .unwrap();
    assert!(
        more.text.contains("Sorted the duplicates") && more.text.ends_with("- 11:30 Lunch\n"),
        "{}",
        more.text
    );
    // Making the day and adding to it are two commits, adding again is one.
    assert_eq!(commits(&k), before + 3);
    // The vault's journal is not touched.
    assert!(k.read("journal/2026/2026-11-03.md").is_err());
}

#[test]
fn an_agent_appends_to_a_project_journal_and_one_undo_takes_it_back() {
    let (t, k, s) = open();
    let told = done(
        k.agent_run(&s, &append(Some(PROJECT), DAY, "Agent entry."), NOW)
            .unwrap(),
    );
    assert_eq!(told["path"], project_day(PROJECT, DAY).as_str());
    let file = t.vault.root().join(project_day(PROJECT, DAY));
    assert!(fs::read_to_string(&file).unwrap().contains("Agent entry."));
    assert_eq!(k.log(None, 1).unwrap()[0].author, "agent:kasten-chat");
    assert_eq!(k.project_journals_on(DAY).unwrap().len(), 1);

    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none() && !undone.reverted.is_empty());
    assert!(!file.exists(), "the day the agent made is taken back");
    assert!(k.project_journals_on(DAY).unwrap().is_empty());
}

#[test]
fn an_agent_opens_a_project_day_and_is_refused_a_wrong_project_or_day() {
    let (t, k, s) = open();
    let told = done(k.agent_run(&s, &open_day(Some(PROJECT), DAY), NOW).unwrap());
    assert_eq!(told["path"], project_day(PROJECT, DAY).as_str());
    let after = commits(&k);
    done(k.agent_run(&s, &open_day(Some(PROJECT), DAY), NOW).unwrap());
    assert_eq!(commits(&k), after, "a day that is there is only opened");

    for (op, words) in [
        (open_day(Some("no-such-project"), DAY), "No project called"),
        (open_day(Some("../x"), DAY), "Not a project folder"),
        (open_day(Some(PROJECT), "tomorrow"), "Not a day"),
        (append(Some("a/b"), DAY, "x"), "Not a project folder"),
        (append(Some("nope"), DAY, "x"), "No project called"),
        (append(Some(PROJECT), "soon", "x"), "Not a day"),
    ] {
        let why = refused(&k, &s, &op);
        assert!(why.contains(words), "{op:?}: {why}");
    }
    assert!(!t.vault.root().join(project_day("nope", DAY)).exists());
}

#[test]
fn a_locked_project_day_is_read_only_for_agents() {
    let (_t, k, s) = open();
    let day = k.journal(&Actor::Human, Some(PROJECT), DAY, NOW).unwrap();
    lock(&k, &day.meta.path);
    let why = refused(&k, &s, &append(Some(PROJECT), DAY, "More."));
    assert!(why.contains("locked"), "{why}");
    // Opening a day is only reading it.
    done(k.agent_run(&s, &open_day(Some(PROJECT), DAY), NOW).unwrap());
}

#[test]
fn a_project_journal_waits_in_review_when_its_project_is_in_review() {
    let (t, k, s) = open();
    // The vault is balanced; this project is held for review.
    set_mode(&k, AgentMode::Balanced, &[(PROJECT, AgentMode::Review)]);
    let file = t.vault.root().join(project_day(PROJECT, DAY));

    let id = pending(
        k.agent_run(&s, &append(Some(PROJECT), DAY, "For review."), NOW)
            .unwrap(),
    );
    assert!(!file.exists());
    let proposal = &k.proposals().unwrap()[0];
    assert!(proposal.diff.contains("For review."), "{}", proposal.diff);

    // The vault's own journal is not held by the project's mode.
    done(
        k.agent_run(&s, &append(None, DAY, "Vault entry."), NOW)
            .unwrap(),
    );
    assert!(t.vault.root().join("journal/2026/2026-11-03.md").exists());
    // Another project is not held either.
    done(
        k.agent_run(&s, &append(Some(OTHER), DAY, "Other entry."), NOW)
            .unwrap(),
    );

    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(fs::read_to_string(&file).unwrap().contains("For review."));
}

#[test]
fn opening_a_new_project_day_waits_in_review_and_is_made_when_accepted() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review, &[]);
    let id = pending(
        k.agent_run(&s, &open_day(Some(PROJECT), "2026-11-04"), NOW)
            .unwrap(),
    );
    let file = t.vault.root().join(project_day(PROJECT, "2026-11-04"));
    assert!(!file.exists());
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(file.exists());
}

#[test]
fn the_projects_that_wrote_on_a_day_come_from_the_index_by_title() {
    let (_t, k, _s) = open();
    assert!(k.project_journals_on(DAY).unwrap().is_empty());
    k.journal(&Actor::Human, Some(PROJECT), DAY, NOW).unwrap();
    k.journal(&Actor::Human, Some(OTHER), DAY, NOW).unwrap();
    k.journal(&Actor::Human, Some(OTHER), "2026-11-04", NOW)
        .unwrap();
    // The vault's own day is not a project's.
    k.journal(&Actor::Human, None, DAY, NOW).unwrap();

    let found = k.project_journals_on(DAY).unwrap();
    let got: Vec<(&str, &str, &str)> = found
        .iter()
        .map(|r| {
            (
                r.project.as_str(),
                r.project_title.as_str(),
                r.path.as_str(),
            )
        })
        .collect();
    // By the projects' titles: "Note-taking study" before "Photo organiser".
    assert_eq!(
        got,
        [
            (OTHER, "Note-taking study", project_day(OTHER, DAY).as_str()),
            (
                PROJECT,
                "Photo organiser",
                project_day(PROJECT, DAY).as_str()
            ),
        ]
    );
    assert!(found.iter().all(|r| r.date == DAY));
    assert_eq!(k.project_journals_on("2026-11-04").unwrap().len(), 1);
    assert!(k.project_journals_on("2026-11-05").unwrap().is_empty());
    let bad = k.project_journals_on("2026-13-40").unwrap_err();
    assert!(bad.to_string().contains("Not a day"), "{bad}");
}

#[test]
fn the_days_of_a_projects_journal_are_newest_first_with_paging() {
    let (_t, k, _s) = open();
    for day in ["2026-10-30", "2026-11-03", "2025-12-31", "2026-11-01"] {
        k.journal_append(
            &Actor::Human,
            Some(PROJECT),
            day,
            &format!("Entry {day}"),
            None,
            NOW,
        )
        .unwrap();
    }
    k.journal(&Actor::Human, Some(OTHER), "2026-11-02", NOW)
        .unwrap();
    k.journal(&Actor::Human, None, "2026-11-02", NOW).unwrap();

    let page = k.project_journal_days(PROJECT, 3, 0).unwrap();
    assert_eq!(
        (page.project.as_str(), page.project_title.as_str()),
        (PROJECT, "Photo organiser")
    );
    assert_eq!(page.total, 4);
    let dates: Vec<&str> = page.days.iter().map(|d| d.date.as_str()).collect();
    assert_eq!(dates, ["2026-11-03", "2026-11-01", "2026-10-30"]);
    assert_eq!(page.days[0].path, project_day(PROJECT, "2026-11-03"));
    assert_eq!(page.days[0].excerpt, "Entry 2026-11-03");
    assert!(page.days[0].words > 0 && page.days[0].modified > 0);

    let rest = k.project_journal_days(PROJECT, 3, 3).unwrap();
    assert_eq!(rest.total, 4);
    assert_eq!(rest.days.len(), 1);
    assert_eq!(rest.days[0].date, "2025-12-31");
    assert!(
        k.project_journal_days(PROJECT, 3, 40)
            .unwrap()
            .days
            .is_empty()
    );
    // A title finds the project; a stranger or a way out is refused.
    assert_eq!(
        k.project_journal_days("Photo organiser", 50, 0)
            .unwrap()
            .total,
        4
    );
    assert!(k.project_journal_days("no-such-project", 5, 0).is_err());
    assert!(k.project_journal_days("../x", 5, 0).is_err());
    // A page is never empty-limited or unbounded.
    assert_eq!(k.project_journal_days(PROJECT, 0, 0).unwrap().days.len(), 1);
    assert_eq!(k.project_journal_days(OTHER, 50, 0).unwrap().total, 1);
}

#[test]
fn the_queries_follow_the_trash_and_the_restore() {
    let (t, k, _s) = open();
    let day = k
        .journal_append(
            &Actor::Human,
            Some(PROJECT),
            DAY,
            "Gone for now.",
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(k.project_journals_on(DAY).unwrap().len(), 1);

    let trashed = k.trash(&Actor::Human, &day.meta.path, NOW).unwrap();
    assert!(!t.vault.root().join(&day.meta.path).exists());
    assert!(k.project_journals_on(DAY).unwrap().is_empty());
    assert_eq!(k.project_journal_days(PROJECT, 10, 0).unwrap().total, 0);

    let back = k.restore_trashed(&Actor::Human, &trashed).unwrap();
    assert_eq!(back.meta.path, day.meta.path);
    assert_eq!(k.project_journals_on(DAY).unwrap().len(), 1);
    assert_eq!(k.project_journal_days(PROJECT, 10, 0).unwrap().total, 1);
    assert!(back.text.contains("Gone for now."));
}

#[test]
fn the_queries_follow_a_day_written_outside_the_app() {
    let (t, k, _s) = open();
    let path = project_day(PROJECT, "2026-11-08");
    let file = t.vault.root().join(&path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(
        &file,
        "---\ntitle: \"2026-11-08\"\ntype: journal\n---\nWritten by hand.\n",
    )
    .unwrap();
    k.reindex().unwrap();
    assert_eq!(k.project_journals_on("2026-11-08").unwrap().len(), 1);
    // A stray file in the folder is not a day.
    let stray = t
        .vault
        .root()
        .join(format!("projects/{PROJECT}/journal/notes.md"));
    fs::write(&stray, "Not a day.\n").unwrap();
    k.reindex().unwrap();
    assert_eq!(k.project_journal_days(PROJECT, 10, 0).unwrap().total, 1);
}
