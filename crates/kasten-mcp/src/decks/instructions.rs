//! What the server tells an agent about decks when it connects: how a vault
//! keeps them and what Kasten does with an agent's changes, whether it can
//! see the slides, then the deck conventions, the elements, the lint rules
//! and the order of work, which are slides-core's and the same in every place
//! decks are served.

use slides_core::agent::{self, Facts};

use super::render;

/// What is different about decks in a vault.
const IN_A_VAULT: &str = "SLIDE DECKS
The vault also holds slide decks: .deck files in library/ or in a project's decks/ folder. The deck tools below build and change them with the same operations the editor uses. Every change is committed in your session like a note, and the person can undo the whole session.
- Name a deck by the path list_decks shows (library/talk.deck) or by its title; with only one deck the name may be left out. create_deck and import_pptx take `project` to make the deck in a project, as create_note does.
- A person may have the deck open. Your change is made to the deck as it is when you write, the person's own edits are kept, and the open deck follows. Nothing is left beside the deck as a copy.
- Some changes wait for the person: a call that takes the slides you have taken out of decks in the last 10 minutes past 3 (the person sets the number), and every trash_deck. A slide is taken out when it is removed and when it is left with nothing on it, and a batch with replace_deck counts every slide it puts something else in place of; splitting a large change into small calls does not get round it. The answer is {\"status\": \"pending_review\"} with a proposal id; nothing was changed. Tell the person what is waiting and go on; do not repeat it. Trusting a session does not lift this. Nothing is ever deleted: a deck put in the trash can be restored, and the person can undo what you did.
- Pictures go to assets/ with add_asset (base64, or a path of a picture in the vault) and are listed by search_assets. A file made by export is kept in assets/ too, and never written over another. A picture is refused when it is over the size limit (10 MB by default), or when the pictures you have added in the last 10 minutes would come to more than 30 or 50 MB (the person sets these); import_pptx brings a PowerPoint file in with its pictures as one change, and one that would go past a limit is not imported at all.
- Citation keys are checked against the .bib files in the vault; with none, they are not checked.
- deck_from_note makes a deck from a note of the vault: each heading becomes a slide with the note's list on it and the note's prose as the speaker notes, its pictures become picture slides, and the citation keys the .bib files know become the slides' footers with a references slide at the end. `include_linked` also turns the notes it links to into sections. Use it to start a talk from what the person has written, then refine slide by slide and run lint_deck after every batch.
- What you make or change in a deck is marked for the person, with a small star on each element and on the slide in the filmstrip, until they accept it or change it themselves. You cannot accept marks or take them off, so do not try; say which slides you changed so the person knows where to look.
";

/// Whether the agent can see the slides it builds, in this program.
fn seeing(facts: &Facts) -> &'static str {
    if facts.render {
        "- render_slide and render_grid draw slides as pictures where Chrome, Chromium or Edge is installed; draw one picture at a time. When a drawing fails (no browser, or too many at once) you cannot see the slides just then: lint is your eyes, so trust it, and tell the person what you could not check. server_status says whether slides can be drawn here.\n"
    } else {
        "- This program does not draw slides, so you cannot see them. Lint is your eyes; tell the person what it could not check.\n"
    }
}

/// The deck conventions from slides-core's instructions: everything from the
/// description of a deck to the order of work. What it says of a folder, of
/// copies kept beside a deck and of the hash is about `slides mcp`.
fn conventions(all: &str) -> &str {
    match (all.find("THE DECK\n"), all.find("LIMITS\n")) {
        (Some(from), Some(to)) if from < to => &all[from..to],
        _ => all,
    }
}

/// The deck part of the server's instructions for a program with these facts.
pub(crate) fn instructions_for(facts: &Facts) -> String {
    format!(
        "{IN_A_VAULT}{}\n{}",
        seeing(facts),
        conventions(&agent::instructions_for(facts))
    )
}

/// The deck part of the server's instructions for this program: what it can do
/// is worked out once per process, without starting a browser.
pub(crate) fn instructions() -> String {
    instructions_for(&render::facts())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEEING: Facts = Facts { render: true };
    const BLIND: Facts = Facts { render: false };

    #[test]
    fn the_conventions_come_from_slides_core_and_the_vault_notes_come_first() {
        let text = instructions_for(&SEEING);
        assert!(text.starts_with("SLIDE DECKS\n"));
        for phrase in [
            "16:9 960x540",
            "lint_deck",
            "create_deck",
            "HOW TO WORK",
            "COMPOSITE ELEMENTS",
            "pending_review",
            "list_decks",
            "deck_from_note",
            "small star on each element",
        ] {
            assert!(text.contains(phrase), "{phrase}");
        }
        assert!(
            text.len() < 20_000,
            "{} bytes are read on every connection",
            text.len()
        );
    }

    #[test]
    fn every_page_size_and_theme_is_named_and_the_tables_operations() {
        let text = instructions_for(&SEEING);
        for (name, w, h) in slides_core::resize::PAGE_SIZES {
            assert!(text.contains(&format!("{name} {w}x{h}")), "{name}");
        }
        for theme in slides_core::themes::all() {
            assert!(text.contains(&theme.name), "{}", theme.name);
        }
        for op in ["set_cells", "insert_rows", "merge_cells", "unmerge_cells"] {
            assert!(text.contains(op), "{op}");
        }
    }

    #[test]
    fn nothing_about_a_folder_of_decks_or_copies_beside_a_deck_is_left() {
        for facts in [SEEING, BLIND] {
            let text = instructions_for(&facts);
            assert!(
                !text.contains("saved as a copy beside"),
                "the hash paragraph is for folders"
            );
            assert!(
                !text.contains("LIMITS"),
                "slides mcp's limits are not this server's"
            );
            assert!(!text.contains("not available yet"), "{text}");
            assert!(!text.contains("not built yet"), "{text}");
        }
    }

    #[test]
    fn the_words_about_seeing_slides_follow_what_the_program_can_do() {
        let seeing = instructions_for(&SEEING);
        assert!(
            seeing.contains("render_slide and render_grid draw slides")
                && seeing.contains("Then look: render_slide")
                && seeing.contains("server_status"),
            "{seeing}"
        );
        let blind = instructions_for(&BLIND);
        assert!(!blind.contains("render_slide"), "{blind}");
        assert!(!blind.contains("render_grid"), "{blind}");
        assert!(blind.contains("does not draw slides"), "{blind}");
        assert!(blind.contains("lint_deck"));
    }

    #[test]
    fn this_program_is_told_what_it_was_built_to_do() {
        assert_eq!(
            instructions(),
            instructions_for(&Facts {
                render: render::built()
            })
        );
        assert_eq!(
            render::facts(),
            Facts {
                render: render::built()
            }
        );
    }
}
