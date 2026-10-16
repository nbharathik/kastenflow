use std::path::Path;

use super::*;

fn parse(words: &[&str]) -> Args {
    Args::parse(words.iter().map(|w| (*w).to_owned())).unwrap_or_else(|e| panic!("{e}"))
}

fn usage(result: Result<impl std::fmt::Debug, Failure>) -> String {
    match result {
        Err(Failure::Usage(message)) => message,
        other => panic!("expected a usage error, got {other:?}"),
    }
}

impl std::fmt::Debug for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Failure::Usage(m) => write!(f, "usage: {m}"),
            Failure::Error(m) => write!(f, "error: {m}"),
        }
    }
}

#[test]
fn the_deck_and_the_output_are_found_in_either_order() {
    let (deck, out) = paths(&parse(&["render", "talk.deck", "-o", "out.png"]), "render")
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(
        (deck, out),
        (PathBuf::from("talk.deck"), Some(PathBuf::from("out.png")))
    );
    let (deck, out) = paths(&parse(&["render", "-o", "out.png", "talk.deck"]), "render")
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(
        (deck, out),
        (PathBuf::from("talk.deck"), Some(PathBuf::from("out.png")))
    );
    let (_, out) = paths(
        &parse(&["render", "talk.deck", "--output", "x.png"]),
        "render",
    )
    .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(out, Some(PathBuf::from("x.png")));
    let (_, out) =
        paths(&parse(&["render", "talk.deck"]), "render").unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(out, None);
}

#[test]
fn a_missing_deck_output_or_a_second_deck_is_a_usage_error_that_names_the_command() {
    assert_eq!(
        usage(paths(&parse(&["render"]), "render")),
        "missing the deck to render"
    );
    assert_eq!(
        usage(paths(&parse(&["export", "-o", "x.pdf"]), "export")),
        "missing the deck to export"
    );
    assert_eq!(
        usage(paths(&parse(&["render", "a.deck", "b.deck"]), "render")),
        "render takes one deck"
    );
    assert_eq!(
        usage(paths(&parse(&["render", "a.deck", "-o"]), "render")),
        "-o needs a file name"
    );
}

#[test]
fn numbers_must_be_whole_and_in_range() {
    let args = parse(&["render", "d", "--slide", "3", "--step", "0"]);
    assert_eq!(
        number(&args, "slide", 1, "x").unwrap_or_else(|e| panic!("{e:?}")),
        Some(3)
    );
    assert_eq!(
        number(&args, "step", 0, "x").unwrap_or_else(|e| panic!("{e:?}")),
        Some(0)
    );
    assert_eq!(
        number(&args, "columns", 1, "x").unwrap_or_else(|e| panic!("{e:?}")),
        None
    );
    for bad in ["0", "-1", "two", "1.5", ""] {
        let args = parse(&["render", "d", &format!("--slide={bad}")]);
        let message = match number(&args, "slide", 1, "the slide's number, counted from 1") {
            Err(Failure::Usage(m)) => m,
            other => {
                assert!(
                    bad.is_empty() && matches!(other, Ok(None)),
                    "{bad}: {other:?}"
                );
                continue;
            }
        };
        assert!(
            message.contains("--slide is the slide's number") && message.contains(bad),
            "{message}"
        );
    }
}

#[test]
fn a_scale_is_between_a_quarter_and_four() {
    assert!(
        (scale(&parse(&["r", "d"]), 2.0).unwrap_or_else(|e| panic!("{e:?}")) - 2.0).abs()
            < f32::EPSILON
    );
    for good in ["0.25", "1", "2", "4", "1.5"] {
        assert!(
            scale(&parse(&["r", "d", "--scale", good]), 1.0).is_ok(),
            "{good}"
        );
    }
    for bad in ["0", "0.1", "5", "big", "NaN", "-2"] {
        let message = usage(scale(&parse(&["r", "d", &format!("--scale={bad}")]), 1.0));
        assert!(
            message.contains("--scale") && message.contains("0.25 to 4"),
            "{message}"
        );
    }
}

#[test]
fn steps_are_final_or_each_and_expand_means_each() {
    assert_eq!(
        steps(&parse(&["e", "d"])).unwrap_or_else(|e| panic!("{e:?}")),
        Steps::Final
    );
    assert_eq!(
        steps(&parse(&["e", "d", "--steps", "final"])).unwrap_or_else(|e| panic!("{e:?}")),
        Steps::Final
    );
    assert_eq!(
        steps(&parse(&["e", "d", "--steps", "each"])).unwrap_or_else(|e| panic!("{e:?}")),
        Steps::Each
    );
    assert_eq!(
        steps(&parse(&["e", "d", "--steps", "expand"])).unwrap_or_else(|e| panic!("{e:?}")),
        Steps::Each
    );
    let message = usage(steps(&parse(&["e", "d", "--steps", "some"])));
    assert!(
        message.contains("`final`") && message.contains("`each`") && message.contains("some"),
        "{message}"
    );
}

#[test]
fn the_format_comes_from_the_flag_then_the_extension() {
    let of = |words: &[&str], out: Option<&str>| Format::of(&parse(words), out.map(Path::new));
    assert_eq!(
        of(&["export", "d"], Some("x.pdf")).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Pdf)
    );
    assert_eq!(
        of(&["export", "d"], Some("X.PNG")).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Png)
    );
    assert_eq!(
        of(&["export", "d"], Some("x.html")).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Html)
    );
    assert_eq!(
        of(&["export", "d"], Some("x.htm")).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Html)
    );
    assert_eq!(
        of(&["export", "d"], Some("x.pptx")).unwrap_or_else(|e| panic!("{e:?}")),
        None
    );
    assert_eq!(
        of(&["export", "d"], None).unwrap_or_else(|e| panic!("{e:?}")),
        None
    );
    assert_eq!(
        of(&["export", "d", "--format", "pdf"], None).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Pdf)
    );
    assert_eq!(
        of(&["export", "d", "--format", "PDF"], Some("x.pptx")).unwrap_or_else(|e| panic!("{e:?}")),
        Some(Format::Pdf),
        "the flag wins"
    );
    let message = usage(of(&["export", "d"], Some("x.docx")));
    assert!(
        message.contains("docx") && message.contains("pptx, pdf, png and html"),
        "{message}"
    );
}

#[test]
fn several_pictures_get_numbered_files_beside_the_output_and_one_gets_its_name() {
    assert_eq!(
        picture_paths(Path::new("out/talk.png"), &["slide-01.png"]),
        [PathBuf::from("out/talk.png")]
    );
    assert_eq!(
        picture_paths(
            Path::new("out/talk.png"),
            &["slide-01.png", "slide-02-step-1.png", "slide-02-step-2.png"]
        ),
        [
            PathBuf::from("out/talk-01.png"),
            PathBuf::from("out/talk-02-step-1.png"),
            PathBuf::from("out/talk-02-step-2.png")
        ]
    );
}

#[test]
fn the_assets_folder_is_the_decks_own_unless_another_is_named() {
    let here =
        assets_dir(&parse(&["r", "d"]), Path::new("talk.deck")).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(here, Path::new(".").canonicalize().unwrap_or_default());
    // Another folder, one that is there on every system (Windows has no /tmp).
    let other = std::env::temp_dir();
    let other = other.to_str().unwrap_or_default();
    let named = assets_dir(
        &parse(&["r", "d", "--assets", other]),
        Path::new("talk.deck"),
    )
    .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(named, Path::new(other).canonicalize().unwrap_or_default());
    let message = match assets_dir(
        &parse(&["r", "d", "--assets", "/no/such/folder"]),
        Path::new("talk.deck"),
    ) {
        Err(Failure::Error(m)) => m,
        other => panic!("{other:?}"),
    };
    assert!(
        message.contains("cannot read the assets folder /no/such/folder"),
        "{message}"
    );
}

#[test]
fn a_decks_bibliography_is_in_its_own_folder_and_a_bare_file_name_is_this_one() {
    assert_eq!(deck_folder(Path::new("talk.deck")), PathBuf::from("."));
    assert_eq!(
        deck_folder(Path::new("a/b/talk.deck")),
        PathBuf::from("a/b")
    );
    assert_eq!(deck_folder(Path::new("/talk.deck")), PathBuf::from("/"));
}

#[test]
fn a_deck_is_drawn_with_the_bib_files_beside_it_and_with_none_when_there_are_none() {
    let dir = std::env::temp_dir().join(format!("slides-cli-drawn-{}-bib", std::process::id()));
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    let deck = dir.join("talk.deck");
    let args = parse(&["render", deck.to_str().unwrap_or_default()]);
    let bare = options(&args, &deck).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(bare.references, None, "no bibliography, so keys are drawn");
    fs::write(dir.join("refs.bib"), "@book{key, title={T}, year={2000}}")
        .unwrap_or_else(|e| panic!("{e}"));
    let with = options(&args, &deck).unwrap_or_else(|e| panic!("{e:?}"));
    assert!(
        with.references
            .is_some_and(|text| text.contains("@book{key")),
        "the folder's .bib text goes to the page"
    );
    // The pictures may be somewhere else; the bibliography is still the deck's own.
    let other = std::env::temp_dir();
    let elsewhere = parse(&[
        "render",
        "d",
        "--assets",
        other.to_str().unwrap_or_default(),
    ]);
    let far = options(&elsewhere, &deck).unwrap_or_else(|e| panic!("{e:?}"));
    assert!(far.references.is_some());
}

#[test]
fn text_that_could_not_be_measured_is_excused_in_the_words_of_why() {
    use slides_render::Error;
    let none = not_measured(&Error::NoBrowser { notes: Vec::new() });
    assert!(
        none.starts_with(
            "Text sizes were estimated, not measured: Drawing slides needs Chrome or Chromium, and none was found."
        ) && none.ends_with("Install Chrome or Chromium (or set CHROMIUM_PATH) to measure them."),
        "{none}"
    );
    // A browser that is there and would not start says why and what to do, and is not told to install one.
    let refused = not_measured(&Error::Launch(
        "it will not run its sandbox as the administrator (root). Run as an ordinary user, or set SLIDES_RENDER_NO_SANDBOX=1."
            .to_owned(),
    ));
    assert!(
        refused.starts_with("Text sizes were estimated, not measured: The browser could not be started: it will not run its sandbox")
            && refused.contains("as the administrator (root). Run as an ordinary user")
            && refused.ends_with("SLIDES_RENDER_NO_SANDBOX=1."),
        "the whole sentence, with the setting: {refused}"
    );
    assert!(!refused.contains("Install Chrome"), "{refused}");
}

#[test]
fn the_bibliography_a_page_writes_citations_from_is_the_one_lint_checks_them_against() {
    // Two helpers read the `.bib` files of a folder (this crate's for lint and the render host's for the page); a
    // citation would be drawn from one bibliography and called unknown by the other if they ever read different files.
    let dir = std::env::temp_dir().join(format!("slides-cli-drawn-{}-same", std::process::id()));
    fs::create_dir_all(dir.join("folder.bib")).unwrap_or_else(|e| panic!("{e}"));
    for (name, text) in [
        ("b.bib", "@misc{b}"),
        ("a.BIB", "@misc{a}"),
        ("notes.txt", "@misc{no}"),
        ("talk.deck", "{}"),
    ] {
        fs::write(dir.join(name), text).unwrap_or_else(|e| panic!("{e}"));
    }
    for n in 0..10 {
        fs::write(dir.join(format!("more{n}.bib")), format!("@misc{{m{n}}}"))
            .unwrap_or_else(|e| panic!("{e}"));
    }
    assert_eq!(
        crate::refs::text_in(&dir),
        slides_render::references::in_folder(&dir)
    );
    assert!(crate::refs::text_in(&dir).is_some());
    let empty = dir.join("empty");
    fs::create_dir_all(&empty).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        crate::refs::text_in(&empty),
        slides_render::references::in_folder(&empty)
    );
}

#[test]
fn estimated_text_sizes_are_of_the_works_the_bibliography_beside_the_deck_writes_out() {
    use slides_core::lint::Refs;
    use slides_core::{Engine, canonical};
    const BIB: &str = "@inproceedings{vaswani2017attention, title={Attention is all you need}, author={Vaswani, Ashish and Shazeer, Noam}, booktitle={Advances in Neural Information Processing Systems}, year={2017}}";
    let minimal = include_str!("../../../../fixtures/decks/minimal.deck");
    let mut engine = Engine::new(
        canonical::parse(minimal).unwrap_or_else(|e| panic!("{e}")),
        5,
    );
    let slide = engine
        .apply("add_slide", serde_json::json!({ "layout": "blank" }))
        .unwrap_or_else(|e| panic!("{e}"))
        .output["slide"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let cite = serde_json::json!({ "type": "citation", "id": "cite", "x": 64, "y": 400, "w": 800, "h": 32, "keys": ["vaswani2017attention"] });
    engine
        .apply(
            "add_elements",
            serde_json::json!({ "slide": slide, "elements": [cite] }),
        )
        .unwrap_or_else(|e| panic!("{e}"));
    let deck = engine.deck().clone();

    let dir =
        std::env::temp_dir().join(format!("slides-cli-drawn-{}-estimate", std::process::id()));
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    let path = dir.join("talk.deck");
    let args = parse(&["lint", path.to_str().unwrap_or_default(), "--estimate"]);

    let bare = measured(&args, &path, &deck);
    assert_eq!(bare.with, "estimate");
    assert_eq!(
        bare.measures,
        estimate::measures(&deck),
        "no .bib: the keys"
    );
    fs::write(dir.join("refs.bib"), BIB).unwrap_or_else(|e| panic!("{e}"));
    let known = measured(&args, &path, &deck);
    assert_eq!(known.with, "estimate");
    assert_eq!(
        known.measures,
        estimate::measures_with(&deck, Some(&Refs::from_bibtex(BIB)))
    );
    assert_ne!(
        known.measures, bare.measures,
        "the work as it is written is not the key"
    );
}
