//! A note as a plan for slides: what each heading becomes, what goes on the
//! slide and what is left for the speaker notes.

use kasten_core::agent::ChangeSet;
use kasten_core::extract::extract;
use kasten_core::frontmatter::split;
use kasten_core::{Kasten, NoteFile};
use slides_core::lint::Refs;

use super::body::{Body, fitted, joined, sections, slide_level};
use super::text::{Picture, first_sentence, plain};

/// The longest a line of the slide made of prose is, in characters.
const LINE_CHARS: usize = 110;
/// The most slides one deck gets.
pub(super) const MOST_SLIDES: usize = 40;
/// The most notes a deck follows links to, and the most slides each of them gives.
const MOST_LINKED: usize = 6;
const LINKED_SLIDES: usize = 4;

/// One slide that will be made.
#[derive(Debug, Clone, Default)]
pub(super) struct Planned {
    pub title: String,
    /// Markdown lines of the list, nested ones indented by two spaces.
    pub lines: Vec<String>,
    /// Speaker notes, in Markdown.
    pub notes: String,
    /// A layout named on purpose; none lets the outline choose.
    pub layout: Option<&'static str>,
    /// The picture of a picture slide, its `src` a path in the vault.
    pub picture: Option<Picture>,
    /// Citation keys the vault knows.
    pub keys: Vec<String>,
}

/// What the note gives before its first heading.
#[derive(Debug, Clone, Default)]
pub(super) struct NotePlan {
    pub title: String,
    pub lead: String,
    pub slides: Vec<Planned>,
    pub warnings: Vec<String>,
}

/// The whole deck.
#[derive(Debug, Clone, Default)]
pub(super) struct Plan {
    pub title: String,
    pub subtitle: String,
    pub cover_notes: String,
    pub slides: Vec<Planned>,
    pub warnings: Vec<String>,
    /// The notes it was made from, the first being the one asked for.
    pub from: Vec<String>,
}

/// What a plan is made with.
pub(super) struct Source<'a> {
    pub kasten: &'a Kasten,
    pub refs: Option<&'a Refs>,
    /// A chat's staged changes, which a note, a link and a picture are read
    /// through when the chat previews its changes.
    pub staged: Option<&'a ChangeSet>,
}

impl Source<'_> {
    pub(super) fn read(&self, path: &str) -> kasten_core::Result<NoteFile> {
        match self.staged {
            Some(set) => self.kasten.read_in(set, path),
            None => self.kasten.read(path),
        }
    }

    pub(super) fn resolve(&self, reference: &str) -> kasten_core::Result<String> {
        match self.staged {
            Some(set) => self.kasten.resolve_staged(set, reference),
            None => self.kasten.resolve(reference),
        }
    }

    /// A picture of `assets/`, kept or staged.
    pub(super) fn asset(&self, path: &str) -> kasten_core::Result<Vec<u8>> {
        if let Some(set) = self.staged
            && let Some(bytes) = self.kasten.staged_asset_bytes(set, path)?
        {
            return Ok(bytes);
        }
        self.kasten.read_asset(path)
    }
}

fn normalized(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

/// Where a picture named in a note is in the vault: beside the note, from the vault's root, or by its name in `assets/`.
pub(super) fn picture_path(source: &Source, note: &str, src: &str) -> Option<String> {
    if src.contains("://") || src.starts_with("data:") {
        return None;
    }
    let src = src.trim();
    let folder = note.rsplit_once('/').map_or("", |(dir, _)| dir);
    let name = src.rsplit('/').next().unwrap_or(src);
    let mut tries = vec![normalized(&format!("{folder}/{src}")), normalized(src)];
    for candidate in [name.to_owned(), name.to_ascii_lowercase().replace(' ', "-")] {
        tries.push(Some(format!("assets/{candidate}")));
    }
    tries
        .into_iter()
        .flatten()
        .find(|path| source.asset(path).is_ok())
}

fn words_of(lines: &[String]) -> String {
    let body = Body::read(lines);
    joined(&body.prose)
}

/// The slides a note gives, at most `most`.
pub(super) fn of_note(source: &Source, path: &str, most: usize) -> Result<NotePlan, String> {
    let note: NoteFile = source.read(path).map_err(|e| e.to_string())?;
    let title = note.meta.title.trim().to_owned();
    let found = sections(split(&note.text).body);
    let mut plan = NotePlan {
        title: title.clone(),
        lead: found
            .first()
            .map(|s| words_of(&s.lines))
            .unwrap_or_default(),
        ..NotePlan::default()
    };
    let Some(level) = slide_level(&found) else {
        // No headings: the note is one slide, its list or first sentence on it.
        let lead = found
            .first()
            .map(|s| Body::read(&s.lines))
            .unwrap_or_default();
        plan.slides
            .push(slide(source, path, "Overview", &lead, &mut plan.warnings));
        plan.slides.truncate(most);
        return Ok(plan);
    };
    // A heading above the slides' level (the note's own title) holds words of the lead.
    let mut slides: Vec<(String, Vec<String>)> = Vec::new();
    for section in found.iter().skip(1) {
        if section.level < level {
            plan.lead = joined(&[plan.lead.clone(), words_of(&section.lines)]);
        } else if section.level == level || slides.is_empty() {
            slides.push((section.title.clone(), section.lines.clone()));
        } else if let Some((_, lines)) = slides.last_mut() {
            lines.push(format!("- **{}**", section.title));
            lines.extend(section.lines.iter().cloned());
        }
    }
    for (name, lines) in slides {
        if is_references(&name) {
            continue;
        }
        let body = Body::read(&lines);
        let main = slide(source, path, &name, &body, &mut plan.warnings);
        let keys = main.keys.clone();
        plan.slides.push(main);
        for (n, picture) in body.pictures.iter().enumerate() {
            let Some(src) = picture_path(source, path, &picture.src) else {
                plan.warnings.push(format!(
                    "Left out the picture `{}` of “{name}”: it is not a picture in the vault's assets/ folder.",
                    picture.src
                ));
                continue;
            };
            let words = if picture.alt.is_empty() {
                format!("{name}, figure {}", n + 1)
            } else {
                plain(&picture.alt)
            };
            plan.slides.push(Planned {
                title: words.clone(),
                layout: Some("image-caption"),
                picture: Some(Picture { alt: words, src }),
                keys: keys.clone(),
                ..Planned::default()
            });
        }
    }
    plan.slides.truncate(most);
    Ok(plan)
}

fn is_references(title: &str) -> bool {
    matches!(
        title
            .trim()
            .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ')
            .to_lowercase()
            .as_str(),
        "references" | "bibliography" | "sources" | "works cited"
    )
}

/// The slide for one heading.
fn slide(
    source: &Source,
    _note: &str,
    name: &str,
    body: &Body,
    warnings: &mut Vec<String>,
) -> Planned {
    let (mut lines, spare) = fitted(&body.lines);
    let mut notes = body.prose.clone();
    if lines.is_empty()
        && let Some(first) = body
            .prose
            .iter()
            .find(|p| !p.is_empty() && !p.starts_with("```"))
    {
        lines.push(format!("- {}", first_sentence(first, LINE_CHARS * 2)));
    }
    if !spare.is_empty() {
        notes.push(String::new());
        notes.push(format!("More: {}", spare.join("; ")));
    }
    let mut keys = Vec::new();
    for key in &body.keys {
        match source.refs {
            Some(refs) if !refs.contains(key) => warnings.push(format!(
                "“{name}” cites `{key}`, which no .bib file of the vault has, so it is not cited on the slide."
            )),
            _ => keys.push(key.clone()),
        }
    }
    Planned {
        title: name.to_owned(),
        layout: lines.is_empty().then_some("section"),
        lines,
        notes: joined(&notes),
        picture: None,
        keys,
    }
}

/// The deck for a note, and for the notes it links to when `linked`.
pub(super) fn of_deck(source: &Source, path: &str, linked: bool) -> Result<Plan, String> {
    let main = of_note(source, path, MOST_SLIDES - 1)?;
    let mut plan = Plan {
        title: main.title.clone(),
        subtitle: first_sentence(&main.lead, 150),
        cover_notes: main.lead.clone(),
        slides: main.slides.clone(),
        warnings: main.warnings.clone(),
        from: vec![path.to_owned()],
    };
    if linked {
        let note = source.read(path).map_err(|e| e.to_string())?;
        let mut seen = vec![path.to_owned()];
        for link in extract(split(&note.text).body)
            .links
            .iter()
            .filter(|l| !l.embed)
        {
            if seen.len() > MOST_LINKED {
                plan.warnings
                    .push("Followed only the first six links.".to_owned());
                break;
            }
            let Ok(target) = source.resolve(&link.target) else {
                plan.warnings
                    .push(format!("Did not follow [[{}]]: no such note.", link.target));
                continue;
            };
            if seen.contains(&target) {
                continue;
            }
            seen.push(target.clone());
            let other = of_note(source, &target, LINKED_SLIDES)?;
            let lines = if other.lead.is_empty() {
                Vec::new()
            } else {
                vec![format!("- {}", first_sentence(&other.lead, 150))]
            };
            plan.slides.push(Planned {
                title: other.title.clone(),
                lines,
                notes: other.lead.clone(),
                layout: Some("section"),
                ..Planned::default()
            });
            plan.slides.extend(other.slides);
            plan.warnings.extend(other.warnings);
            plan.from.push(target);
        }
    }
    if plan.slides.len() > MOST_SLIDES - 1 {
        plan.warnings.push(format!(
            "The deck has room for {MOST_SLIDES} slides; the rest of the note was left out."
        ));
        plan.slides.truncate(MOST_SLIDES - 1);
    }
    Ok(plan)
}
