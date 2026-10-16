//! The text agents are taught diagrams with, written from the catalogue: the
//! MCP server's instructions and the `kasten-diagrams` skill are this text,
//! so what an agent is told is what the tools accept.

use std::collections::BTreeSet;

use super::{DEFAULT, SWATCHES, VERSION, all, edge_kind, group_kind, node_kind};
use crate::diagrams::spec::templates;

const WORK: &str = "\
Draw with the typed diagram tools, never with draw.io XML or a style of your own. The tools write the XML, place the boxes, \
and keep what a person drew meanwhile.

## The order of work

1. **Start from a description.** `diagram_new` takes a `spec` (JSON: nodes, groups, edges), a `mermaid` flowchart, or a `template` \
(TEMPLATES). It lays the diagram out and gives it a draft picture. Start from the nearest template when there is one, then change it.
2. **Read before you change.** `diagram_describe` gives every node's id, label, kind and place in page coordinates (x, y, width, height), \
every edge, the groups, the free room (`free.right`, `free.below`) and the lint findings.
3. **Change with steps.** `diagram_edit` takes a list of steps, run in order on the diagram as it is, so a person's edit made meanwhile is kept. \
Put a new box beside one that is there with `near` and `side`; wrap boxes in a boundary with `group`; end with `layout` when you added \
several things. (A layout of a hand-arranged diagram that moves most of its boxes waits for the person's review.)
4. **Check.** `diagram_lint` names what to fix: overlaps, arrows to nothing, crossings, long or missing labels, too many nodes, low contrast, \
a missing title or legend. Fix errors and warnings, then check again. `diagram_preview` returns a draft picture as SVG text.
5. **Keep a picture.** `diagram_export` with format `svg` keeps the picture in `assets/`; put it in a note with `![](assets/name.svg)`.

`diagram_find_shapes` looks up the editor's own icons by name (`aws4.lambda`, `kubernetes.pod`, `flowchart.decision`); use the key as \
`shape` in `add_node`. `create_diagram` and `update_diagram` still take whole XML, but use them only to bring in a file you were given. \
`trash_diagram` always waits for the person.

## Habits that make a diagram good

- One idea per diagram and at most 40 nodes per page. More means a second page (`add_page`) or a group that stands for a part.
- Left to right (`LR`) for flows of data or time; top to bottom (`TB`) for hierarchies, C4, networks and flowcharts.
- Labels are one to four words. Name an arrow for what travels along it (`HTTPS`, `OrderPlaced`, `reads`) unless it is obvious.
- Group what belongs together (a network, a trust zone, a system) and name the group. Do not draw an arrow through a box: move the box or add a group.
- Colour carries meaning: one colour for one kind of thing. Colour with `restyle` and a `token` (COLOURS), and leave neutral boxes uncoloured. \
With three colours or two line styles, add a small `note` as a legend.
- Ids are short, lowercase and stable (`web`, `api`, `orders-db`): the next edit names them.
- Boxes sit on the 10 pixel grid and `layout` puts them there. Do not work out coordinates for more than one or two boxes.
- Labels are plain words, never HTML. A link or an image comes from the catalogue or the vault, not from the web.

## Steps

`diagram_edit{diagram, steps[], page?, preset?, reason?}`; each step is an object with an `op`:

- `add_node{id, label?, kind? | shape?, x?, y?, w?, h?, group?, near?, side?, set?}`: a box. `kind` is from the catalogue below; `shape` is a key of \
`diagram_find_shapes`; `near` with `side` (`right`, `left`, `above`, `below`) puts it beside another node; `set` adds style words.
- `add_edge{from, to, label?, kind?, id?, waypoints?}`: an arrow. It belongs to the nearest group that holds both ends.
- `update{id, label?, kind?, set?, unset?}`, `move{id, x? y? | dx? dy?, group?}`, `resize{id, w?, h?}`.
- `restyle{ids, token? | kind?, set?, unset?}`, `group{id, label?, members[], kind?, padding?}`, `ungroup{id}`, \
`delete{ids}` (arrows to a cell, and what a group holds, go with it).
- `set_page{page, name?, width?, height?}`, `add_page{name}`: later steps work on that page.
- `layout{scope?, direction?, spacing?}`: layers, groups and lanes. `scope` is `all` or a group's id, `direction` `LR` or `TB`, \
`spacing` `compact`, `normal` or `wide`.

Limits: 200 steps and 500 new cells a call, 2,000 cells a diagram. A step that names a cell that is not there fails with its number and \
nothing is written: read the diagram again and send the rest.

An example, adding a queue between two services:

`diagram_edit{diagram: \"Checkout\", steps: [{\"op\": \"add_node\", \"id\": \"events\", \"label\": \"Order events\", \"kind\": \"queue\", \"near\": \"api\", \"side\": \"right\"}, \
{\"op\": \"add_edge\", \"from\": \"api\", \"to\": \"events\", \"label\": \"OrderPlaced\", \"kind\": \"async\"}, {\"op\": \"restyle\", \"ids\": [\"events\"], \"token\": \"orange\"}, {\"op\": \"layout\"}]}`

## Mistakes to avoid

- Guessing a node's place from memory. Read it with `diagram_describe`; a person may have moved it.
- Inventing a kind. One that is not in the catalogue is refused with the list: use `shape` for an icon of the editor, or `set` for a style word.
- Setting `fillColor` or `fontColor` by hand. Use a `token`: the editor's dark mode keeps tokens readable.
- Calling `layout` on a diagram the person arranged by hand when only one box was added. Use `near` instead.
- One huge call. Build the structure, lint it, then add detail.

";

/// A line for each of a preset's kinds: a kind's words are given where it is first listed.
fn names<T>(
    listed: &[&str],
    seen: &mut BTreeSet<String>,
    find: fn(&str) -> Option<&'static T>,
    about: fn(&T) -> (&'static str, &'static str),
) -> String {
    listed
        .iter()
        .filter_map(|n| find(n))
        .map(|k| {
            let (name, why) = about(k);
            if seen.insert(name.to_owned()) {
                format!("`{name}` ({why})")
            } else {
                format!("`{name}`")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The catalogue as Markdown: a section for each preset.
fn catalogue() -> String {
    let mut out = format!(
        "## The catalogue\n\nA kind is a name for a style and a size. Name a preset with `preset` (in the `spec` of `diagram_new`, or in `diagram_edit`); \
the default is `{DEFAULT}`. A kind is explained where it is first listed.\n\n"
    );
    let (mut nodes, mut edges, mut groups) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    for p in all() {
        let default = if p.id == DEFAULT { " (default)" } else { "" };
        out.push_str(&format!(
            "### {} - {}{default}\n\n{} (`{}`).\n\n",
            p.id, p.title, p.about, p.direction
        ));
        out.push_str(&format!(
            "- nodes: {}\n",
            names(p.nodes, &mut nodes, node_kind, |k| (k.name, k.about))
        ));
        out.push_str(&format!(
            "- edges: {}\n",
            names(p.edges, &mut edges, edge_kind, |k| (k.name, k.about))
        ));
        if !p.groups.is_empty() {
            out.push_str(&format!(
                "- groups: {}\n",
                names(p.groups, &mut groups, group_kind, |k| (k.name, k.about))
            ));
        }
        out.push('\n');
    }
    out
}

/// The conventions and the catalogue, as the MCP server's instructions carry them.
pub fn instructions() -> String {
    let colours = SWATCHES
        .iter()
        .map(|s| s.name)
        .collect::<Vec<_>>()
        .join(", ");
    let ids = templates()
        .iter()
        .map(|t| t.id)
        .collect::<Vec<_>>()
        .join(", ");
    let work = WORK.replace("TEMPLATES", &ids).replace("COLOURS", &colours);
    format!(
        "# Drawing diagrams (catalogue version {VERSION})\n\n{work}{}",
        catalogue()
    )
}

/// The `kasten-diagrams` skill: its front matter and the same text.
pub fn skill() -> String {
    format!(
        "---\nname: kasten-diagrams\ndescription: Draw, edit and check diagrams in the KastenFlow vault (architecture, flowcharts, C4, cloud, network, sequence, ER) with the kasten MCP server's typed diagram tools: diagram_new, diagram_describe, diagram_edit, diagram_lint, diagram_preview and diagram_export lay boxes out, keep a person's own edits and need no XML. Use when asked to draw, sketch, diagram or map out a system, a flow, a process or a data model.\n---\n\n{}",
        instructions()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_names_every_tool_step_kind_colour_and_template_there_is() {
        let text = instructions();
        for tool in [
            "diagram_new",
            "diagram_describe",
            "diagram_edit",
            "diagram_lint",
            "diagram_preview",
            "diagram_export",
            "diagram_find_shapes",
            "trash_diagram",
        ] {
            assert!(text.contains(tool), "{tool}");
        }
        for op in [
            "add_node", "add_edge", "update", "move", "resize", "restyle", "group", "ungroup",
            "delete", "set_page", "add_page", "layout",
        ] {
            assert!(
                text.contains(&format!("`{op}{{")) || text.contains(&format!("`{op}`")),
                "{op}"
            );
        }
        for p in all() {
            assert!(text.contains(&format!("### {} - ", p.id)), "{}", p.id);
            for k in p.nodes.iter().chain(p.edges).chain(p.groups) {
                assert!(text.contains(&format!("`{k}`")), "{k} in {}", p.id);
            }
        }
        for s in SWATCHES {
            assert!(text.contains(s.name), "{}", s.name);
        }
        for t in templates() {
            assert!(text.contains(t.id), "{}", t.id);
        }
        assert!(text.contains(&format!("catalogue version {VERSION}")));
        assert!(!text.contains("TEMPLATES") && !text.contains("COLOURS"));
        assert!(
            text.len() < 16_000,
            "{} bytes are read on every connection",
            text.len()
        );
    }

    #[test]
    fn a_kind_is_explained_once_and_every_kind_the_catalogue_has_is_explained() {
        let text = instructions();
        let mut explained = 0;
        for name in super::super::node_kind_names()
            .into_iter()
            .chain(super::super::edge_kind_names())
            .chain(super::super::group_kind_names())
        {
            assert!(
                text.contains(&format!("`{name}`")),
                "{name} is in no preset, so agents are never told of it"
            );
            // Once in each of the lists (nodes, edges, groups) a name is a kind of.
            let lists = usize::from(node_kind(name).is_some())
                + usize::from(edge_kind(name).is_some())
                + usize::from(group_kind(name).is_some());
            let said = text.matches(&format!("`{name}` (")).count();
            assert!(said <= lists, "{name} is explained {said} times");
            explained += said;
        }
        assert!(explained >= 20, "{explained}");
    }

    #[test]
    fn every_example_step_in_the_text_is_one_the_tools_accept() {
        let text = instructions();
        let from = text.find("steps: [").unwrap() + "steps: ".len();
        let to = text[from..].find("]}`").unwrap() + from + 1;
        let steps: Vec<crate::diagrams::steps::Step> =
            serde_json::from_str(&text[from..to]).unwrap();
        assert_eq!(steps.len(), 4);
        for step in &steps {
            if let crate::diagrams::steps::Step::AddNode { kind: Some(k), .. } = step {
                assert!(node_kind(k).is_some(), "{k}");
            }
            if let crate::diagrams::steps::Step::AddEdge { kind: Some(k), .. } = step {
                assert!(edge_kind(k).is_some(), "{k}");
            }
        }
    }

    /// The skill file in the repository is this text. It is written when it is
    /// missing or when `KASTEN_BLESS` is set; otherwise a change to the
    /// catalogue that was not carried over fails here.
    #[test]
    fn the_skill_file_is_what_the_catalogue_says() {
        let path = skill_path();
        if std::env::var_os("KASTEN_BLESS").is_some() || !path.exists() {
            write_skill_file();
        }
        let have = std::fs::read_to_string(&path)
            .unwrap()
            .replace("\r\n", "\n");
        assert!(
            have == skill(),
            "skills/kasten-diagrams/SKILL.md is out of step with the catalogue: run `cargo test -p kasten-core --lib -- --ignored write_the_skill_file` (or this test with KASTEN_BLESS=1) to write it again"
        );
    }

    fn skill_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../skills/kasten-diagrams/SKILL.md")
    }

    fn write_skill_file() {
        let path = skill_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, skill()).unwrap();
    }

    /// Writes the skill file again after the catalogue or its text changed.
    #[test]
    #[ignore = "writes skills/kasten-diagrams/SKILL.md"]
    fn write_the_skill_file() {
        write_skill_file();
    }

    #[test]
    fn the_skill_is_the_same_text_with_the_front_matter_of_a_skill() {
        let skill = skill();
        assert!(skill.starts_with("---\nname: kasten-diagrams\ndescription: "));
        assert!(skill.ends_with(&instructions()));
        let front = skill.split("\n---\n").next().unwrap();
        assert_eq!(front.lines().count(), 3);
        for private in ["dev/", "ADR", "decisions/"] {
            assert!(!skill.contains(private), "{private}");
        }
    }
}
