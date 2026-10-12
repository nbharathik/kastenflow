//! A deck imported from a file comes in with its pictures as one commit,
//! checked as far as it can be before the first picture is written, and
//! refused whole when a limit is met on the way.

use crate::common::NOW;
use crate::deck_pictures::{add, kept, limits, open, picture};
use crate::deck_support::{SIX, deck};

use kasten_core::agent::{AgentOp, DeckImport, Session};
use kasten_core::assets::NewAsset;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};

/// The pictures of a kickoff deck, by the names they should be kept under.
fn pictures() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("slide-1.png", picture(1, 100)),
        ("slide-2.png", picture(2, 100)),
        ("figure.png", picture(3, 100)),
    ]
}

/// Runs the import of `pictures` as a deck called `title`.
fn import(
    k: &Kasten,
    s: &Session,
    title: &str,
    project: Option<&str>,
    pictures: &[(&str, Vec<u8>)],
    at: Instant,
) -> kasten_core::Result<kasten_core::agent::ImportedDeck> {
    let refs: Vec<(&str, &[u8])> = pictures.iter().map(|(n, b)| (*n, b.as_slice())).collect();
    let request = DeckImport {
        title,
        project,
        tool: "import_pptx",
        pictures: &refs,
        sent: 60,
    };
    k.agent_import_deck(s, &request, |_| deck(title, &SIX[..2]), at)
}

#[test]
fn an_imported_deck_and_its_pictures_are_one_commit() {
    let (_t, k, s) = open();
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let mut told = Vec::new();
    let refs = pictures();
    let refs: Vec<(&str, &[u8])> = refs.iter().map(|(n, b)| (*n, b.as_slice())).collect();
    let request = DeckImport {
        title: "Kickoff",
        project: None,
        tool: "import_pptx",
        pictures: &refs,
        sent: 60,
    };
    let done = k
        .agent_import_deck(
            &s,
            &request,
            |paths| {
                told.push(paths.to_vec());
                deck("Kickoff", &SIX[..2])
            },
            NOW,
        )
        .unwrap();
    assert_eq!(
        done.pictures,
        [
            "assets/slide-1.png",
            "assets/slide-2.png",
            "assets/figure.png"
        ]
    );
    assert!(done.path.ends_with("kickoff.deck"), "{}", done.path);
    assert_eq!(k.deck(&done.path).unwrap().text, deck("Kickoff", &SIX[..2]));
    // The deck is told where each picture was kept: once to check it, once to write it.
    assert_eq!(told.last().unwrap(), &done.pictures);

    let log = k.log(None, 3).unwrap();
    assert_eq!(
        log[1].id, head,
        "the import is one commit on top of what was there"
    );
    let last = &log[0];
    assert!(last.agent && last.session.as_deref() == Some(s.id.as_str()));
    assert_eq!(last.op.as_deref(), Some("import_pptx"));
    assert_eq!(last.summary, "deck: import Kickoff");
    let mut files: Vec<String> = k
        .commit_changes(&last.id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    files.sort();
    assert_eq!(files.len(), 7, "{files:?}");
    assert!(files.contains(&done.path));
    for name in ["slide-1.png", "slide-2.png", "figure.png"] {
        assert!(files.contains(&format!("assets/{name}")), "{files:?}");
        assert!(
            files.contains(&format!("assets/.meta/{name}.json")),
            "{files:?}"
        );
    }
    // Whose they are, and where they came from.
    let asset = k
        .assets()
        .unwrap()
        .into_iter()
        .find(|a| a.path == "assets/figure.png")
        .unwrap();
    assert_eq!(asset.source.as_deref(), Some("pptx-import"));
    assert_eq!(asset.created_by, Some(format!("agent:{}", s.id)));

    // The session is undone in one step.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!((undone.reverted.len(), undone.conflict), (1, None));
    assert!(k.deck(&done.path).is_err());
    assert!(!kept(k.root()).iter().any(|p| p.contains("slide-1")));
}

#[test]
fn an_import_over_a_limit_is_refused_whole_with_nothing_left_behind() {
    let (t, k, s) = open();
    let before = kept(t.vault.root());
    let decks = k.decks().unwrap().len();

    // Three new pictures are more than the count allows: the third is where it stops.
    limits(&k, 1 << 20, 2, 50 << 20);
    let err = import(&k, &s, "Kickoff", None, &pictures(), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("would have added 3 pictures") && err.contains("the limit is 2"),
        "{err}"
    );
    // Nor do the bytes.
    limits(&k, 1 << 20, 30, 250);
    let err = import(&k, &s, "Kickoff", None, &pictures(), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("the limit is 250 bytes"), "{err}");
    // Nor does one that is too big by itself.
    limits(&k, 150, 30, 50 << 20);
    let mut big = pictures();
    big[2].1 = picture(9, 151);
    let err = import(&k, &s, "Kickoff", None, &big, NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("“figure.png” is 151 bytes"), "{err}");

    assert_eq!(
        kept(t.vault.root()),
        before,
        "no picture, no note about one"
    );
    assert_eq!(k.decks().unwrap().len(), decks, "no deck");
    assert!(
        k.log(None, 5).unwrap().iter().all(|c| !c.agent),
        "no commit of the agent's"
    );
}

#[test]
fn what_can_refuse_the_deck_is_found_before_the_first_picture_is_written() {
    let (t, k, s) = open();
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let before = kept(t.vault.root());
    // A title with brackets, as `Q3 [draft].pptx` makes; a project that is not there.
    for (title, project) in [
        ("Q3 [draft]", None),
        ("  ", None),
        ("Kickoff", Some("projects/none")),
    ] {
        let err = import(&k, &s, title, project, &pictures(), NOW).unwrap_err();
        assert!(
            matches!(
                err,
                kasten_core::Error::Invalid(_) | kasten_core::Error::NotFound(_)
            ),
            "{title:?}: {err}"
        );
        assert_eq!(
            kept(t.vault.root()),
            before,
            "{title:?}: no picture was written"
        );
        assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    }
    // A deck that is not one.
    let refs = pictures();
    let refs: Vec<(&str, &[u8])> = refs.iter().map(|(n, b)| (*n, b.as_slice())).collect();
    let request = DeckImport {
        title: "Kickoff",
        project: None,
        tool: "import_pptx",
        pictures: &refs,
        sent: 60,
    };
    let err = k
        .agent_import_deck(&s, &request, |_| "not a deck".to_owned(), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("Not a KastenFlow deck"), "{err}");
    assert_eq!(kept(t.vault.root()), before);
    // The bad title said what is wrong with it.
    let err = import(&k, &s, "Q3 [draft]", None, &pictures(), NOW).unwrap_err();
    assert!(err.to_string().contains("no [ ] or | characters"), "{err}");
}

#[test]
fn an_import_is_a_new_deck_for_the_sessions_note_limit() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 1;
    k.set_config(config).unwrap();
    let first = AgentOp::CreateDeck {
        title: "First".into(),
        project: None,
        tool: "create_deck".into(),
        text: deck("First", &SIX[..1]),
        sent: 100,
        marked: None,
    };
    k.agent_run(&s, &first, NOW).unwrap();
    let before = kept(t.vault.root());
    let err = import(&k, &s, "Kickoff", None, &pictures(), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("last 10 minutes"), "{err}");
    assert_eq!(kept(t.vault.root()), before, "nothing was imported");
    // A session a person trusts is not held to the soft limits.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert!(import(&k, &s, "Kickoff", None, &pictures(), NOW).is_ok());
}

#[test]
fn the_pictures_an_import_finds_already_in_the_vault_are_not_written_or_counted_again() {
    let (_t, k, s) = open();
    limits(&k, 1 << 20, 2, 50 << 20);
    // The person has one of the three already.
    let there = k
        .add_asset(
            &Actor::Human,
            "cover.png",
            &picture(1, 100),
            &NewAsset::default(),
            NOW,
        )
        .unwrap();
    let done = import(&k, &s, "Kickoff", None, &pictures(), NOW).unwrap();
    assert_eq!(
        done.pictures[0], there.path,
        "the deck names the picture that is there"
    );
    assert_eq!(done.pictures[1], "assets/slide-2.png");
    // It took two new pictures, which is the limit; the next one is refused.
    let err = add(&k, &s, "extra.png", &picture(7, 100), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("would have added 3 pictures"), "{err}");
}
