//! Diagrams (`.drawio` with a `.drawio.svg` picture beside it) on disk and
//! through the engine. Core keeps the source as the editor wrote it, checks
//! that it is a diagram, and keeps the two files together: they are written
//! as one, and they move, rename, duplicate, trash and come back as one.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::board::Layout;
use kasten_core::diagrams::{self, DiagramSaved, Preview};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, content_hash};

const PROJECT: &str = "photo-organiser";

const XML: &str = "<mxfile host=\"test\">\n  <diagram id=\"p1\" name=\"Page-1\">\n    <mxGraphModel>\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n        <mxCell id=\"2\" value=\"Hello\" vertex=\"1\" parent=\"1\" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n";

const SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"81px\" height=\"41px\" viewBox=\"-0.5 -0.5 81 41\"><defs/><g><rect x=\"0\" y=\"0\" width=\"80\" height=\"40\"/></g></svg>";

fn xml_with(label: &str) -> String {
    XML.replace("Hello", label)
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn invalid<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn exists(t: &common::TempVault, path: &str) -> bool {
    t.vault.root().join(path).exists()
}

#[test]
fn the_source_must_be_a_well_formed_diagram_of_a_sensible_size() {
    assert_eq!(diagrams::check_xml(XML).unwrap(), 1);
    let two = "<mxfile><diagram name=\"a\"><mxGraphModel/></diagram><diagram name=\"b\"><mxGraphModel/></diagram></mxfile>";
    assert_eq!(diagrams::check_xml(two).unwrap(), 2);
    // A single model, as the editor can also export, counts as one page.
    assert_eq!(
        diagrams::check_xml("<mxGraphModel><root/></mxGraphModel>").unwrap(),
        1
    );
    assert_eq!(
        diagrams::check_xml(diagrams::blank_xml().as_str()).unwrap(),
        1
    );

    for (text, why) in [
        ("", "root"),
        ("<html><body/></html>", "not a diagram"),
        (
            "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            "not a diagram",
        ),
        ("<mxfile><diagram></mxfile>", "closing"),
        ("not xml at all", "outside"),
        ("<!DOCTYPE mxfile><mxfile/>", "declaration"),
        ("<mxfile>&nbsp;</mxfile>", "reference"),
    ] {
        let message = invalid(diagrams::check_xml(text).map(|_| ()));
        assert!(message.contains(why), "{text:?}: {message}");
    }

    let big = format!(
        "<mxfile><!-- {} --></mxfile>",
        "x".repeat(diagrams::MAX_BYTES)
    );
    assert!(invalid(diagrams::check_xml(&big).map(|_| ())).contains("too large"));
}

#[test]
fn the_picture_must_be_a_well_formed_svg_that_runs_nothing() {
    diagrams::check_svg(SVG).unwrap();
    for (text, why) in [
        ("<mxfile/>", "not an SVG"),
        ("<svg><g></svg>", "closing"),
        ("<svg><script>alert(1)</script></svg>", "script"),
        ("<svg xmlns:x=\"y\"><x:script/></svg>", "script"),
        ("", "root"),
    ] {
        let message = invalid(diagrams::check_svg(text));
        assert!(message.contains(why), "{text:?}: {message}");
    }
    let big = format!("<svg><!-- {} --></svg>", "x".repeat(diagrams::MAX_BYTES));
    assert!(invalid(diagrams::check_svg(&big)).contains("too large"));
}

#[test]
fn the_picture_carries_the_hash_of_the_source_it_was_drawn_from() {
    let stamped = diagrams::stamped(SVG, "abc123");
    assert!(stamped.starts_with(SVG));
    assert!(stamped.ends_with("-->\n"), "{stamped}");
    assert_eq!(diagrams::stamp_of(&stamped), Some("abc123"));
    diagrams::check_svg(&stamped).unwrap();
    assert_eq!(diagrams::stamp_of(SVG), None);
    // Stamping again replaces the stamp rather than piling them up.
    let again = diagrams::stamped(&stamped, "def456");
    assert_eq!(diagrams::stamp_of(&again), Some("def456"));
    assert_eq!(again.matches("kasten-source").count(), 1);
    // The picture's own text is not touched.
    assert!(again.starts_with(SVG));
    assert_eq!(
        diagrams::sidecar_of("library/a.drawio"),
        "library/a.drawio.svg"
    );
}

#[test]
fn a_new_diagram_goes_where_boards_go_and_never_replaces_one() {
    let t = dev_vault();
    let library = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    assert_eq!(library, "library/Login-flow.drawio");
    assert_eq!(text_of(&t, &library), diagrams::blank_xml());
    let again = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    assert_eq!(again, "library/Login-flow-2.drawio");
    let project = diagrams::create_diagram(&t.vault, "Q3 map", Some(PROJECT), None).unwrap();
    assert_eq!(project, "projects/photo-organiser/diagrams/Q3-map.drawio");

    // A source the editor or an agent made is kept byte for byte.
    let own = diagrams::create_diagram(&t.vault, "Own", None, Some(XML)).unwrap();
    assert_eq!(text_of(&t, &own), XML);

    // A leftover picture with no source keeps its name from being reused.
    fs::write(t.vault.root().join("library/Orphan.drawio.svg"), SVG).unwrap();
    let orphan = diagrams::create_diagram(&t.vault, "Orphan", None, None).unwrap();
    assert_eq!(orphan, "library/Orphan-2.drawio");

    assert!(invalid(diagrams::create_diagram(&t.vault, "X", Some("nope"), None)).contains("nope"));
    for bad in ["  ", "A|B", "A[1]", "A\nB"] {
        let why = invalid(diagrams::create_diagram(&t.vault, bad, None, None));
        assert!(why.contains("title"), "{bad:?}: {why}");
    }
    assert!(
        invalid(diagrams::create_diagram(
            &t.vault,
            "X",
            None,
            Some("<html/>")
        ))
        .contains("not a diagram")
    );
    assert!(!exists(&t, "library/X.drawio"));
}

#[test]
fn names_keep_their_case_and_lose_what_a_file_name_cannot_hold() {
    let t = dev_vault();
    for (title, stem) in [
        ("OAuth flow", "OAuth-flow"),
        ("  Plan: v2 / final?  ", "Plan-v2-final"),
        ("Café menu", "Café-menu"),
        ("日本語 図", "日本語-図"),
        ("???", "untitled"),
        ("con", "con-1"),
    ] {
        let path = diagrams::create_diagram(&t.vault, title, None, None).unwrap();
        assert_eq!(path, format!("library/{stem}.drawio"), "{title}");
    }
    assert_eq!(
        diagrams::title_of("library/OAuth-flow.drawio"),
        "OAuth flow"
    );
    assert_eq!(
        diagrams::title_of("library/OAuth-flow.drawio.svg"),
        "OAuth flow"
    );
    assert_eq!(
        diagrams::title_of("projects/p/diagrams/Q3_map-2.drawio"),
        "Q3 map 2"
    );
}

#[test]
fn a_diagram_is_read_with_the_hash_a_save_must_bring_back() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", None, Some(XML)).unwrap();
    let read = diagrams::read_diagram(&t.vault, &path).unwrap();
    assert_eq!(read.path, path);
    assert_eq!(read.xml, XML);
    assert_eq!(read.hash, content_hash(XML));
    assert!(read.modified > 0);
    assert_eq!(read.preview, Preview::Missing);

    assert!(matches!(
        diagrams::read_diagram(&t.vault, "library/none.drawio"),
        Err(Error::NotFound(_))
    ));
    for bad in [
        "../x.drawio",
        "library/x.md",
        "/etc/x.drawio",
        ".kasten/x.drawio",
        "a\\b.drawio",
        "library/Login-flow.drawio.svg",
    ] {
        assert!(
            matches!(
                diagrams::read_diagram(&t.vault, bad),
                Err(Error::InvalidPath(_))
            ),
            "{bad}"
        );
    }
    // Bytes that are not text are an error, not a lossy reading.
    fs::write(
        t.vault.root().join("library/binary.drawio"),
        [0xff, 0xfe, 0x00],
    )
    .unwrap();
    assert!(diagrams::read_diagram(&t.vault, "library/binary.drawio").is_err());
}

#[test]
fn a_save_writes_the_source_and_the_picture_together() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    let blank = diagrams::blank_xml();
    let next = xml_with("One");
    let DiagramSaved::Written { diagram } = diagrams::write_diagram(
        &t.vault,
        &path,
        &next,
        Some(SVG),
        &content_hash(&blank),
        NOW,
    )
    .unwrap() else {
        panic!("expected a write");
    };
    assert_eq!(diagram.hash, content_hash(&next));
    assert_eq!(diagram.preview, Preview::Fresh);
    assert_eq!(text_of(&t, &path), next);
    let picture = text_of(&t, "library/Login-flow.drawio.svg");
    assert!(picture.starts_with(SVG));
    assert_eq!(
        diagrams::stamp_of(&picture),
        Some(content_hash(&next).as_str())
    );
    assert_eq!(
        diagrams::read_preview(&t.vault, &path).unwrap().as_deref(),
        Some(picture.as_str())
    );

    // The same text again writes nothing.
    let same = diagrams::write_diagram(&t.vault, &path, &next, None, &diagram.hash, NOW).unwrap();
    assert!(matches!(same, DiagramSaved::Unchanged { .. }), "{same:?}");
}

#[test]
fn a_save_that_cannot_be_kept_whole_leaves_both_files_as_they_were() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    let blank = diagrams::blank_xml();
    let hash = content_hash(&blank);
    let next = xml_with("One");

    // Neither a bad source nor a bad picture writes anything.
    for (xml, svg) in [
        ("<html/>", Some(SVG)),
        (next.as_str(), Some("<svg><g></svg>")),
        (next.as_str(), Some("<mxfile/>")),
    ] {
        assert!(diagrams::write_diagram(&t.vault, &path, xml, svg, &hash, NOW).is_err());
    }
    assert_eq!(text_of(&t, &path), blank);
    assert!(!exists(&t, "library/Login-flow.drawio.svg"));

    // The picture cannot be written: the source is put back too.
    fs::create_dir(t.vault.root().join("library/Login-flow.drawio.svg")).unwrap();
    assert!(diagrams::write_diagram(&t.vault, &path, &next, Some(SVG), &hash, NOW).is_err());
    assert_eq!(text_of(&t, &path), blank);
}

#[test]
fn a_picture_that_is_missing_or_drawn_from_older_source_is_known_to_be_out_of_date() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    let blank = diagrams::blank_xml();
    let one = xml_with("One");
    let two = xml_with("Two");
    let state = |t: &common::TempVault| diagrams::read_diagram(&t.vault, &path).unwrap().preview;
    assert_eq!(state(&t), Preview::Missing);

    diagrams::write_diagram(&t.vault, &path, &one, Some(SVG), &content_hash(&blank), NOW).unwrap();
    assert_eq!(state(&t), Preview::Fresh);

    // The source alone is saved (the picture comes a moment later): the old
    // picture stays, and is known to be old.
    diagrams::write_diagram(&t.vault, &path, &two, None, &content_hash(&one), NOW).unwrap();
    assert_eq!(state(&t), Preview::Stale);
    assert!(exists(&t, "library/Login-flow.drawio.svg"));

    // Another program edited the source while the app was closed.
    diagrams::write_diagram(&t.vault, &path, &two, Some(SVG), &content_hash(&two), NOW).unwrap();
    assert_eq!(state(&t), Preview::Fresh);
    fs::write(t.vault.root().join(&path), xml_with("Three")).unwrap();
    assert_eq!(state(&t), Preview::Stale);

    // A picture some other tool wrote has no stamp: it is drawn again.
    fs::write(t.vault.root().join("library/Login-flow.drawio.svg"), SVG).unwrap();
    assert_eq!(state(&t), Preview::Stale);
    fs::remove_file(t.vault.root().join("library/Login-flow.drawio.svg")).unwrap();
    assert_eq!(state(&t), Preview::Missing);
}

#[test]
fn a_save_from_an_older_read_goes_to_a_copy_beside_the_file() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", None, None).unwrap();
    let blank = diagrams::blank_xml();
    let base = content_hash(&blank);
    let theirs = xml_with("Theirs");
    // An agent or a sync tool changed the file after the editor read it.
    fs::write(t.vault.root().join(&path), &theirs).unwrap();

    let mine = xml_with("Mine");
    let DiagramSaved::Conflict { copy, diagram } =
        diagrams::write_diagram(&t.vault, &path, &mine, Some(SVG), &base, NOW).unwrap()
    else {
        panic!("expected a conflict");
    };
    assert_eq!(diagram.xml, theirs, "what is on disk stands");
    assert_eq!(text_of(&t, &path), theirs);
    assert_eq!(
        copy,
        format!("library/Login-flow (conflict {}).drawio", NOW.file_stamp())
    );
    assert_eq!(text_of(&t, &copy), mine);
    // The copy has its picture, so it is a diagram like any other.
    let copied = diagrams::read_diagram(&t.vault, &copy).unwrap();
    assert_eq!(copied.preview, Preview::Fresh);
    // A second conflict the same minute gets a free name.
    let DiagramSaved::Conflict { copy: other, .. } =
        diagrams::write_diagram(&t.vault, &path, &mine, None, &base, NOW).unwrap()
    else {
        panic!("expected a conflict");
    };
    assert_eq!(
        other,
        format!(
            "library/Login-flow (conflict {} 2).drawio",
            NOW.file_stamp()
        )
    );

    // The same text as what is there is no conflict, whatever the hash.
    let same = diagrams::write_diagram(&t.vault, &path, &theirs, None, &base, NOW).unwrap();
    assert!(matches!(same, DiagramSaved::Unchanged { .. }), "{same:?}");
}

#[test]
fn a_picture_is_kept_only_for_the_source_it_was_drawn_from() {
    let t = dev_vault();
    let path = diagrams::create_diagram(&t.vault, "Login flow", Some(PROJECT), Some(XML)).unwrap();
    let hash = content_hash(XML);
    let diagram = diagrams::write_preview(&t.vault, &path, SVG, &hash).unwrap();
    assert_eq!(diagram.preview, Preview::Fresh);
    assert_eq!(text_of(&t, &path), XML, "the source is not touched");

    // The source moved on while the picture was being drawn.
    let moved = xml_with("Moved");
    fs::write(t.vault.root().join(&path), &moved).unwrap();
    let why = invalid(diagrams::write_preview(&t.vault, &path, SVG, &hash));
    assert!(why.contains("changed"), "{why}");
    assert!(
        invalid(diagrams::write_preview(
            &t.vault,
            &path,
            "<svg><g></svg>",
            &content_hash(&moved)
        ))
        .contains("closing")
    );
    assert_eq!(
        diagrams::read_diagram(&t.vault, &path).unwrap().preview,
        Preview::Stale
    );
}

#[test]
fn diagrams_are_listed_by_title_with_their_project_pages_and_picture() {
    let (t, k) = open();
    assert!(k.diagrams().unwrap().is_empty());
    let a = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    let b = k
        .create_diagram(&Actor::Human, "annual map", Some(PROJECT), None, NOW)
        .unwrap();
    k.save_diagram(&Actor::Human, &a, XML, Some(SVG), &content_hash(XML), NOW)
        .unwrap();
    let two = "<mxfile><diagram name=\"a\"><mxGraphModel/></diagram><diagram name=\"b\"><mxGraphModel/></diagram></mxfile>";
    fs::write(t.vault.root().join("library/Two-pages.drawio"), two).unwrap();
    fs::write(
        t.vault.root().join("library/broken.drawio"),
        "<mxfile><diagram>",
    )
    .unwrap();

    let list = k.diagrams().unwrap();
    let names: Vec<_> = list
        .iter()
        .map(|d| (d.path.as_str(), d.title.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            (b.as_str(), "annual map"),
            ("library/broken.drawio", "broken"),
            (a.as_str(), "Login flow"),
            ("library/Two-pages.drawio", "Two pages"),
        ],
        "by title, ignoring case; a file that cannot be read is named by its file"
    );
    assert_eq!(
        (list[0].pages, list[0].project.as_deref(), list[0].preview),
        (1, Some(PROJECT), Preview::Missing)
    );
    assert_eq!(
        (list[2].pages, list[2].project.as_deref(), list[2].preview),
        (1, None, Preview::Fresh)
    );
    assert_eq!(list[3].pages, 2);
    assert!(list[0].problem.is_none() && list[0].size > 0 && list[0].modified > 0);
    assert!(
        list[1].problem.as_deref().unwrap().contains("never closed"),
        "{:?}",
        list[1].problem
    );

    assert_eq!(k.resolve_diagram("login FLOW").unwrap(), a);
    assert_eq!(k.resolve_diagram(&b).unwrap(), b);
    assert!(k.resolve_diagram("nothing").is_err());
    assert_eq!(k.diagram(&a).unwrap().xml, XML);
    assert!(k.diagram_preview(&a).unwrap().unwrap().starts_with(SVG));
    assert_eq!(k.diagram_preview(&b).unwrap(), None);
}

#[test]
fn a_person_saves_in_batches_and_an_agent_commits_at_once() {
    let (_t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", None, None, NOW)
        .unwrap();
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "diagram: create Login flow"
    );

    let commits = k.log(None, 500).unwrap().len();
    let base = content_hash(&diagrams::blank_xml());
    let v1 = xml_with("One");
    let saved = k
        .save_diagram(&Actor::Human, &path, &v1, Some(SVG), &base, NOW)
        .unwrap();
    let DiagramSaved::Written { diagram } = saved else {
        panic!("expected a write");
    };
    // Written at once, committed after a pause, like typing: both files.
    assert_eq!(k.diagram(&path).unwrap(), diagram);
    assert_eq!(
        k.pending_edits(),
        [path.as_str(), "library/Login-flow.drawio.svg"]
    );
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    k.commit_edits().unwrap();
    assert!(!k.log(None, 1).unwrap()[0].agent);
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "edit: Login flow",
        "one title for both files"
    );

    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "01SESSION".into(),
    };
    let v2 = xml_with("Two");
    k.save_diagram(&agent, &path, &v2, None, &diagram.hash, NOW)
        .unwrap();
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.summary, "diagram: edit Login flow");
    assert!(last.agent);
    assert!(k.pending_edits().is_empty());

    // A picture drawn again for the same source is a save of its own.
    let hash = content_hash(&v2);
    k.save_diagram_preview(&Actor::Human, &path, SVG, &hash, NOW)
        .unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);
    assert_eq!(k.pending_edits(), ["library/Login-flow.drawio.svg"]);
}

#[test]
fn renaming_takes_both_files_along_and_keeps_every_embed_and_card_pointing_at_them() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &path,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    fs::write(
        t.vault.root().join("library/embeds.md"),
        "# Embeds\n\n![[Login-flow.drawio]]\n\nSee [[library/Login-flow.drawio|the flow]] and [[Login-flow.drawio#x]].\n\nNot [[Login flow.md]] nor `[[Login-flow.drawio]]` in code.\n",
    )
    .unwrap();
    let board = k.create_board(&Actor::Human, "Map", None, NOW).unwrap();
    k.add_to_board(
        &Actor::Human,
        &board,
        std::slice::from_ref(&path),
        Layout::Grid,
        NOW,
    )
    .unwrap();

    let moved = k
        .rename_diagram(&Actor::Human, &path, "Sign in", NOW)
        .unwrap();
    assert_eq!(moved.path, "library/Sign-in.drawio");
    assert_eq!(
        moved.moves,
        [
            (
                "library/Login-flow.drawio".to_owned(),
                "library/Sign-in.drawio".to_owned()
            ),
            (
                "library/Login-flow.drawio.svg".to_owned(),
                "library/Sign-in.drawio.svg".to_owned()
            ),
        ]
    );
    assert!(!exists(&t, &path) && !exists(&t, "library/Login-flow.drawio.svg"));
    assert_eq!(k.diagram(&moved.path).unwrap().preview, Preview::Fresh);
    assert_eq!(
        text_of(&t, "library/embeds.md"),
        "# Embeds\n\n![[Sign-in.drawio]]\n\nSee [[library/Sign-in.drawio|the flow]] and [[Sign-in.drawio#x]].\n\nNot [[Login flow.md]] nor `[[Login-flow.drawio]]` in code.\n"
    );
    let card = k
        .board(&board)
        .unwrap()
        .nodes
        .into_iter()
        .find_map(|n| n.file)
        .unwrap();
    assert_eq!(card, "library/Sign-in.drawio");
    assert!(moved.relinked.contains(&"library/embeds.md".to_owned()));
    assert!(moved.relinked.contains(&board));
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "rename: Login flow → Sign in"
    );

    // The same title is no change; a title with no usable text is refused.
    let same = k
        .rename_diagram(&Actor::Human, &moved.path, "Sign in", NOW)
        .unwrap();
    assert_eq!(
        (same.path.as_str(), same.moves.len()),
        (moved.path.as_str(), 0)
    );
    assert!(invalid(k.rename_diagram(&Actor::Human, &moved.path, "A|B", NOW)).contains("title"));
    assert!(invalid(k.rename_diagram(&Actor::Human, &moved.path, "  ", NOW)).contains("title"));

    // A name in use gets the next free one, for both files.
    k.create_diagram(&Actor::Human, "Other", None, None, NOW)
        .unwrap();
    let taken = k
        .rename_diagram(&Actor::Human, "library/Other.drawio", "Sign in", NOW)
        .unwrap();
    assert_eq!(taken.path, "library/Sign-in-2.drawio");
}

#[test]
fn a_bare_file_name_that_two_diagrams_share_is_left_for_the_person_to_settle() {
    let (t, k) = open();
    let a = k
        .create_diagram(&Actor::Human, "Map", None, None, NOW)
        .unwrap();
    k.create_diagram(&Actor::Human, "Map", Some(PROJECT), None, NOW)
        .unwrap();
    fs::write(
        t.vault.root().join("library/embeds.md"),
        "![[Map.drawio]]\n",
    )
    .unwrap();
    // Both are called Map.drawio: the link that said which one does not now.
    let moved = k.rename_diagram(&Actor::Human, &a, "Chart", NOW).unwrap();
    assert_eq!(moved.path, "library/Chart.drawio");
    assert_eq!(
        text_of(&t, "library/embeds.md"),
        "![[Map.drawio]]\n",
        "a bare name is not claimed by either"
    );
}

#[test]
fn moving_takes_both_files_to_a_project_or_back_to_the_library() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &path,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    let there = "projects/photo-organiser/diagrams/Login-flow.drawio";

    let moved = k
        .move_diagram(&Actor::Human, &path, Some(PROJECT), NOW)
        .unwrap();
    assert_eq!(moved.path, there);
    assert!(exists(&t, there) && exists(&t, &format!("{there}.svg")));
    assert!(!exists(&t, &path) && !exists(&t, "library/Login-flow.drawio.svg"));
    assert_eq!(k.diagram(there).unwrap().preview, Preview::Fresh);
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "move: Login flow to photo-organiser"
    );

    let nowhere = k
        .move_diagram(&Actor::Human, there, Some(PROJECT), NOW)
        .unwrap();
    assert!(nowhere.moves.is_empty());
    let back = k.move_diagram(&Actor::Human, there, None, NOW).unwrap();
    assert_eq!(back.path, path);
    assert!(invalid(k.move_diagram(&Actor::Human, &path, Some("nope"), NOW)).contains("nope"));
    assert!(exists(&t, &path));
}

#[test]
fn a_copy_has_its_own_files_and_a_picture_that_is_still_true() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &path,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    let copy = k.duplicate_diagram(&Actor::Human, &path, NOW).unwrap();
    assert_eq!(copy, "library/Login-flow-copy.drawio");
    assert_eq!(text_of(&t, &copy), XML);
    assert_eq!(k.diagram(&copy).unwrap().preview, Preview::Fresh);
    assert!(exists(&t, &path) && exists(&t, "library/Login-flow.drawio.svg"));
    assert_eq!(
        k.duplicate_diagram(&Actor::Human, &path, NOW).unwrap(),
        "library/Login-flow-copy-2.drawio"
    );
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "duplicate: Login flow");
}

#[test]
fn a_trashed_diagram_goes_with_its_picture_and_comes_back_as_a_commit() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", Some(PROJECT), Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &path,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    let picture = format!("{path}.svg");

    let trashed = k.trash(&Actor::Human, &path, NOW).unwrap();
    assert!(!exists(&t, &path) && !exists(&t, &picture));
    assert!(k.diagrams().unwrap().is_empty());
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "trash: Login flow");
    assert!(
        exists(&t, &trashed) && exists(&t, &format!("{trashed}.svg")),
        "both are in the one trash folder"
    );

    let listed = k.list_trash().unwrap();
    let items: Vec<_> = listed
        .iter()
        .filter(|x| x.original.contains(".drawio"))
        .collect();
    assert_eq!(
        items.len(),
        1,
        "the picture is not a thing of its own: {items:?}"
    );
    assert_eq!(
        (
            items[0].title.as_str(),
            items[0].original.as_str(),
            items[0].trashed.as_str()
        ),
        ("Login flow", path.as_str(), trashed.as_str())
    );
    assert_eq!(k.read_trashed(&trashed).unwrap(), XML);

    // Something else took its place meanwhile: both come back beside it.
    fs::write(t.vault.root().join(&path), xml_with("Other")).unwrap();
    let back = k.restore_diagram(&Actor::Human, &trashed).unwrap();
    assert_eq!(
        back,
        "projects/photo-organiser/diagrams/Login-flow-2.drawio"
    );
    assert_eq!(text_of(&t, &back), XML);
    assert_eq!(k.diagram(&back).unwrap().preview, Preview::Fresh);
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "restore: Login flow");
    assert!(
        k.restore_diagram(&Actor::Human, &trashed).is_err(),
        "only once"
    );
    assert!(
        k.list_trash()
            .unwrap()
            .iter()
            .all(|x| !x.original.contains(".drawio"))
    );
}

#[test]
fn a_diagram_with_no_picture_is_trashed_and_restored_alone() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Plain", None, None, NOW)
        .unwrap();
    let trashed = k.trash(&Actor::Human, &path, NOW).unwrap();
    assert!(!exists(&t, &format!("{trashed}.svg")));
    assert_eq!(k.restore_diagram(&Actor::Human, &trashed).unwrap(), path);
    assert!(!exists(&t, "library/Plain.drawio.svg"));
}

#[test]
fn import_makes_a_diagram_from_the_files_other_tools_write() {
    let (t, k) = open();
    // A plain source, as `.drawio` or `.xml`.
    let a = k
        .import_diagram(
            &Actor::Human,
            "Flow chart.drawio",
            XML.as_bytes(),
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(a, "library/Flow-chart.drawio");
    assert_eq!(text_of(&t, &a), XML);
    let b = k
        .import_diagram(
            &Actor::Human,
            "export.xml",
            XML.as_bytes(),
            Some(PROJECT),
            NOW,
        )
        .unwrap();
    assert_eq!(b, "projects/photo-organiser/diagrams/export.drawio");
    // Again: a free name, never a replacement.
    let c = k
        .import_diagram(
            &Actor::Human,
            "Flow chart.drawio",
            XML.as_bytes(),
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(c, "library/Flow-chart-2.drawio");
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "diagram: import Flow chart 2"
    );

    // A picture the editor exported with the diagram in it: the source comes
    // out, and the picture stays as the picture.
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"81px\" height=\"41px\" content=\"{}\"><defs/><g/></svg>",
        escape(XML)
    );
    let d = k
        .import_diagram(
            &Actor::Human,
            "sketch.drawio.svg",
            svg.as_bytes(),
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(d, "library/sketch.drawio");
    assert_eq!(text_of(&t, &d), XML);
    let read = k.diagram(&d).unwrap();
    assert_eq!(read.preview, Preview::Fresh);
    assert!(
        k.diagram_preview(&d)
            .unwrap()
            .unwrap()
            .contains("width=\"81px\"")
    );

    // A picture the editor exported as PNG keeps the diagram in a text chunk.
    let png = png_with(&[("Software", "x"), ("mxfile", &percent(XML))]);
    let e = k
        .import_diagram(&Actor::Human, "shot.drawio.png", &png, None, NOW)
        .unwrap();
    assert_eq!(e, "library/shot.drawio");
    assert_eq!(text_of(&t, &e), XML);
    let e2 = k
        .import_diagram(&Actor::Human, "shot2.png", &png, None, NOW)
        .unwrap();
    assert_eq!(e2, "library/shot2.drawio");
}

#[test]
fn import_says_why_a_file_is_not_taken() {
    let (t, k) = open();
    let before = k.diagrams().unwrap().len();
    let svg_without = "<svg xmlns=\"http://www.w3.org/2000/svg\"><g/></svg>";
    let png_without = png_with(&[("Software", "x")]);
    let cases: [(&str, &[u8], &str); 7] = [
        ("x.drawio", b"<html/>", "not a diagram"),
        ("x.xml", b"<?xml version=\"1.0\"?><feed/>", "not a diagram"),
        ("x.drawio", &[0xff, 0xfe], "text"),
        ("x.svg", svg_without.as_bytes(), "no diagram"),
        ("x.png", &png_without, "no diagram"),
        ("x.vsdx", b"PK", "editor"),
        ("x.drawio", b"", "root"),
    ];
    for (name, bytes, why) in cases {
        let message = invalid(k.import_diagram(&Actor::Human, name, bytes, None, NOW));
        assert!(message.contains(why), "{name}: {message}");
    }
    assert!(
        invalid(k.import_diagram(&Actor::Human, "x.drawio", XML.as_bytes(), Some("nope"), NOW))
            .contains("nope")
    );
    assert_eq!(k.diagrams().unwrap().len(), before);
    let big = vec![b'x'; diagrams::MAX_BYTES + 1];
    assert!(
        invalid(k.import_diagram(&Actor::Human, "x.drawio", &big, None, NOW)).contains("too large")
    );
    assert!(!exists(&t, "library/x.drawio"));
}

#[test]
fn verify_finds_unreadable_diagrams_pictures_that_are_not_pictures_and_embeds_of_nothing() {
    let (t, k) = open();
    let good = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &good,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    // A picture drawn from older source is only out of date, not a problem.
    fs::write(t.vault.root().join(&good), xml_with("Newer")).unwrap();
    fs::write(t.vault.root().join("library/broken.drawio"), "{ nope").unwrap();
    fs::write(t.vault.root().join("library/odd.drawio"), XML).unwrap();
    fs::write(t.vault.root().join("library/odd.drawio.svg"), "<mxfile/>").unwrap();
    fs::write(
        t.vault.root().join("library/embeds.md"),
        "![[Login-flow.drawio]]\n\n![[gone.drawio]]\n",
    )
    .unwrap();

    let report = k.verify().unwrap();
    assert_eq!(report.diagrams, 3);
    let found: Vec<_> = report
        .problems
        .iter()
        .filter(|p| p.kind.starts_with("diagram") || p.detail.contains("drawio"))
        .map(|p| (p.kind.as_str(), p.path.as_deref().unwrap_or("")))
        .collect();
    assert!(
        found.contains(&("diagram", "library/broken.drawio")),
        "{found:?}"
    );
    assert!(
        found.contains(&("diagram-picture", "library/odd.drawio.svg")),
        "{found:?}"
    );
    assert!(
        found.contains(&("unresolved-link", "library/embeds.md")),
        "{found:?}"
    );
    assert_eq!(found.len(), 3, "{found:?}");
    let link = report
        .problems
        .iter()
        .find(|p| p.kind == "unresolved-link" && p.detail.contains("drawio"))
        .unwrap();
    assert!(link.detail.contains("gone.drawio"), "{}", link.detail);
}

#[test]
fn undoing_the_commit_of_a_save_takes_the_picture_it_made_back_too() {
    let (t, k) = open();
    let path = k
        .create_diagram(&Actor::Human, "Login flow", None, Some(XML), NOW)
        .unwrap();
    k.save_diagram(
        &Actor::Human,
        &path,
        XML,
        Some(SVG),
        &content_hash(XML),
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    let log = k.log(None, 1).unwrap();
    let undone = k.undo_commit(&log[0].id, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{undone:?}");
    assert!(
        !exists(&t, "library/Login-flow.drawio.svg"),
        "the picture went with the commit"
    );
    assert!(exists(&t, &path));
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\n', "&#xa;")
}

fn percent(text: &str) -> String {
    text.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// A PNG that is only chunks: the signature, `tEXt` chunks and the end.
/// Checksums are left zero; only the text is read.
fn png_with(texts: &[(&str, &str)]) -> Vec<u8> {
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8; 4], data: &[u8]| {
        out.extend((data.len() as u32).to_be_bytes());
        out.extend(kind);
        out.extend(data);
        out.extend([0u8; 4]);
    };
    chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    for (key, value) in texts {
        let mut data = key.as_bytes().to_vec();
        data.push(0);
        data.extend(value.as_bytes());
        chunk(b"tEXt", &data);
    }
    chunk(b"IEND", &[]);
    out
}
