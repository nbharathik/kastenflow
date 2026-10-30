use super::*;
use crate::note::NoteMeta;

fn note(path: &str, title: &str) -> NoteMeta {
    let project = path
        .strip_prefix("projects/")
        .and_then(|rest| rest.split_once('/'))
        .map(|(p, _)| p.to_owned());
    NoteMeta {
        path: path.to_owned(),
        id: None,
        title: title.to_owned(),
        kind: if path.starts_with("templates/") {
            "template"
        } else {
            "page"
        }
        .to_owned(),
        icon: None,
        cover: None,
        parent: None,
        project,
        tags: Vec::new(),
        modified: 0,
        created: None,
        updated: None,
        excerpt: String::new(),
        words: 0,
        props: serde_json::Value::Null,
        locked: false,
        children_order: Vec::new(),
    }
}

pub(super) fn vault() -> Vec<NoteMeta> {
    vec![
        note("library/reading.md", "Reading"),
        note("library/either-or.md", "Either/or"),
        note("projects/trip/pages/test.md", "Test"),
        note("projects/trip/pages/test-2.md", "Test"),
        note("projects/home/pages/test.md", "Test"),
        note("projects/trip/pages/plan.md", "Plan"),
        note("projects/home/pages/plan.md", "Plan"),
        note("library/notes.md", "Notes"),
        note("templates/notes.md", "Notes"),
    ]
}

pub(super) fn place(path: &str) -> Place<'_> {
    let project = path
        .strip_prefix("projects/")
        .and_then(|rest| rest.split_once('/'))
        .map(|(p, _)| p);
    Place { path, project }
}

fn path_of<'a>(found: &Resolution<'a>) -> Option<&'a str> {
    match found {
        Resolution::Note(n) => Some(n.path.as_str()),
        _ => None,
    }
}

#[test]
fn a_title_of_its_own_goes_to_its_note_in_any_case() {
    let notes = vault();
    let dir = Directory::new(&notes);
    let from = place("library/diary.md");
    assert_eq!(
        path_of(&dir.resolve("Reading", from)),
        Some("library/reading.md")
    );
    assert_eq!(
        path_of(&dir.resolve(" reading ", from)),
        Some("library/reading.md")
    );
    assert!(matches!(
        dir.resolve("Nothing here", from),
        Resolution::Missing
    ));
    // A slash that names no note's path is part of a title.
    assert_eq!(
        path_of(&dir.resolve("Either/or", from)),
        Some("library/either-or.md")
    );
    // Templates are never where a link goes.
    assert_eq!(
        path_of(&dir.resolve("Notes", from)),
        Some("library/notes.md")
    );
}

#[test]
fn a_path_goes_to_its_note_whatever_its_title() {
    let notes = vault();
    let dir = Directory::new(&notes);
    let from = place("library/diary.md");
    for target in [
        "projects/home/pages/test",
        "Projects/Home/pages/TEST",
        "projects/home/pages/test.md",
        "projects/home/pages/Test.MD",
    ] {
        assert_eq!(
            path_of(&dir.resolve(target, from)),
            Some("projects/home/pages/test.md"),
            "{target}"
        );
    }
    assert!(matches!(
        dir.resolve("templates/notes", from),
        Resolution::Missing
    ));
}

#[test]
fn a_shared_title_goes_to_the_one_in_the_same_project_then_asks() {
    let notes = vault();
    let dir = Directory::new(&notes);
    assert_eq!(
        path_of(&dir.resolve("Plan", place("projects/home/pages/list.md"))),
        Some("projects/home/pages/plan.md")
    );
    assert_eq!(
        path_of(&dir.resolve("Plan", place("projects/trip/pages/list.md"))),
        Some("projects/trip/pages/plan.md")
    );
    // Outside both projects, nothing picks one.
    let Resolution::Ambiguous(both) = dir.resolve("Plan", place("library/diary.md")) else {
        panic!("not ambiguous")
    };
    assert_eq!(
        both.iter().map(|n| n.path.as_str()).collect::<Vec<_>>(),
        ["projects/home/pages/plan.md", "projects/trip/pages/plan.md"]
    );
    // Two in the same project: those two are the choice.
    let Resolution::Ambiguous(two) = dir.resolve("Test", place("projects/trip/pages/list.md"))
    else {
        panic!("not ambiguous")
    };
    assert_eq!(two.len(), 2);
    assert!(two.iter().all(|n| n.project.as_deref() == Some("trip")));
}

#[test]
fn a_note_linking_its_own_title_means_another_note() {
    let notes = vault();
    let dir = Directory::new(&notes);
    // Trip has two "Test" pages: from one, the other.
    assert_eq!(
        path_of(&dir.resolve("Test", place("projects/trip/pages/test.md"))),
        Some("projects/trip/pages/test-2.md")
    );
    assert_eq!(
        path_of(&dir.resolve("Test", place("projects/trip/pages/test-2.md"))),
        Some("projects/trip/pages/test.md")
    );
    // Alone with its title, a note's link to it is to itself.
    assert_eq!(
        path_of(&dir.resolve("Reading", place("library/reading.md"))),
        Some("library/reading.md")
    );
}

#[test]
fn a_link_names_the_title_when_that_finds_the_note_and_the_path_when_not() {
    let notes = vault();
    let dir = Directory::new(&notes);
    let reading = &notes[0];
    assert_eq!(
        dir.target_for(reading, place("projects/trip/pages/x.md")),
        ("Reading".to_owned(), None)
    );
    let home_plan = &notes[6];
    assert_eq!(
        dir.target_for(home_plan, place("projects/home/pages/x.md")),
        ("Plan".to_owned(), None)
    );
    assert_eq!(
        dir.target_for(home_plan, place("library/diary.md")),
        (
            "projects/home/pages/plan".to_owned(),
            Some("Plan".to_owned())
        )
    );
}

#[test]
fn parts_split_the_target_heading_and_alias() {
    assert_eq!(
        parts("Title"),
        LinkParts {
            target: "Title",
            heading: None,
            alias: None
        }
    );
    assert_eq!(
        parts(" Title #Goals| the goals "),
        LinkParts {
            target: "Title",
            heading: Some("Goals"),
            alias: Some(" the goals ")
        }
    );
    assert_eq!(
        parts("a/b|B"),
        LinkParts {
            target: "a/b",
            heading: None,
            alias: Some("B")
        }
    );
}

#[test]
fn spans_are_the_links_the_index_sees() {
    let body = "See [[A]] and ![[B#h|x]].\n`[[code]]` \\[[escaped]] [[]] [[x[y]]\n```\n[[fenced]]\n```\n[[C]]";
    let found: Vec<&str> = scan::link_spans(body)
        .into_iter()
        .map(|r| &body[r])
        .collect();
    assert_eq!(found, ["A", "B#h|x", "C"]);
}
