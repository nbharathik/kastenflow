//! AI actions: reading their files (with the mistakes a person can make),
//! the eleven that ship, and the vault's own laid over them. The message each
//! becomes is in action_prompts.rs.

use std::fs;

use super::vault;
use crate::chat::actions::catalog::{self, Catalog};
use crate::chat::actions::parse::{MAX_BYTES, parse};
use crate::chat::actions::parse::{Need, Place, Writes};

const GOOD: &str = "---\ntype: ai-action\ntitle: Tidy\nicon: wand\nneeds: [selection]\noptional: [nearby, page]\nwrites: insert\nwhere: [editor, chat]\nversion: 1\n---\nTidy the selected text.\n";

fn with(front: &str) -> String {
    format!("---\ntype: ai-action\ntitle: T\n{front}\n---\nDo it.\n")
}

#[test]
fn a_good_file_is_read_whole() {
    let tidy = parse("tidy", GOOD).unwrap();
    assert_eq!(tidy.slug, "tidy");
    assert_eq!(tidy.title, "Tidy");
    assert_eq!(tidy.icon, "wand");
    assert_eq!(tidy.needs, [Need::Selection]);
    assert_eq!(tidy.optional, [Need::Nearby, Need::Page]);
    assert_eq!(tidy.writes, Writes::Insert);
    assert_eq!(tidy.places, [Place::Editor, Place::Chat]);
    assert_eq!(tidy.version, 1);
    assert_eq!(tidy.instruction, "Tidy the selected text.");
    assert!(!tidy.built_in && tidy.path.is_none());
}

#[test]
fn what_a_file_leaves_out_has_a_default_and_keys_it_does_not_know_are_ignored() {
    let bare = parse("t", "---\ntype: ai-action\ntitle: Bare\n---\nDo it.").unwrap();
    assert_eq!(bare.icon, "sparkle");
    assert!(bare.needs.is_empty() && bare.optional.is_empty());
    assert_eq!(bare.writes, Writes::None);
    assert_eq!(bare.places, [Place::Editor, Place::Chat]);
    assert_eq!(bare.version, 1);

    let odd = parse(
        "t",
        &with("colour: red\nneeds: Selection\nwhere: chat\nfuture: {a: 1}"),
    )
    .unwrap();
    assert_eq!(odd.needs, [Need::Selection], "one word, any case");
    assert_eq!(odd.places, [Place::Chat]);
    let twice = parse("t", &with("needs: [page, page, Page]")).unwrap();
    assert_eq!(twice.needs, [Need::Page]);
}

#[test]
fn mistakes_are_described_in_words() {
    let message = |text: &str| parse("t", text).unwrap_err();
    let unknown = message(&with("needs: [selection, selecton]"));
    assert!(unknown.contains("unknown need “selecton”"), "{unknown}");
    assert!(
        unknown.contains("selection, page, nearby, sources, pdf, highlights, project, journal"),
        "{unknown}"
    );
    assert!(
        message(&with("optional: [somewhere]"))
            .contains("“optional” has an unknown need “somewhere”")
    );
    assert!(message(&with("writes: always")).contains("none, insert or propose, not “always”"));
    assert!(message(&with("where: [phone]")).contains("unknown place “phone”"));
    assert!(message(&with("version: 2")).contains("format 2"));
    assert!(message(&with("version: soon")).contains("whole number"));
    assert!(message(&with("version: 0")).contains("whole number"));
    assert!(message(&with("needs: [1, 2]")).contains("list of words"));
    assert!(message(&with("needs: {a: b}")).contains("list of words"));
    assert!(message("Just text, no frontmatter.").contains("no frontmatter"));
    assert!(message("---\ntitle: T\n---\nDo it.").contains("type: ai-action"));
    assert!(message("---\ntype: page\ntitle: T\n---\nDo it.").contains("type: ai-action"));
    assert!(message("---\ntype: ai-action\n---\nDo it.").contains("needs a title"));
    assert!(message("---\ntype: ai-action\ntitle: \"  \"\n---\nDo it.").contains("needs a title"));
    assert!(message("---\ntype: ai-action\ntitle: T\n---\n  \n").contains("no instruction"));
    assert!(message("---\ntype: ai-action\ntitle: [T\n---\nDo it.").contains("could not be read"));
    assert!(message("---\n- a\n- b\n---\nDo it.").contains("could not be read"));
    let long = format!("{GOOD}{}", "x".repeat(MAX_BYTES));
    assert!(message(&long).contains("too long"));
}

#[test]
fn the_fourteen_that_ship_all_read() {
    let all = catalog::built_in();
    let names: Vec<(&str, &str)> = all
        .iter()
        .map(|a| (a.slug.as_str(), a.title.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            ("explain", "Explain"),
            ("compare-sources", "Compare sources"),
            ("outline", "Outline"),
            ("extract-action-items", "Extract action items"),
            ("draft-project-update", "Draft project update"),
            ("draw-diagram", "Draw a diagram"),
            ("explain-diagram", "Explain this diagram"),
            ("tidy-diagram", "Tidy this diagram"),
            ("check-diagram", "Check this diagram"),
            ("layout-page", "Lay out this page"),
            ("fix-latex-errors", "Fix LaTeX errors"),
            ("make-smart-page", "Make a smart page from this"),
            ("improve-smart-layout", "Improve this smart page's layout"),
            ("fix-smart-errors", "Fix its errors"),
        ]
    );
    assert!(
        all.iter()
            .all(|a| a.built_in && a.path.is_none() && a.version == 1)
    );
    // Explain is read, never put in a page, and works on a selection.
    let explain = &all[0];
    assert_eq!(
        (explain.needs.clone(), explain.writes),
        (vec![Need::Selection], Writes::None)
    );
    assert!(explain.places.contains(&Place::Editor) && explain.places.contains(&Place::Pdf));
    // The ones that write say so.
    for slug in ["outline", "extract-action-items", "draft-project-update"] {
        let action = all.iter().find(|a| a.slug == slug).unwrap();
        assert_eq!(action.writes, Writes::Insert, "{slug}");
        assert!(action.places.contains(&Place::Editor), "{slug}");
    }
    // Their instructions give no place to put the data: it comes beside them.
    assert!(all.iter().all(|a| !a.instruction.contains("{{")));
}

#[test]
fn the_diagram_actions_are_for_the_chat_and_name_the_tools_they_use() {
    let all = catalog::built_in();
    let find = |slug: &str| all.iter().find(|a| a.slug == slug).unwrap();
    let expected: [(&str, Writes, &[&str]); 4] = [
        (
            "draw-diagram",
            Writes::Propose,
            &["diagram_new", "diagram_lint"],
        ),
        ("explain-diagram", Writes::None, &["diagram_describe"]),
        ("tidy-diagram", Writes::Propose, &["diagram_edit", "layout"]),
        (
            "check-diagram",
            Writes::Propose,
            &["diagram_lint", "diagram_edit"],
        ),
    ];
    for (slug, writes, tools) in expected {
        let action = find(slug);
        assert_eq!(
            action.places,
            [Place::Chat],
            "{slug} is offered in the chat only"
        );
        assert_eq!(action.writes, writes, "{slug}");
        for tool in tools {
            assert!(
                action.instruction.contains(tool),
                "{slug} should name {tool}"
            );
        }
        // The model is never asked to write the diagram's file.
        assert!(!action.instruction.contains("mxCell"), "{slug}");
    }
    // Explaining changes nothing, and so tidying and checking say what they leave alone.
    assert!(
        find("explain-diagram")
            .instruction
            .contains("Do not change the diagram")
    );
    assert!(
        find("draw-diagram")
            .instruction
            .contains("Never write the diagram's XML")
    );
}

#[test]
fn lay_out_this_page_is_offered_in_the_page_menu_and_asks_for_edit_page_steps() {
    let all = catalog::built_in();
    let layout = all.iter().find(|a| a.slug == "layout-page").unwrap();
    // Offered in the page's AI menu and the chat; it proposes, so it stages in a chat.
    assert_eq!(layout.writes, Writes::Propose);
    assert_eq!(layout.places, [Place::Editor, Place::Chat]);
    assert_eq!(layout.needs, [Need::Page]);
    let words = &layout.instruction;
    // It sends the model to the page's blocks and to the one tool that changes them.
    assert!(words.contains("read_page_blocks") && words.contains("edit_page"));
    assert!(words.contains("changed since"), "the hash rule: {words}");
    // Every tool or step it names (a word with an underscore) is a real one.
    let known = ["read_page_blocks", "edit_page"];
    for word in words.split(|c: char| !(c.is_ascii_lowercase() || c == '_')) {
        if word.contains('_') {
            assert!(
                known.contains(&word) || kasten_core::pages::STEP_NAMES.contains(&word),
                "{word} is neither a tool nor a step of edit_page"
            );
        }
    }
    // The page's words stay as they are: it arranges, it does not rewrite.
    assert!(words.contains("Do not change the page's words"));
    assert!(words.split_whitespace().count() < 200);
}

#[test]
fn fix_latex_errors_is_offered_in_latex_views_only_and_asks_for_latex_edit_changes() {
    let all = catalog::built_in();
    let fix = all.iter().find(|a| a.slug == "fix-latex-errors").unwrap();
    // Only the LaTeX editor offers it; it proposes; a LaTeX edit is not staged yet, so each one waits as its own proposal.
    assert_eq!(fix.places, [Place::Latex]);
    assert_eq!(fix.writes, Writes::Propose);
    assert_eq!(fix.needs, [Need::Sources]);
    assert_eq!(fix.optional, [Need::Selection]);
    let words = &fix.instruction;
    // Every tool it names is a real one (`base_hash` is the tool's field), and it sends the model to the three LaTeX tools.
    let known: Vec<String> = kasten_mcp::tools::specs()
        .into_iter()
        .map(|s| s.name)
        .collect();
    for word in words.split(|c: char| !(c.is_ascii_lowercase() || c == '_')) {
        if word.contains('_') && word != "base_hash" {
            assert!(known.iter().any(|k| k == word), "{word} is not a tool");
        }
    }
    for tool in ["latex_build", "latex_read", "latex_edit"] {
        assert!(words.contains(tool), "{tool}");
    }
    assert!(words.contains("base_hash"));
    // It does not rewrite the document to make errors go away.
    assert!(words.contains("never take text out just to make an error go away"));
    assert!(words.split_whitespace().count() < 220);
    // The other actions are not for the LaTeX editor.
    assert!(
        all.iter()
            .filter(|a| a.slug != "fix-latex-errors")
            .all(|a| !a.places.contains(&Place::Latex))
    );
    // A file that asks for the new place reads, and one with a typo is told the places.
    let own = parse("mine", &with("where: [latex, chat]")).unwrap();
    assert_eq!(own.places, [Place::Latex, Place::Chat]);
    let wrong = parse("t", &with("where: [latx]")).unwrap_err();
    assert!(wrong.contains("editor, chat, pdf, latex"), "{wrong}");
}

#[test]
fn the_smart_page_actions_propose_and_name_only_tools_that_exist() {
    let all = catalog::built_in();
    let find = |slug: &str| all.iter().find(|a| a.slug == slug).unwrap();
    let known: Vec<String> = kasten_mcp::tools::specs()
        .into_iter()
        .map(|s| s.name)
        .collect();
    // (slug, where it is offered, the tools it sends the model to)
    let expected: [(&str, &[Place], &[&str]); 3] = [
        (
            "make-smart-page",
            &[Place::Editor, Place::Chat],
            &["query_tag", "smart_create", "smart_check", "smart_edit"],
        ),
        (
            "improve-smart-layout",
            &[Place::Smart],
            &["smart_read", "smart_edit", "smart_check"],
        ),
        (
            "fix-smart-errors",
            &[Place::Smart],
            &["smart_read", "smart_edit", "smart_check", "base_hash"],
        ),
    ];
    for (slug, places, tools) in expected {
        let action = find(slug);
        // They write, so in a chat the change waits for the person.
        assert_eq!(action.writes, Writes::Propose, "{slug}");
        assert_eq!(action.places, places, "{slug}");
        assert_eq!(action.needs, [Need::Page], "{slug}");
        for tool in tools {
            assert!(
                action.instruction.contains(tool),
                "{slug} should name {tool}"
            );
        }
        // Every tool it names (a word with an underscore) is a real one.
        for word in action
            .instruction
            .split(|c: char| !(c.is_ascii_lowercase() || c == '_'))
        {
            if word.contains('_') && word != "base_hash" {
                assert!(
                    known.iter().any(|k| k == word),
                    "{slug}: {word} is not a tool"
                );
            }
        }
        // Data stays in notes and the page has no network, in the words of each.
        assert!(action.instruction.contains("Never"), "{slug}");
        assert!(
            action.instruction.split_whitespace().count() < 230,
            "{slug}"
        );
    }
    // The last two are for a smart page; they say what to do on any other page.
    for slug in ["improve-smart-layout", "fix-smart-errors"] {
        let words = &find(slug).instruction;
        assert!(
            words.contains("is not a smart page, say so and change nothing"),
            "{slug}"
        );
        assert!(words.contains("smart_check"));
    }
    // Making a page reads the notes first, points at the kit reference, and never copies data.
    let make = &find("make-smart-page").instruction;
    assert!(make.contains("kasten://smart/kit"));
    assert!(make.contains("Never write the data into the page"));
    assert!(make.contains("the page has no network"));
    // Fix its errors reads the error log through smart_read, in the words a person would.
    assert!(
        find("fix-smart-errors")
            .instruction
            .contains("the errors the page reported")
    );
    // Only the LaTeX action is for the LaTeX editor.
    assert!(
        all.iter()
            .filter(|a| a.slug != "fix-latex-errors")
            .all(|a| !a.places.contains(&Place::Latex))
    );
}

fn vault_with(files: &[(&str, &str)]) -> super::Vault {
    let v = vault();
    let folder = v.dir.join("templates/ai");
    fs::create_dir_all(&folder).unwrap();
    for (name, text) in files {
        fs::write(folder.join(name), text).unwrap();
    }
    v
}

fn slugs(catalog: &Catalog) -> Vec<&str> {
    catalog.actions.iter().map(|a| a.slug.as_str()).collect()
}

/// Smart pages turned on for the vault, as a person does in Settings → Plugins.
fn smart_on(v: &super::Vault) {
    v.kasten
        .set_plugin_enabled(
            &kasten_core::history::Actor::Human,
            "smart",
            true,
            kasten_core::Instant::now(),
        )
        .unwrap();
}

#[test]
fn the_smart_page_actions_are_offered_only_where_smart_pages_are_on() {
    let v = vault();
    let smart = [
        "make-smart-page",
        "improve-smart-layout",
        "fix-smart-errors",
    ];
    // Off in a fresh vault: the other eleven stay, these three are not listed.
    let catalog = catalog::load(&v.kasten).unwrap();
    assert_eq!(catalog.actions.len(), 11);
    for slug in smart {
        assert!(catalog.find(slug).is_none(), "{slug}");
    }
    // Built in, they are still shipped: only the list leaves them out.
    assert!(
        catalog::built_in()
            .iter()
            .any(|a| a.slug == "make-smart-page")
    );
    // A project that says on brings them back.
    v.kasten
        .set_project_smart_pages(
            &kasten_core::history::Actor::Human,
            "projects/photo-organiser/_project.md",
            kasten_core::ProjectSmart::On,
            kasten_core::Instant::now(),
        )
        .unwrap();
    assert_eq!(catalog::load(&v.kasten).unwrap().actions.len(), 14);
    assert!(v.kasten.smart_enabled_for_project(Some("photo-organiser")));
    assert!(
        !v.kasten
            .smart_enabled_for_project(Some("note-taking-study"))
    );
}

#[test]
fn a_vault_file_replaces_the_built_in_of_its_name_in_place_and_others_follow_by_title() {
    let own_outline = with("needs: [page]").replace("title: T", "title: My outline");
    let v = vault_with(&[
        ("Outline.md", &own_outline),
        ("standup.md", &GOOD.replace("Tidy", "Standup")),
        ("agenda.md", &GOOD.replace("Tidy", "Agenda")),
    ]);
    smart_on(&v);
    let catalog = catalog::load(&v.kasten).unwrap();
    assert!(catalog.problems.is_empty(), "{:?}", catalog.problems);
    assert_eq!(
        slugs(&catalog),
        [
            "explain",
            "compare-sources",
            "outline",
            "extract-action-items",
            "draft-project-update",
            "draw-diagram",
            "explain-diagram",
            "tidy-diagram",
            "check-diagram",
            "layout-page",
            "fix-latex-errors",
            "make-smart-page",
            "improve-smart-layout",
            "fix-smart-errors",
            "agenda",
            "standup"
        ]
    );
    let outline = catalog.find("outline").unwrap();
    assert_eq!(outline.title, "My outline");
    assert_eq!(outline.instruction, "Do it.");
    assert!(!outline.built_in);
    assert_eq!(outline.path.as_deref(), Some("templates/ai/Outline.md"));
    assert!(catalog.find("explain").unwrap().built_in);

    // Capitals and spaces in a file name still name the same action.
    let v = vault_with(&[("Compare Sources.md", &GOOD.replace("Tidy", "Mine"))]);
    smart_on(&v);
    let catalog = catalog::load(&v.kasten).unwrap();
    assert_eq!(catalog.find("compare-sources").unwrap().title, "Mine");
    assert_eq!(catalog.actions.len(), 14);
}

#[test]
fn a_file_that_does_not_read_is_reported_and_the_built_in_it_would_replace_stays() {
    let v = vault_with(&[
        ("explain.md", &with("needs: [selecton]")),
        ("broken.md", "No frontmatter here."),
        ("fine.md", GOOD),
        ("notes.txt", "not markdown"),
    ]);
    let catalog = catalog::load(&v.kasten).unwrap();
    assert!(
        catalog.find("explain").unwrap().built_in,
        "the shipped Explain stays"
    );
    assert!(catalog.find("fine").is_some());
    assert!(catalog.find("broken").is_none());
    let mut problems: Vec<(&str, &str)> = catalog
        .problems
        .iter()
        .map(|p| (p.slug.as_str(), p.path.as_str()))
        .collect();
    problems.sort_unstable();
    assert_eq!(
        problems,
        [
            ("broken", "templates/ai/broken.md"),
            ("explain", "templates/ai/explain.md")
        ]
    );
    let why = catalog
        .problems
        .iter()
        .find(|p| p.slug == "explain")
        .unwrap();
    assert!(why.message.contains("selecton"), "{}", why.message);
}

#[test]
fn two_files_with_one_name_keep_the_first() {
    let v = vault_with(&[
        ("Compare Sources.md", &GOOD.replace("Tidy", "First")),
        ("compare-sources.md", &GOOD.replace("Tidy", "Second")),
    ]);
    let catalog = catalog::load(&v.kasten).unwrap();
    assert_eq!(catalog.find("compare-sources").unwrap().title, "First");
    assert_eq!(catalog.problems.len(), 1);
    assert_eq!(catalog.problems[0].path, "templates/ai/compare-sources.md");
    assert!(
        catalog.problems[0]
            .message
            .contains("Compare Sources.md has the same name"),
        "{}",
        catalog.problems[0].message
    );
}
