//! Every project's counts and state in one read: what the Projects hub shows.
//! Statuses default to Active, unknown values read as Other, templates and
//! other projects' notes count for nothing, and a project's latest activity
//! includes its boards and decks.

use crate::common;
use crate::deck_support::deck;

use std::fs;
use std::time::{Duration, SystemTime};

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Kasten, ProjectState, ProjectSummary};

mod kept;

const TODAY: &str = "2026-10-06";

fn write(t: &common::TempVault, rel: &str, text: &str) {
    let file = t.vault.root().join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

/// Sets a file's modified time to `secs` seconds after the Unix epoch.
fn touch(t: &common::TempVault, rel: &str, secs: u64) {
    let file = fs::File::options()
        .write(true)
        .open(t.vault.root().join(rel))
        .unwrap();
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
        .unwrap();
}

fn note(title: &str, kind: &str, tags: &str, props: &str, body: &str) -> String {
    let props = if props.is_empty() {
        String::new()
    } else {
        format!("props:\n{props}")
    };
    format!("---\ntitle: {title}\ntype: {kind}\ntags: [{tags}]\n{props}---\n{body}")
}

/// A task note: `tag` is how the test spells the `task` tag.
fn task(title: &str, tag: &str, status: &str, due: &str) -> String {
    let props = format!("  status: {status}\n  due: {due}\n");
    note(title, "card", tag, &props, "")
}

fn update(title: &str, date: &str) -> String {
    note(
        title,
        "page",
        "project-update",
        &format!("  date: {date}\n"),
        "",
    )
}

/// The dev vault plus three projects of known contents, indexed.
fn vault() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let alpha_page = note(
        "Alpha",
        "project",
        "project",
        "  summary: The first one\n  status: Active\n  health: At risk\n  review_after: 2026-10-01\n  last_review: 2026-09-01\n",
        "- [ ] overdue @2026-10-01\n- [ ] later @2026-10-20\n- [x] finished\n",
    );
    let beta_page = note(
        "Beta",
        "project",
        "project",
        "  archived: true\n  status: Done\n  review_after: 2026-01-01\n",
        "- [ ] never\n",
    );
    let gamma_page = note(
        "Gamma",
        "project",
        "project",
        "  status: Someday\n  health: Fine\n  review_after: 2026-10-06\n",
        "",
    );
    let board = "{\"nodes\": [], \"edges\": [], \"x-kasten\": {\"title\": \"Map\"}}\n";
    let overdue_todo = "  status: Todo\n  due: 2020-01-01\n";
    // A template, a loose note and a task elsewhere count for no project.
    let files: Vec<(&str, String)> = vec![
        ("projects/alpha/_project.md", alpha_page),
        (
            "projects/alpha/pages/p.md",
            note("Plain page", "page", "", "", "- [ ] no day\n"),
        ),
        (
            "projects/alpha/cards/t1.md",
            task("Task one", "task", "Todo", "2026-10-02"),
        ),
        (
            "projects/alpha/cards/t2.md",
            task("Task two", "task", "Doing", "2026-12-01"),
        ),
        (
            "projects/alpha/cards/t3.md",
            task("Task three", "Task", "Done", "2026-01-01"),
        ),
        (
            "projects/alpha/pages/update-1.md",
            update("Update one", "2026-09-30"),
        ),
        (
            "projects/alpha/pages/update-2.md",
            update("Update two", "2026-10-03"),
        ),
        ("projects/alpha/boards/map.canvas", board.to_owned()),
        (
            "projects/alpha/decks/talk.deck",
            deck("Talk", &[("a", "Hi")]),
        ),
        ("projects/beta/_project.md", beta_page),
        ("projects/gamma/_project.md", gamma_page),
        (
            "templates/project-task.md",
            note(
                "Template task",
                "card",
                "task",
                overdue_todo,
                "- [ ] template to-do @2020-01-01\n",
            ),
        ),
        (
            "library/loose.md",
            note(
                "Loose",
                "page",
                "task",
                overdue_todo,
                "- [ ] loose @2020-01-01\n",
            ),
        ),
    ];
    for (path, text) in &files {
        write(&t, path, text);
    }
    touch(&t, "projects/alpha/_project.md", 1_000);
    for p in [
        "pages/p.md",
        "cards/t1.md",
        "cards/t2.md",
        "cards/t3.md",
        "pages/update-1.md",
    ] {
        touch(&t, &format!("projects/alpha/{p}"), 2_000);
    }
    touch(&t, "projects/alpha/pages/update-2.md", 3_000);
    touch(&t, "projects/alpha/boards/map.canvas", 5_000);
    touch(&t, "projects/alpha/decks/talk.deck", 4_000);
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn by_folder<'a>(all: &'a [ProjectSummary], folder: &str) -> &'a ProjectSummary {
    all.iter().find(|p| p.folder == folder).unwrap_or_else(|| {
        panic!(
            "no {folder} in {:?}",
            all.iter().map(|p| &p.folder).collect::<Vec<_>>()
        )
    })
}

#[test]
fn lists_every_project_by_title_archived_ones_too_and_nothing_else() {
    let (_t, k) = vault();
    let all = k.project_summaries(TODAY).unwrap();
    let titles: Vec<&str> = all.iter().map(|p| p.title.as_str()).collect();
    assert_eq!(
        titles,
        [
            "Alpha",
            "Beta",
            "Gamma",
            "Note-taking study",
            "Photo organiser"
        ]
    );
    let alpha = by_folder(&all, "alpha");
    assert_eq!(
        (alpha.path.as_str(), alpha.summary.as_deref()),
        ("projects/alpha/_project.md", Some("The first one"))
    );
    let photos = by_folder(&all, "photo-organiser");
    assert_eq!(
        (photos.icon.as_deref(), photos.id.as_deref()),
        (Some("📷"), Some("01M36KA240FSE6QQ48JWZEWGTP"))
    );
}

#[test]
fn counts_tasks_by_status_and_to_dos_by_day_for_the_project_alone() {
    let (_t, k) = vault();
    let all = k.project_summaries(TODAY).unwrap();
    let alpha = by_folder(&all, "alpha");
    // Task notes: one overdue and open, one open, one done long ago.
    let tasks = alpha.tasks;
    assert_eq!((tasks.open, tasks.done, tasks.overdue), (2, 1, 1));
    // To-do lines: the project page holds three, the plain page one; the template's and the loose note's count for nobody.
    let todos = alpha.checklist;
    assert_eq!((todos.open, todos.done, todos.overdue), (3, 1, 1));
    // Notes: everything but the project page and the template.
    assert_eq!((alpha.notes, alpha.boards, alpha.decks), (6, 1, 1));
    let beta = by_folder(&all, "beta");
    assert_eq!(
        (beta.tasks.open, beta.checklist.open, beta.notes),
        (0, 1, 0)
    );
    let study = by_folder(&all, "note-taking-study");
    // Its page holds six to-dos, its report draft four more.
    assert_eq!((study.checklist.open, study.checklist.done), (9, 1));
}

#[test]
fn a_page_with_no_status_is_active_and_an_unknown_one_is_other() {
    let (_t, k) = vault();
    let all = k.project_summaries(TODAY).unwrap();
    assert_eq!(by_folder(&all, "photo-organiser").status, "Active");
    assert_eq!(by_folder(&all, "photo-organiser").health, None);
    assert_eq!(by_folder(&all, "alpha").status, "Active");
    assert_eq!(by_folder(&all, "alpha").health.as_deref(), Some("At risk"));
    let gamma = by_folder(&all, "gamma");
    assert_eq!(
        (gamma.status.as_str(), gamma.health.as_deref()),
        ("Other", Some("Other"))
    );
    let beta = by_folder(&all, "beta");
    assert_eq!((beta.status.as_str(), beta.archived), ("Done", true));
    assert!(!by_folder(&all, "alpha").archived);
}

#[test]
fn a_review_is_due_on_its_day_unless_the_project_is_done_or_archived() {
    let (_t, k) = vault();
    let all = k.project_summaries(TODAY).unwrap();
    let alpha = by_folder(&all, "alpha");
    assert_eq!(
        (
            alpha.review_after.as_deref(),
            alpha.last_review.as_deref(),
            alpha.review_due
        ),
        (Some("2026-10-01"), Some("2026-09-01"), true)
    );
    assert!(by_folder(&all, "gamma").review_due, "the day itself is due");
    assert!(!by_folder(&all, "beta").review_due, "archived and done");
    assert!(!by_folder(&all, "photo-organiser").review_due);
    // The day decides: the day before, nothing is due.
    let earlier = k.project_summaries("2026-09-30").unwrap();
    assert!(!by_folder(&earlier, "alpha").review_due);
    assert_eq!(by_folder(&earlier, "alpha").tasks.overdue, 0);
}

#[test]
fn the_latest_activity_includes_boards_and_decks_and_the_last_update_is_the_newest_dated() {
    let (_t, k) = vault();
    let all = k.project_summaries(TODAY).unwrap();
    let alpha = by_folder(&all, "alpha");
    let latest = alpha.latest.as_ref().unwrap();
    assert_eq!(
        (
            latest.path.as_str(),
            latest.kind.as_str(),
            latest.title.as_str(),
            latest.modified
        ),
        (
            "projects/alpha/boards/map.canvas",
            "board",
            "Map",
            5_000_000
        )
    );
    let update = alpha.last_update.as_ref().unwrap();
    assert_eq!(
        (
            update.path.as_str(),
            update.title.as_str(),
            update.date.as_deref()
        ),
        (
            "projects/alpha/pages/update-2.md",
            "Update two",
            Some("2026-10-03")
        )
    );
    assert!(by_folder(&all, "gamma").last_update.is_none());
    // A project with only its page: that page is its latest.
    let gamma = by_folder(&all, "gamma").latest.as_ref().unwrap();
    assert_eq!(
        (gamma.path.as_str(), gamma.kind.as_str()),
        ("projects/gamma/_project.md", "project")
    );
}

#[test]
fn the_next_action_is_the_task_it_names_and_whether_it_is_done() {
    let (_t, k) = vault();
    let next = |k: &Kasten| {
        by_folder(&k.project_summaries(TODAY).unwrap(), "alpha")
            .next_action
            .clone()
    };
    assert!(next(&k).is_none());
    let state = ProjectState {
        next_action: Some(Some("Task two".into())),
        ..ProjectState::default()
    };
    k.set_project_state(&Actor::Human, "projects/alpha/_project.md", &state, NOW)
        .unwrap();
    let action = next(&k).unwrap();
    assert_eq!(
        (action.path.as_str(), action.title.as_str(), action.done),
        ("projects/alpha/cards/t2.md", "Task two", false)
    );
    let id = k.read("projects/alpha/cards/t2.md").unwrap().meta.id;
    assert_eq!(Some(action.id), id);
    // Done in the task's own properties.
    let props = serde_json::json!({"status": "Done"})
        .as_object()
        .unwrap()
        .clone();
    k.update_props(&Actor::Human, "projects/alpha/cards/t2.md", &props, NOW)
        .unwrap();
    assert!(next(&k).unwrap().done);
    // Trashed, it is gone from the summary, not an error.
    k.trash(&Actor::Human, "projects/alpha/cards/t2.md", NOW)
        .unwrap();
    assert!(next(&k).is_none());
}

#[test]
fn a_changed_note_or_a_new_board_shows_in_the_next_read() {
    let (_t, k) = vault();
    let before = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").clone();
    k.create_board(&Actor::Human, "Second", Some("alpha"), NOW)
        .unwrap();
    let page = k.read("projects/alpha/pages/p.md").unwrap();
    k.save_body(
        &Actor::Human,
        "projects/alpha/pages/p.md",
        "- [ ] one\n- [x] two\n- [x] three\n",
        &page.hash,
        NOW,
    )
    .unwrap();
    let after = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").clone();
    assert_eq!(after.boards, before.boards + 1);
    // One open line became one open and two done.
    assert_eq!(
        (after.checklist.open, after.checklist.done),
        (before.checklist.open, before.checklist.done + 2)
    );
    assert!(after.latest.unwrap().modified > before.latest.unwrap().modified);
}

#[test]
fn today_has_to_be_a_real_day() {
    let (_t, k) = vault();
    for bad in ["", "today", "2026-13-01", "2026-02-30", "06/10/2026"] {
        assert!(k.project_summaries(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn serves_the_hub_in_the_shape_the_app_reads() {
    let (_t, k) = vault();
    let json = serde_json::to_value(k.project_summaries(TODAY).unwrap()).unwrap();
    let alpha = json
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["folder"] == "alpha")
        .unwrap();
    for key in [
        "path",
        "folder",
        "id",
        "title",
        "icon",
        "summary",
        "archived",
        "status",
        "health",
        "nextAction",
        "lastReview",
        "reviewAfter",
        "reviewDue",
        "tasks",
        "checklist",
        "latest",
        "lastUpdate",
        "notes",
        "boards",
        "decks",
    ] {
        assert!(alpha.get(key).is_some(), "missing {key} in {alpha}");
    }
    assert_eq!(
        alpha["tasks"],
        serde_json::json!({"open": 2, "done": 1, "overdue": 1})
    );
    assert_eq!(alpha["lastUpdate"]["title"], "Update two");
}
