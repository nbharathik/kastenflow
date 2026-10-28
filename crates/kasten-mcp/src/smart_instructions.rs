//! What agents are told about smart pages: when to make one, where its data
//! lives, how to make and check it, and the kit's API in brief. The same text
//! is in the `kasten` skill; the long reference is the resource
//! `kasten://smart/kit` and the `kasten-smart-pages` skill.

/// The section, as the server tells it and the skill carries it.
pub const SMART: &str = "## Smart pages

**When to make a smart page.** A smart page is a folder of code (`index.html`, `app.js`, a `smart.yaml`) that the app runs as a live page. Make one for a dashboard, a tracker, a map, a timeline, a calendar, a board or a gallery of the user's notes. Write prose and ordinary notes as a normal page. The data always lives in notes and is never written into the HTML: the page reads the notes, so editing a note changes the page. The page has no network: no web address, no `fetch`, no script from a CDN. It may use only its own files and the kit at `smart://kit/1/`.

**How.** Make the page in one call with `smart_create` (a title, the files, and the queries it reads); only a person turns an existing page into a smart page, so `set_note_meta` refuses `layout: smart`. Then run `smart_check` and fix every error it reports. After the user has opened the page, `smart_read` lists the errors the app saw when it ran it: read them and fix them with `smart_edit` (the file's `base_hash`, then `replace` steps) or `smart_write_file`. `smart_check` does not run the page and `smart_render` does not draw it, so say what you could not see.

**The kit in brief.** Load `smart://kit/1/kit.js`, the `lib/` files and only the components you use, then call `kasten.watch({ tag: \"paper\" }, notes => ...)` to keep notes live (also `kasten.query`, `kasten.read`, `kasten.open`, and, to change a note, `kasten.update({ id, props })`, `kasten.addTags({ id, tags })`, `kasten.append({ id, md })`). Each component is `kit.components.<name>(target, { label, data })` and gives back an object with `update(data)`: `stat`, `table`, `bar`, `line`, `donut`, `sparkline`, `legend`, `kanban`, `timeline`, `calendar`, `map`, `gallery`, `countdown`. The whole reference and three finished pages (a conference tracker, a reading dashboard, a project status board) are in the resource `kasten://smart/kit` and the `kasten-smart-pages` skill.

**On a dashboard page.** A smart page can stand in a column beside a view, as an embed of its title, like any other view.";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::SMART;
    use crate::tools::specs;

    /// Backticked words that are fields or values, not tools.
    const FIELDS: [&str; 17] = [
        "base_hash",
        "replace",
        "fetch",
        "stat",
        "table",
        "bar",
        "line",
        "donut",
        "sparkline",
        "legend",
        "kanban",
        "timeline",
        "calendar",
        "map",
        "gallery",
        "countdown",
        "lib",
    ];

    fn backticked(text: &str) -> BTreeSet<String> {
        text.split('`')
            .skip(1)
            .step_by(2)
            .filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn the_section_says_when_where_the_data_lives_and_how() {
        for needle in [
            "When to make a smart page",
            "dashboard",
            "tracker",
            "a map",
            "a timeline",
            "gallery",
            "Write prose and ordinary notes as a normal page",
            "The data always lives in notes and is never written into the HTML",
            "The page has no network",
            "`smart_check`",
            "`smart_read`",
            "`kasten://smart/kit`",
            "kasten-smart-pages",
            "kasten.watch(",
            "kasten.update({ id, props })",
        ] {
            assert!(SMART.contains(needle), "{needle}");
        }
    }

    #[test]
    fn the_section_names_only_tools_that_exist() {
        let tools: BTreeSet<String> = specs().into_iter().map(|s| s.name).collect();
        let unknown: Vec<String> = backticked(SMART)
            .into_iter()
            .filter(|w| !tools.contains(w) && !FIELDS.contains(&w.as_str()))
            .collect();
        assert!(unknown.is_empty(), "{unknown:?}");
        for tool in [
            "smart_create",
            "smart_check",
            "smart_read",
            "smart_edit",
            "smart_write_file",
            "smart_render",
        ] {
            assert!(SMART.contains(&format!("`{tool}`")), "{tool}");
        }
    }

    #[test]
    fn the_section_is_short_and_plain() {
        let words = SMART.split_whitespace().count();
        assert!(words < 400, "{words} words");
        for jargon in ["commit", "sidecar", "ADR", "dev/", "SmartWrite"] {
            assert!(!SMART.contains(jargon), "{jargon}");
        }
    }

    #[test]
    fn the_section_is_in_what_the_server_tells_agents_and_in_the_skill() {
        assert!(crate::server::instructions().contains(SMART));
        let skill = include_str!("../../../skills/kasten/SKILL.md").replace("\r\n", "\n");
        assert!(skill.contains(SMART));
        assert!(!skill.contains("PLACEHOLDER smart-pages"));
    }
}
