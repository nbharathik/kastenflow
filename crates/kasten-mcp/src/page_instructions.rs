//! What agents are told about building a page by blocks: the "Building a
//! dashboard page" recipe. The same text is in the `kasten` skill; a test keeps
//! the two equal and keeps every step name in it a real step of `edit_page`.

/// The recipe, as the server tells it and the skill carries it.
pub const RECIPE: &str = "## Building a dashboard page

Read a page with `read_page_blocks` (its blocks, each with an id and a hash), then change it with `edit_page` steps that name blocks by those ids and hashes. All steps are made together or none is, and a block you did not name keeps every byte. If a block changed since you read it you are told so and nothing is written: read the page again and use the new ids and hashes.

A dashboard shows live views, not copies:

1. Add each view on a line of its own with an `insert` step, or an `embed` step after a block: `![[tags/projects.yaml#Board]]` for a tag's view, `![[projects/trip/plan.canvas]]` for a whiteboard, `![[projects/trip/flow.drawio]]` for a diagram, `![[library/talk.deck]]` for a deck.
2. Put a short summary first: an `insert` step with two or three sentences and links, then a `callout` step around it (kind `tip` or `note`, with a title).
3. Read the page again; the new blocks have ids now. Set neighbouring views side by side with a `wrap_columns` step (`blocks`, and a `ratio` such as 40/60). Two or three columns read best. `unwrap_columns` takes columns apart.
4. Fold what the reader does not need first, such as long tables or notes, into a `toggle` step with a title.
5. When smart pages are on, a smart block can stand in a column beside a view in the same way. Leave it out when they are off.

Read the page once more to check the order. `deck_from_note` turns a finished page into slides. In a chat that previews changes, the page shows as one change for the user to accept or reject.";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use kasten_core::pages::STEP_NAMES;

    use super::RECIPE;
    use crate::tools::specs;

    /// Words that name fields of a step or its values, not steps or tools.
    const FIELDS: [&str; 5] = ["blocks", "ratio", "tip", "note", "title"];

    /// Every backticked word of snake_case in `text` that is neither a step
    /// of `edit_page`, nor a tool of the server, nor a field word.
    fn unknown_names(text: &str) -> BTreeSet<String> {
        let tools: BTreeSet<String> = specs().into_iter().map(|s| s.name).collect();
        text.split('`')
            .skip(1)
            .step_by(2)
            .filter(|word| {
                !word.is_empty() && word.chars().all(|c| c.is_ascii_lowercase() || c == '_')
            })
            .filter(|word| {
                !STEP_NAMES.contains(word) && !tools.contains(*word) && !FIELDS.contains(word)
            })
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn instructions_recipe_names_only_real_steps_and_tools() {
        assert_eq!(unknown_names(RECIPE), BTreeSet::new());
        // The checker does catch a step that is not one.
        let wrong = "Use `wrap_column` and `callout` and `make_columns`.";
        assert_eq!(
            unknown_names(wrong).into_iter().collect::<Vec<_>>(),
            ["make_columns", "wrap_column"]
        );
    }

    #[test]
    fn instructions_recipe_uses_the_steps_a_dashboard_needs() {
        let steps: BTreeSet<&str> = RECIPE
            .split('`')
            .skip(1)
            .step_by(2)
            .filter(|w| STEP_NAMES.contains(w))
            .collect();
        for needed in ["insert", "embed", "callout", "wrap_columns", "toggle"] {
            assert!(steps.contains(needed), "{needed} is not in the recipe");
        }
    }

    #[test]
    fn instructions_recipe_is_short_and_plain() {
        let words = RECIPE.split_whitespace().count();
        assert!(words < 400, "{words} words");
        for jargon in ["commit", "sidecar", "op ", "hash:"] {
            assert!(!RECIPE.contains(jargon), "{jargon}");
        }
    }

    #[test]
    fn instructions_recipe_is_in_what_the_server_tells_agents() {
        let told = crate::server::instructions();
        assert!(told.contains(RECIPE));
        assert!(told.contains("`read_page_blocks`") && told.contains("`edit_page`"));
        assert!(told.contains("changed since"));
    }

    #[test]
    fn instructions_recipe_is_in_the_skill_with_the_byte_safety_rule() {
        let skill = include_str!("../../../skills/kasten/SKILL.md");
        assert!(skill.contains(RECIPE));
        assert!(skill.contains("`read_page_blocks`") && skill.contains("`edit_page`"));
        assert!(skill.contains("hash"), "the hash rule");
        assert!(skill.contains("changed since"));
    }
}
