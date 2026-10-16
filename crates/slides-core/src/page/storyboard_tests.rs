//! Tests of the storyboard: a page drafted into entries, composed again, and followed back to its sections.

use super::*;

const PAGE: &str = "---\ntitle: Seaside trip\n---\nWords before any heading.\n\n## Plan\n\nBook early. Then pack.\n\n- flights\n  - morning\n- guesthouse\n\n![The bay](assets/bay.png)\n\n> Mind the gap.\n\n## Budget\n\n| item | cost |\n|---|---|\n| bed | 40 |\n\n```rust\nfn main() {}\n```\n";

fn source(markdown: &str) -> StorySource {
    StorySource {
        page: "projects/trip/pages/plan.md".to_owned(),
        id: Some("n-1".to_owned()),
        title: Some("Seaside trip".to_owned()),
        section: None,
        markdown: markdown.to_owned(),
    }
}

#[test]
fn storyboard_draft_matches_page_parts() {
    let entries = draft(&source(PAGE), 0);
    let titles: Vec<&str> = entries.iter().map(|e| e.title.as_str()).collect();
    let cut = parts(&blocks(PAGE), 0, "Seaside trip");
    let wanted: Vec<String> = cut.iter().map(|p| plain(&p.title)).collect();
    assert_eq!(titles, wanted, "one entry for each part, in order");
    assert_eq!(titles, ["Seaside trip", "Plan", "Budget"]);
    let plan = &entries[1];
    assert_eq!(plan.point.as_deref(), Some("Book early."));
    assert_eq!(
        plan.evidence,
        [
            "- flights",
            "  - morning",
            "- guesthouse",
            "![The bay](assets/bay.png)"
        ]
    );
    assert_eq!(
        plan.notes.as_deref(),
        Some("Book early. Then pack.\n\n> Mind the gap.")
    );
    assert!(plan.media);
    let budget = &entries[2];
    assert_eq!(budget.point, None);
    assert_eq!(budget.evidence.len(), 2);
    assert!(budget.evidence[0].starts_with("| item | cost |\n| --- | --- |"));
    assert!(budget.evidence[1].starts_with("```rust\nfn main() {}"));
    assert!(budget.media);
    assert!(!entries[0].media);
}

#[test]
fn a_section_names_the_heading_it_can_be_found_by() {
    let entries = draft(&source(PAGE), 0);
    assert_eq!(
        entries[0].sources[0].section, None,
        "words before a heading are no section"
    );
    let plan = &entries[1].sources[0];
    assert_eq!(plan.section.as_deref(), Some("Plan"));
    assert_eq!(plan.page, "projects/trip/pages/plan.md");
    assert_eq!(plan.id.as_deref(), Some("n-1"));
    // The text kept is what the host will read again for that heading.
    assert_eq!(Some(plan.markdown.clone()), section_markdown(PAGE, "Plan"),);
    assert!(plan.markdown.starts_with("## Plan"));
}

#[test]
fn a_heading_above_the_cut_is_not_found_by_its_heading() {
    // The title (level 1) holds the two sections; its own part ends where the first begins, which is not what the host would read for it.
    let page = "# Trip\n\nIntro.\n\n## One\n\n- a\n\n## Two\n\n- b\n";
    let entries = draft(&source(page), 0);
    let titles: Vec<&str> = entries.iter().map(|e| e.title.as_str()).collect();
    assert_eq!(titles, ["Trip", "One", "Two"]);
    assert_eq!(entries[0].sources[0].section, None);
    assert_eq!(entries[1].sources[0].section.as_deref(), Some("One"));
    assert_eq!(entries[2].sources[0].markdown, "## Two\n\n- b");
}

#[test]
fn a_page_with_no_headings_is_one_entry_and_an_empty_page_none() {
    let entries = draft(&source("Just words. And more."), 0);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].title, "Seaside trip");
    assert_eq!(entries[0].point.as_deref(), Some("Just words."));
    assert!(draft(&source("---\ntitle: x\n---\n"), 0).is_empty());
}

#[test]
fn a_split_level_cuts_at_that_heading() {
    let page = "## A\n\n### A1\n\n- x\n\n### A2\n\n- y\n\n## B\n\n- z\n";
    let top = draft(&source(page), 2);
    assert_eq!(
        top.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(),
        ["A", "B"]
    );
    assert!(
        top[0].evidence.contains(&"- **A1**".to_owned()),
        "a deeper heading is a bold line"
    );
    let deep = draft(&source(page), 3);
    assert_eq!(
        deep.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(),
        ["A", "A1", "A2", "B"]
    );
}

#[test]
fn the_point_is_one_sentence_and_never_long() {
    assert_eq!(first_sentence("One. Two."), "One.");
    assert_eq!(first_sentence("No stop"), "No stop");
    assert_eq!(
        first_sentence("About 3.5 percent. Next."),
        "About 3.5 percent."
    );
    let long = "word ".repeat(100);
    let point = first_sentence(&long);
    assert!(point.chars().count() <= POINT_CHARS && point.ends_with('…'));
}

fn entry(point: Option<&str>, evidence: &[&str]) -> StoryEntry {
    StoryEntry {
        title: "T".to_owned(),
        point: point.map(str::to_owned),
        evidence: evidence.iter().map(|b| (*b).to_owned()).collect(),
        notes: None,
        layout: None,
        media: true,
        sources: Vec::new(),
    }
}

#[test]
fn composing_puts_the_point_first_and_keeps_lists_together() {
    let entry = entry(
        Some("Lead."),
        &["- a", "  - b", "![x](assets/x.png)", "- c"],
    );
    assert_eq!(
        compose(&entry),
        "Lead.\n\n- a\n  - b\n\n![x](assets/x.png)\n\n- c"
    );
    let (kept, left_out) = body_blocks(&entry);
    assert!(left_out.is_empty());
    assert!(matches!(kept[0], Block::Paragraph { .. }));
    assert_eq!(
        kept.iter()
            .filter(|b| matches!(b, Block::Item { .. }))
            .count(),
        3
    );
}

#[test]
fn a_picture_from_the_web_is_left_out_and_named() {
    let entry = entry(
        None,
        &[
            "![far](https://example.com/a.png)",
            "![near](assets/a.png)",
            "![[inline.png]]",
        ],
    );
    let (kept, left_out) = body_blocks(&entry);
    assert_eq!(left_out, ["https://example.com/a.png"]);
    let sources: Vec<&str> = kept
        .iter()
        .filter_map(|b| match b {
            Block::Image { src, .. } => Some(src.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(sources, ["assets/a.png", "inline.png"]);
}

#[test]
fn an_entry_that_was_rewritten_is_no_longer_as_drafted() {
    let mut entries = draft(&source(PAGE), 0);
    assert!(is_as_drafted(&entries[1]));
    assert!(!is_as_drafted(&entries[0]), "no section to track");
    entries[1].evidence.remove(0);
    assert!(!is_as_drafted(&entries[1]));
    let mut merged = draft(&source(PAGE), 0)[1].clone();
    merged.sources.push(merged.sources[0].clone());
    assert!(!is_as_drafted(&merged));
}

#[test]
fn chunks_are_tracked_when_their_title_is_a_heading_that_says_the_same() {
    let page = "## Plan\n\n- a\n- b\n\n---\n\n## Budget\n\n- c\n";
    let chunk = |title: &str, markdown: &str| StoryChunk {
        title: title.to_owned(),
        markdown: markdown.to_owned(),
    };
    let chunks = [
        chunk("Plan", "## Plan\n\n- a\n- b"),
        chunk("Budget", "## Budget\n\n- c"),
        chunk("Thanks", "Questions?"),
        chunk("Budget", "- different"),
    ];
    let entries = draft_chunks(&source(page), &chunks);
    assert_eq!(entries[0].sources[0].section.as_deref(), Some("Plan"));
    assert!(is_as_drafted(&entries[0]));
    assert_eq!(entries[1].sources[0].section.as_deref(), Some("Budget"));
    assert_eq!(entries[1].evidence, ["- c"]);
    assert_eq!(entries[2].sources[0].section, None);
    assert_eq!(entries[2].point.as_deref(), Some("Questions?"));
    assert_eq!(
        entries[3].sources[0].section, None,
        "it says something else than the heading it is called after"
    );
}
