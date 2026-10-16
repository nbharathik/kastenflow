//! The summaries keep what the index said while the index and the day are as
//! they were: asking again gives the same answer, and a new day, a change made
//! here and a change made by another engine on the same vault all show in the
//! next read.

use super::{TODAY, by_folder, vault};
use crate::common::NOW;

use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote};

fn page_in_alpha(k: &Kasten, title: &str) {
    k.create(
        &Actor::Human,
        &NewNote {
            kind: Kind::Page,
            title: title.into(),
            date: TODAY.into(),
            project: Some("alpha".into()),
            parent: None,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap();
}

#[test]
fn asking_again_gives_the_same_answer() {
    let (_t, k) = vault();
    let first = k.project_summaries(TODAY).unwrap();
    assert_eq!(k.project_summaries(TODAY).unwrap(), first);
}

#[test]
fn another_day_moves_what_is_overdue_and_going_back_restores_it() {
    let (_t, k) = vault();
    let first = k.project_summaries(TODAY).unwrap();
    let alpha = by_folder(&first, "alpha");
    assert_eq!((alpha.tasks.overdue, alpha.checklist.overdue), (1, 1));
    let early = k.project_summaries("2026-09-01").unwrap();
    let alpha = by_folder(&early, "alpha");
    assert_eq!((alpha.tasks.overdue, alpha.checklist.overdue), (0, 0));
    let late = k.project_summaries("2026-12-31").unwrap();
    let alpha = by_folder(&late, "alpha");
    assert_eq!((alpha.tasks.overdue, alpha.checklist.overdue), (2, 2));
    assert_eq!(k.project_summaries(TODAY).unwrap(), first);
}

#[test]
fn a_change_made_here_shows_in_the_next_read() {
    let (_t, k) = vault();
    let before = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").notes;
    page_in_alpha(&k, "Made here");
    let after = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").notes;
    assert_eq!(after, before + 1);
}

#[test]
fn a_change_made_by_another_engine_on_the_same_vault_shows_too() {
    let (t, k) = vault();
    let before = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").notes;
    // The app and the MCP server each open the vault and share one index.
    let other = Kasten::open(t.vault.root()).unwrap();
    page_in_alpha(&other, "Made elsewhere");
    let after = by_folder(&k.project_summaries(TODAY).unwrap(), "alpha").notes;
    assert_eq!(after, before + 1);
}
