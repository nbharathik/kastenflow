//! What agents are told about changing things safely: the batch rule, the
//! agent modes, live views, the order of sub-pages, project state, locked
//! notes and byte-safe page edits. The same text is in the `kasten` skill,
//! which also lists every tool by area; tests keep the two and the real tool
//! list from drifting apart.

/// The rules, as the server tells them and the skill carries them.
pub const GUIDE: &str = r#"## Changing things safely

- **Many changes: one `batch`.** When you are about to make more than a few changes, send one `batch` of up to 100 (each `{"tool": "append", "args": {...}}`, in order, at most 1 MB) instead of many calls. It is all or nothing: if one change is refused you are told which one and nothing is changed; if any change would wait for the user's review, the whole batch waits as one proposal; otherwise the user can take it all back with one undo. A batch can hold these tools: `capture`, `create_note`, `append`, `replace_section`, `update_props`, `add_tags`, `remove_tags`, `rename_note`, `move_note`, `journal_append`, `create_board`, `add_to_board`, `connect`, `group_on_board`, `edit_page`, `set_parent`, `reorder_children`, `set_tag_views`, `set_view_order`, `update_tag_schema`. Everything else (`trash_note`, `create_project`, `set_project_state`, `propose_edit`, `undo_session`) is called on its own. In a batch, `update_tag_schema` only makes the schema of a tag that has none, and it makes the whole batch wait for the user. A change cannot name a note that an earlier change in the same batch makes: make that note first.
- **Modes: how much you may do alone.** The user sets this for the whole vault, or for one project, and `server_status` shows it as `mode`. In Review, every change you make waits as a proposal for the user. In Balanced (the usual), ordinary changes are made at once and bigger or riskier ones wait. In Autonomous, which lasts for a set time, your changes are made at once, even ones that would wait, and the user can go back to how things were before your session. In every mode, deleting for good, locked notes and hidden folders stay off limits. Never try to change the mode, and never turn plugins or setups on or off: those are the user's choice, and no tool does it for you. Do not look for another way round.
- **Proposals.** A result with `"status": "pending_review"` means the change waits for the user. Say in a line what is waiting, then move on. Do not send the same change again, and do not split a held change into smaller ones to get it through.
- **Show live views, do not copy them.** Put an embed on a line of its own: `![[tags/projects.yaml#Board]]` for a tag's view (the view's name after the `#`, as `query_tag` lists them), `![[projects/trip/plan.canvas]]` for a whiteboard, `![[projects/trip/flow.drawio]]` for a diagram. Leave an embed line exactly as it is when you edit around it.
- **Sub-pages and their order.** `set_parent` puts a page inside another page (leave `parent` out to take it out again). `reorder_children` puts a page's sub-pages in the order you give, and sub-pages you leave out follow alphabetically; an empty list goes back to alphabetical. Order pages with it, never by renaming them. A page cannot go inside, or be put in order inside, a locked page.
- **Project state has its own tool.** `update_props` refuses `status`, `health`, `next_action`, `last_review` and `review_after` on a project's page, and says so. Use `set_project_state` for those. `create_project` can start from a setup (`research`, `writing` or `presentation`, or one the user saved: `list_setups` gives its id). `save_project_setup` saves a project as a setup new projects can start from, and always waits for the user.
- **Locked notes are read-only.** Every change to one is refused, in a batch too, and so is anything that would change a locked note on the way (a rename that rewrites its links, a diagram file it names). Read it if you need to. Tell the user it is locked; do not work around it.
- **Edit a page by its blocks, byte for byte.** `edit_page` steps name blocks by the id and hash `read_page_blocks` gave. They are made together or not at all, and a block you did not name keeps every byte of its text, including text and settings you do not understand. If a block changed since you read it, nothing was written: read the page again and redo the steps. Never rewrite a whole page to move one block.
- **What the user is looking at.** `get_selection` gives the text the user has selected in KastenFlow: up to five pieces, each with its file, heading and place (for a slide, the selected elements). Call it when they say "this", "here" or "the selected part". It needs the app open, and says plainly when nothing is selected, the selection is out of date or the app is closed. It is the user's own text, shared for two minutes after you ask.
- **Routines.** A run nobody watches (Claude Code or Codex over stdio, with the app closed) is one session: keep it to one `batch`, so it is one change to take back. `activity_digest` says what agents did lately and what still waits for the user."#;

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::GUIDE;
    use crate::tools::{batchable_names, specs};

    /// Backticked words of snake_case that are fields or values, not tools.
    const FIELDS: [&str; 12] = [
        "mode",
        "parent",
        "status",
        "health",
        "next_action",
        "last_review",
        "review_after",
        "pending_review",
        "research",
        "writing",
        "presentation",
        "tool",
    ];

    fn backticked(text: &str) -> BTreeSet<String> {
        text.split('`')
            .skip(1)
            .step_by(2)
            .filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
            .map(str::to_owned)
            .collect()
    }

    fn tool_names() -> BTreeSet<String> {
        specs().into_iter().map(|s| s.name).collect()
    }

    #[test]
    fn the_guide_names_only_tools_that_exist() {
        let tools = tool_names();
        let unknown: Vec<String> = backticked(GUIDE)
            .into_iter()
            .filter(|w| !tools.contains(w) && !FIELDS.contains(&w.as_str()))
            .collect();
        assert!(unknown.is_empty(), "{unknown:?}");
    }

    #[test]
    fn the_batch_rule_lists_exactly_the_tools_a_batch_holds() {
        let line = GUIDE
            .lines()
            .find(|l| l.starts_with("- **Many changes"))
            .unwrap();
        let from = line.find("can hold these tools:").unwrap();
        let to = line.find("Everything else").unwrap();
        let said = backticked(&line[from..to]);
        let real: BTreeSet<String> = batchable_names().split(", ").map(str::to_owned).collect();
        assert_eq!(said, real);
        for alone in ["trash_note", "create_project", "set_project_state"] {
            assert!(
                !real.contains(alone),
                "{alone} is batchable now: update the rule"
            );
        }
    }

    #[test]
    fn the_guide_says_the_three_modes_and_the_other_rules() {
        for needle in [
            "In Review",
            "In Balanced",
            "In Autonomous",
            "Never try to change the mode",
            "![[tags/projects.yaml#Board]]",
            "![[projects/trip/plan.canvas]]",
            "![[projects/trip/flow.drawio]]",
            "`set_project_state`",
            "Locked notes are read-only",
            "keeps every byte",
            "changed since",
            "all or nothing",
        ] {
            assert!(GUIDE.contains(needle), "{needle}");
        }
    }

    #[test]
    fn the_guide_is_plain_and_short() {
        let words = GUIDE.split_whitespace().count();
        assert!(words < 800, "{words} words");
        for jargon in ["commit", "sidecar", "frontmatter", "ADR", "dev/"] {
            assert!(!GUIDE.contains(jargon), "{jargon}");
        }
        for word in GUIDE.split_whitespace() {
            let w = word.trim_matches(|c: char| !c.is_alphanumeric());
            assert!(w != "op" && w != "ops", "{word}");
        }
    }

    #[test]
    fn the_guide_is_in_what_the_server_tells_agents() {
        assert!(crate::server::instructions().contains(GUIDE));
    }

    fn skill() -> String {
        include_str!("../../../skills/kasten/SKILL.md").replace("\r\n", "\n")
    }

    /// The tools the skill lists by area, from its "Every tool" section.
    fn listed_in_skill() -> Vec<String> {
        let skill = skill();
        let from = skill.find("## Every tool, by area").unwrap();
        let rest = &skill[from + 3..];
        let section = &rest[..rest.find("\n## ").unwrap_or(rest.len())];
        let mut names = Vec::new();
        for line in section.lines().filter(|l| l.starts_with("- ")) {
            let before_colon = line.find(": `").map_or(0, |i| i + 2);
            let mut words: Vec<String> = line[before_colon..]
                .split('`')
                .skip(1)
                .step_by(2)
                .map(str::to_owned)
                .collect();
            names.append(&mut words);
        }
        names
    }

    /// The deck tools, which have their own skill and section.
    fn deck_tools() -> BTreeSet<String> {
        let mut decks: BTreeSet<String> = slides_core::agent::tools()
            .into_iter()
            .map(|t| t.name)
            .collect();
        decks.insert("deck_from_note".to_owned());
        decks
    }

    #[test]
    fn the_skill_lists_every_current_tool_once_and_only_real_ones() {
        let listed = listed_in_skill();
        let unique: BTreeSet<&String> = listed.iter().collect();
        assert_eq!(unique.len(), listed.len(), "a tool is listed twice");
        let decks = deck_tools();
        let real: BTreeSet<String> = tool_names()
            .into_iter()
            .filter(|n| !decks.contains(n))
            .collect();
        let listed: BTreeSet<String> = listed.into_iter().collect();
        let nonexistent: Vec<_> = listed.difference(&real).collect();
        let missing: Vec<_> = real.difference(&listed).collect();
        assert!(nonexistent.is_empty(), "not tools: {nonexistent:?}");
        assert!(missing.is_empty(), "not in the skill: {missing:?}");
        assert_eq!(real.len(), 99);
    }

    #[test]
    fn every_tool_there_is_is_in_the_instructions_or_the_skill() {
        let told = crate::server::instructions();
        let skill = skill();
        let decks = deck_tools();
        for tool in tool_names().into_iter().filter(|n| !decks.contains(n)) {
            let said = format!("`{tool}`");
            assert!(
                told.contains(&said) || skill.contains(&said),
                "{tool} is in neither"
            );
        }
    }

    #[test]
    fn the_skill_carries_the_guide_and_the_placeholders() {
        let skill = skill();
        assert!(skill.contains(GUIDE));
        assert!(skill.contains("PLACEHOLDER formulas-timeline"));
        assert!(!skill.contains("PLACEHOLDER smart-pages"));
        assert!(skill.contains("## Smart pages"));
        assert!(!skill.contains("PLACEHOLDER slides-tools"));
        for private in ["dev/", "ADR", "decisions/"] {
            assert!(!skill.contains(private), "{private}");
        }
    }

    #[test]
    fn the_skills_name_the_slide_tools_that_were_the_editors_and_they_exist() {
        let real: BTreeSet<String> = slides_core::agent::tools()
            .into_iter()
            .map(|t| t.name)
            .collect();
        let of_notes = skill();
        let of_slides =
            include_str!("../../../skills/kasten-slides/SKILL.md").replace("\r\n", "\n");
        for tool in [
            "move_slides",
            "set_rich_text",
            "set_slide_steps",
            "apply_deck_template",
        ] {
            assert!(real.contains(tool), "{tool} is a deck tool");
            let said = format!("`{tool}`");
            assert!(of_notes.contains(&said), "{tool} in the notes skill");
            assert!(of_slides.contains(&said), "{tool} in the slides skill");
        }
    }

    #[test]
    fn the_skill_says_what_a_routine_is_and_how_the_digest_is_asked() {
        let skill = skill();
        let from = skill.find("## Setups, the digest and routines").unwrap();
        let rest = &skill[from + 3..];
        let section = &rest[..rest.find("\n## ").unwrap_or(rest.len())];
        for needle in [
            "`list_setups`",
            "`save_project_setup`",
            "`activity_digest`",
            "`kasten-mcp --setup codex`",
            "`kasten-mcp --setup claude-code`",
            "over stdio",
            "with the app closed",
            "one `batch`",
            "`last_checked`",
            "two sessions",
        ] {
            assert!(section.contains(needle), "{needle}");
        }
        for private in ["dev/", "ADR", "decisions/", "commit"] {
            assert!(!section.contains(private), "{private}");
        }
        assert!(!skill.contains("PLACEHOLDER setups-digest-routines"));
    }

    #[test]
    fn the_new_text_is_under_fifteen_hundred_words() {
        let skill = skill();
        let from = skill.find("## Every tool, by area").unwrap();
        let rest = &skill[from..];
        let list = &rest[..rest.find("<!-- PLACEHOLDER").unwrap()];
        let words = GUIDE.split_whitespace().count() + list.split_whitespace().count();
        assert!(words < 1500, "{words} words");
    }
}
