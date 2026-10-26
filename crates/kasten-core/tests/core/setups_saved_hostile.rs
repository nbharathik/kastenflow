//! Saved setups from a vault that came from somewhere else: names a disk
//! reads as another, names Windows reads as devices (refused on every system),
//! files that are links or junctions, very many or very large entries, YAML
//! built to blow up, and a page whose text already holds a placeholder.

use std::fs;
use std::path::Path;

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::setups_saved::{DRAFT, PROJECT, new, pages, tree};
use kasten_core::history::Actor;

const PAGE: &str = "---\nid: \"{{id:p1}}\"\ntitle: A page\ntype: page\n---\nText.\n";

fn put(root: &Path, rel: &str, text: &str) {
    let file = root.join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

#[test]
fn names_that_differ_only_by_case_are_refused_as_one_file_twice() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    put(root, "templates/setups/twice/pages/A.md", PAGE);
    put(root, "templates/setups/twice/pages/a.md", PAGE);
    put(
        root,
        "templates/setups/twice.yaml",
        "name: Twice\nhome: pages/A.md\npages:\n  - pages/A.md\n  - pages/a.md\n",
    );
    let listed = k.list_setups().unwrap();
    let twice = listed.iter().find(|s| s.id == "saved:twice").unwrap();
    assert_eq!(
        twice.files,
        ["pages/A.md"],
        "the second spelling is not kept"
    );
    let before = snapshot(root);
    let err = k
        .apply_setup(&Actor::Human, "saved:twice", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("twice") && err.contains("may not use"),
        "{err}"
    );
    assert_eq!(snapshot(root), before);
    // The same name twice is one page.
    put(
        root,
        "templates/setups/twice.yaml",
        "name: Twice\nhome: pages/A.md\npages:\n  - pages/A.md\n  - pages/A.md\n",
    );
    k.apply_setup(&Actor::Human, "saved:twice", &new("Victim"), NOW)
        .unwrap();
    assert!(root.join("projects/victim/pages/A.md").is_file());
}

#[test]
fn device_names_odd_endings_and_long_names_are_refused_on_every_system() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    fs::create_dir_all(root.join("templates/setups")).unwrap();
    let long = format!("pages/{}.md", "x".repeat(260));
    let entries = [
        "pages/nul.md",
        "pages/NUL.md",
        "pages/Com1.md",
        "pages/lpt9.md",
        "pages/aux.txt.md",
        "pages/con .md",
        "pages/x .md",
        "pages/ x.md",
        "pages/x./y.md",
        "pages/x\u{0}.md",
        "pages/x\u{7}.md",
        "pages/x\ny.md",
        "pages/a*b.md",
        "pages/a?b.md",
        "pages/a:b.md",
        "pages/a<b.md",
        "pages/a|b.md",
        "pages/a\"b.md",
        "pages/CONIN$.md",
        long.as_str(),
    ];
    for entry in entries {
        let yaml = format!(
            "name: Evil\nhome: _project.md\npages:\n  - {}\n",
            serde_json::to_string(entry).unwrap()
        );
        fs::write(root.join("templates/setups/evil.yaml"), yaml).unwrap();
        let before = snapshot(root);
        let listed = k.list_setups().unwrap();
        let evil = listed.iter().find(|s| s.id == "saved:evil").unwrap();
        assert!(evil.files.is_empty(), "{entry:?}: {:?}", evil.files);
        assert!(
            k.apply_setup(&Actor::Human, "saved:evil", &new("Victim"), NOW)
                .is_err(),
            "{entry:?}"
        );
        assert_eq!(snapshot(root), before, "{entry:?}");
    }
    // A list entry that is not text is refused too.
    for bad in [
        "pages: [1]",
        "pages: [[a]]",
        "pages: {a: b}",
        "pages: 7",
        "tags: [null]",
    ] {
        fs::write(
            root.join("templates/setups/evil.yaml"),
            format!("name: Evil\n{bad}\n"),
        )
        .unwrap();
        assert!(
            k.apply_setup(&Actor::Human, "saved:evil", &new("Victim"), NOW)
                .is_err(),
            "{bad}"
        );
    }
    assert!(!root.join("projects/victim").exists());
}

#[test]
fn very_many_entries_and_big_files_are_refused_without_reading_them_all() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    let mut yaml = String::from("name: Many\nhome: _project.md\npages:\n");
    for n in 0..9_000 {
        yaml.push_str(&format!("  - pages/p{n}.md\n"));
    }
    put(root, "templates/setups/many.yaml", &yaml);
    let before = snapshot(root);
    let err = k
        .apply_setup(&Actor::Human, "saved:many", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("60"), "{err}");
    assert_eq!(snapshot(root), before);
    // A manifest over its size is not read at all, and is not listed.
    put(
        root,
        "templates/setups/huge.yaml",
        &format!("name: Huge\nnote: \"{}\"\n", "x".repeat(300_000)),
    );
    assert!(
        k.list_setups()
            .unwrap()
            .iter()
            .all(|s| s.id != "saved:huge")
    );
    assert!(
        k.apply_setup(&Actor::Human, "saved:huge", &new("Victim"), NOW)
            .is_err()
    );
    // Sixty pages of 100 KB each are over the whole setup's limit.
    let mut yaml = String::from("name: Wide\nhome: _project.md\npages:\n");
    for n in 0..60 {
        yaml.push_str(&format!("  - pages/p{n}.md\n"));
        put(
            root,
            &format!("templates/setups/wide/pages/p{n}.md"),
            &format!("---\ntitle: P{n}\n---\n{}\n", "x".repeat(99_000)),
        );
    }
    put(root, "templates/setups/wide.yaml", &yaml);
    let err = k
        .apply_setup(&Actor::Human, "saved:wide", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("too large"), "{err}");
    assert!(!root.join("projects/victim").exists());
}

#[test]
fn a_yaml_alias_bomb_in_the_manifest_or_a_skeleton_does_no_harm() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    // Nested aliases: a million entries once expanded.
    let mut bomb = String::from("a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n");
    for n in 1..6 {
        let prev = n - 1;
        bomb.push_str(&format!(
            "a{n}: &a{n} [*a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}]\n"
        ));
    }
    put(
        root,
        "templates/setups/bomb.yaml",
        &format!("name: Bomb\nhome: pages/a.md\npages:\n  - pages/a.md\n{bomb}"),
    );
    put(root, "templates/setups/bomb/pages/a.md", PAGE);
    let _ = k.list_setups().unwrap();
    let done = k.apply_setup(&Actor::Human, "saved:bomb", &new("Victim"), NOW);
    if done.is_ok() {
        assert!(root.join("projects/victim/pages/a.md").is_file());
    }
    // The same in a skeleton's header: the page is written as text and read back.
    put(
        root,
        "templates/setups/laugh.yaml",
        "name: Laugh\nhome: pages/a.md\npages:\n  - pages/a.md\n",
    );
    put(
        root,
        "templates/setups/laugh/pages/a.md",
        &format!("---\nid: \"{{{{id:p1}}}}\"\ntitle: Laugh\ntype: page\n{bomb}---\nbody\n"),
    );
    k.apply_setup(&Actor::Human, "saved:laugh", &new("Second"), NOW)
        .unwrap();
    k.reindex().unwrap();
    let _ = k.list().unwrap();
}

#[test]
fn a_deeply_nested_manifest_is_refused_not_a_crash() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    let deep = format!(
        "name: Deep\nx: {}{}\n",
        "[".repeat(50_000),
        "]".repeat(50_000)
    );
    put(root, "templates/setups/deep.yaml", &deep);
    let _ = k.list_setups().unwrap();
    let _ = k.apply_setup(&Actor::Human, "saved:deep", &new("Victim"), NOW);
    let nested = format!(
        "name: Deep\nx: {}1{}\n",
        "{a: ".repeat(20_000),
        "}".repeat(20_000)
    );
    put(root, "templates/setups/deep.yaml", &nested);
    let _ = k.list_setups().unwrap();
    let _ = k.apply_setup(&Actor::Human, "saved:deep", &new("Victim"), NOW);
}

#[test]
fn applying_writes_only_into_the_new_project_and_the_tags_folder() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    put(
        root,
        "templates/setups/mine.yaml",
        "name: Mine\nhome: pages/a.md\nprops:\n  owner: me\npages:\n  - pages/a.md\n  - pages/b.md\ntags:\n  - fresh-tag\nunknown_key: [1, 2]\n",
    );
    put(root, "templates/setups/mine/pages/a.md", PAGE);
    put(
        root,
        "templates/setups/mine/pages/b.md",
        "---\nid: \"{{id:p2}}\"\ntitle: B\nparent: \"{{id:p1}}\"\ntype: page\n---\nSee [[A page]].\n",
    );
    put(
        root,
        "templates/setups/mine/vault/tags/fresh-tag.yaml",
        "name: fresh-tag\nproperties:\n  - name: status\n    type: text\n",
    );
    let before = tree(root);
    k.apply_setup(&Actor::Human, "saved:mine", &new("Victim"), NOW)
        .unwrap();
    let after = tree(root);
    for (path, bytes) in &after {
        match before.get(path) {
            Some(old) if old == bytes => {}
            _ => assert!(
                path.starts_with("projects/victim/") || path == "tags/fresh-tag.yaml",
                "{path} was written"
            ),
        }
    }
    for path in before.keys() {
        assert!(after.contains_key(path), "{path} went");
    }
    assert!(after.contains_key("projects/victim/pages/b.md"));
    assert!(after.contains_key("tags/fresh-tag.yaml"));
}

#[test]
fn a_tag_file_that_says_it_is_another_tag_is_refused_and_nothing_is_written() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    put(
        root,
        "templates/setups/liar.yaml",
        "name: Liar\nhome: pages/a.md\npages:\n  - pages/a.md\ntags:\n  - fresh-tag\n",
    );
    put(root, "templates/setups/liar/pages/a.md", PAGE);
    // Named fresh-tag, but it says it is paper, a tag the vault already has.
    put(
        root,
        "templates/setups/liar/vault/tags/fresh-tag.yaml",
        "name: paper\nproperties:\n  - name: status\n    type: text\n",
    );
    let before = tree(root);
    let err = k
        .apply_setup(&Actor::Human, "saved:liar", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("fresh-tag.yaml") && err.contains("paper"),
        "{err}"
    );
    assert_eq!(tree(root), before);
}

#[test]
fn a_page_with_a_placeholder_in_its_text_is_refused_by_name_and_nothing_is_written() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    let path = "projects/note-taking-study/pages/tricky.md";
    for (n, token) in [
        "{{id:p1}}",
        "{{date}}",
        "{{project}}",
        "{{slug}}",
        "{{id8:x}}",
    ]
    .into_iter()
    .enumerate()
    {
        fs::write(
            root.join(path),
            format!("---\ntitle: Tricky\ntype: page\n---\nLook: {token} here.\n"),
        )
        .unwrap();
        k.reindex().unwrap();
        let before = snapshot(root);
        let err = k
            .save_project_setup(
                &Actor::Human,
                PROJECT,
                "",
                "Kit",
                &pages(&[DRAFT, path]),
                NOW,
            )
            .unwrap_err()
            .to_string();
        let shown = token.split(':').next().unwrap();
        assert!(err.contains("Tricky") && err.contains(shown), "{n}: {err}");
        assert_eq!(snapshot(root), before, "{token}");
        // Leaving that page out is all it takes.
        assert!(
            k.save_project_setup(&Actor::Human, PROJECT, "", "Kit", &pages(&[DRAFT]), NOW)
                .is_ok(),
            "leaving the page out saves"
        );
        k.trash_setup(&Actor::Human, "saved:kit", NOW).unwrap();
    }
    fs::write(
        root.join(path),
        "---\ntitle: Tricky\ntype: page\n---\nBraces {{ like this }} and {x} are plain.\n",
    )
    .unwrap();
    k.reindex().unwrap();
    k.save_project_setup(&Actor::Human, PROJECT, "", "Kit", &pages(&[path]), NOW)
        .unwrap();
}

#[test]
fn a_page_that_names_a_note_of_the_vault_by_id_is_not_applied() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    let theirs = k.read(DRAFT).unwrap().meta.id.unwrap();
    for (n, header) in [
        format!("id: {theirs}"),
        format!("id: \"{theirs}\""),
        format!("id: \"{{{{id:p1}}}}\"\nparent: {theirs}"),
        format!("\"id\": {theirs}"),
        "id: 12345".to_owned(),
        format!("id: \"{{{{id:p1}}}}\"\nparent: \"{{{{id:p1}}}}-{theirs}\""),
        format!("id: \"{{{{id:p1}}}}\"\nchildren_order: [\"{theirs}\"]"),
        format!("id: \"{{{{id:p1}}}}\"\nchildren_order:\n  - \"{{{{id:p1}}}}\"\n  - {theirs}"),
        "id: \"{{id:p1}}\"\nchildren_order: 7".to_owned(),
    ]
    .into_iter()
    .enumerate()
    {
        put(
            root,
            "templates/setups/theirs/pages/a.md",
            &format!("---\n{header}\ntitle: A\ntype: page\n---\nx\n"),
        );
        put(
            root,
            "templates/setups/theirs.yaml",
            "name: Theirs\nhome: pages/a.md\npages:\n  - pages/a.md\n",
        );
        let before = snapshot(root);
        let err = k
            .apply_setup(&Actor::Human, "saved:theirs", &new("Victim"), NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("by id"), "{n}: {err}");
        assert_eq!(snapshot(root), before, "{n}");
    }
    // Its own placeholders, quoted or not, and no id at all are fine.
    for (n, header) in [
        "id: \"{{id:p1}}\"\nparent: \"{{id:p2}}\"",
        "id: {{id:p1}}",
        "note: no id",
    ]
    .into_iter()
    .enumerate()
    {
        put(
            root,
            "templates/setups/theirs/pages/a.md",
            &format!("---\n{header}\ntitle: A\ntype: page\n---\nx\n"),
        );
        k.apply_setup(
            &Actor::Human,
            "saved:theirs",
            &new(&format!("Fine {n}")),
            NOW,
        )
        .unwrap();
        assert!(root.join(format!("projects/fine-{n}/pages/a.md")).is_file());
    }
}

#[test]
fn engines_saving_the_same_name_at_once_leave_whole_setups_with_their_own_names() {
    let (t, _k, _s) = open();
    let root = t.vault.root().to_path_buf();
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let root = root.clone();
            std::thread::spawn(move || {
                let k = kasten_core::Kasten::open(&root).unwrap();
                k.save_project_setup(&Actor::Human, PROJECT, "", "Race", &pages(&[DRAFT]), NOW)
                    .map(|saved| saved.slug)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let mut slugs: Vec<String> = results
        .iter()
        .filter_map(|r| r.as_ref().ok().cloned())
        .collect();
    assert!(!slugs.is_empty(), "{results:?}");
    let all = slugs.len();
    slugs.sort();
    slugs.dedup();
    assert_eq!(slugs.len(), all, "two saves took one name: {slugs:?}");
    for err in results.iter().filter_map(|r| r.as_ref().err()) {
        assert!(err.to_string().contains("try again"), "{err}");
    }
    // Each setup that is there has its manifest and its page, and applies.
    let k = kasten_core::Kasten::open(&root).unwrap();
    for slug in &slugs {
        assert!(root.join(format!("templates/setups/{slug}.yaml")).is_file());
        assert!(
            root.join(format!("templates/setups/{slug}/pages/report-draft.md"))
                .is_file()
        );
    }
    let listed: Vec<_> = k
        .list_setups()
        .unwrap()
        .into_iter()
        .filter(|s| s.saved)
        .collect();
    assert_eq!(listed.len(), slugs.len());
    k.apply_setup(
        &Actor::Human,
        &format!("saved:{}", slugs[0]),
        &new("After race"),
        NOW,
    )
    .unwrap();
}

/// A junction (a folder link Windows makes without special rights) is not followed.
#[cfg(windows)]
fn junction(link: &Path, target: &Path) -> bool {
    std::process::Command::new("cmd")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(target.to_string_lossy().replace('/', "\\"))
        .output()
        .is_ok_and(|out| out.status.success())
}

#[cfg(windows)]
#[test]
fn a_junction_in_a_setup_or_in_place_of_its_folder_is_never_followed() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    let outside = std::env::temp_dir().join(format!("kasten-junction-{}", std::process::id()));
    fs::create_dir_all(outside.join("pages")).unwrap();
    fs::write(outside.join("pages/a.md"), PAGE).unwrap();
    fs::create_dir_all(root.join("templates/setups/linked")).unwrap();
    assert!(
        junction(
            &root.join("templates/setups/linked/pages"),
            &outside.join("pages")
        ),
        "mklink /J needs no special rights"
    );
    put(
        root,
        "templates/setups/linked.yaml",
        "name: Linked\nhome: pages/a.md\npages:\n  - pages/a.md\n",
    );
    assert!(
        k.apply_setup(&Actor::Human, "saved:linked", &new("Victim"), NOW)
            .is_err()
    );
    assert!(!root.join("projects/victim").exists());
    // Saving into a `templates/setups` that is a junction writes nothing outside.
    fs::remove_dir_all(root.join("templates/setups")).unwrap();
    let elsewhere = outside.join("setups");
    fs::create_dir_all(&elsewhere).unwrap();
    assert!(junction(&root.join("templates/setups"), &elsewhere));
    assert!(
        k.save_project_setup(&Actor::Human, PROJECT, "", "Kit", &pages(&[DRAFT]), NOW)
            .is_err()
    );
    assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);
    let _ = fs::remove_dir(root.join("templates/setups"));
    let _ = fs::remove_dir_all(&outside);
}
