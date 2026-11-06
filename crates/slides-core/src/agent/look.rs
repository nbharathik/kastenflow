//! Looking before and after: the changes `render_slide` may be given to draw
//! a slide as it would be (never written), and `render_diff`, which draws a
//! slide before and after a change, side by side, with what changed outlined.
//! The drawing is the store's; this only decides what is drawn and what differs.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::read::slide_id;
use super::session::Agent;
use super::store::{Compare, DeckText, Store, StoreError};
use super::{Image, ToolError, ToolOutput, ToolResult};
use crate::canonical;
use crate::model::{Deck, Element, Slide};
use crate::ops::Engine;
use crate::resolve::box_of;

/// The most operations a proposed change holds.
const MOST_OPERATIONS: usize = 200;

/// `step`: the click a slide is drawn at, counting from 0; none for the slide as it ends.
pub(super) fn step_of(args: &Value) -> Result<Option<u32>, ToolError> {
    match args.get("step").filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => v.as_u64().and_then(|n| u32::try_from(n).ok()).map(Some).ok_or_else(|| {
            ToolError::new("`step` is a whole number counting from 0: the click the slide is drawn at. Leave it out for the slide as it ends.")
        }),
    }
}

/// `scale`: the pixels to each unit of the slide, 0.25 to 4; 1 when left out.
pub(super) fn scale_of(args: &Value) -> Result<f32, ToolError> {
    match args.get("scale").filter(|v| !v.is_null()) {
        None => Ok(1.0),
        Some(v) => v
            .as_f64()
            .filter(|s| (0.25..=4.0).contains(s))
            .map(|s| s as f32)
            .ok_or_else(|| {
                ToolError::new("`scale` is the pixels to each unit of the slide, from 0.25 to 4; 1 is the default.")
            }),
    }
}

/// What a store that could not draw says, with what is left to see with.
pub(super) fn drawing_error(e: StoreError) -> ToolError {
    match e {
        // Where nothing draws (no browser, or a build without the page it draws with), lint is what is left to see with.
        StoreError::Unavailable(m)
            if m.contains("Chrome")
                || m.contains("not available")
                || m.contains("does not carry the page") =>
        {
            // A store that says only "not available" is told what drawing needs.
            let needs = if m.contains("in this build") {
                " Slides are drawn by the open KastenFlow app, or by a program that finds Chrome, Chromium or Edge."
            } else {
                ""
            };
            ToolError::new(format!(
                "{m}{needs} Use lint_deck to find layout problems (overlaps, text that overflows, contrast), and ask the person to look at the deck in KastenFlow Slides."
            ))
        }
        StoreError::Unavailable(m) => ToolError::new(m),
        other => other.into(),
    }
}

/// The deck with the changes a call proposes (`elements` added to `slide`, then `operations`
/// as `update_elements` takes them) made to a copy, or None when it proposes none. Nothing is saved.
pub(super) fn proposed(
    deck: &Deck,
    slide: &str,
    args: &Value,
    seed: u64,
) -> Result<Option<Deck>, ToolError> {
    let elements = args.get("elements").filter(|v| !v.is_null());
    let operations = args.get("operations").filter(|v| !v.is_null());
    if elements.is_none() && operations.is_none() {
        return Ok(None);
    }
    let mut list: Vec<(String, Value)> = Vec::new();
    if let Some(operations) = operations {
        let items = operations.as_array().ok_or_else(|| {
            ToolError::new("`operations` is a list of {\"op\": name, \"input\": {...}}, as update_elements takes it.")
        })?;
        for item in items {
            let op = item.get("op").and_then(Value::as_str).ok_or_else(|| {
                ToolError::new("Each of `operations` is {\"op\": name, \"input\": {...}}.")
            })?;
            list.push((
                op.to_owned(),
                item.get("input").cloned().unwrap_or_else(|| json!({})),
            ));
        }
    }
    if let Some(elements) = elements {
        if !elements.is_array() {
            return Err(ToolError::new(
                "`elements` is a list of elements, as add_elements takes it.",
            ));
        }
        list.push((
            "add_elements".to_owned(),
            json!({ "slide": slide, "elements": elements }),
        ));
    }
    if list.is_empty() || list.len() > MOST_OPERATIONS {
        return Err(ToolError::new(format!(
            "Propose between 1 and {MOST_OPERATIONS} changes."
        )));
    }
    let mut engine = Engine::new(deck.clone(), seed);
    apply_all(&mut engine, list)?;
    Ok(Some(engine.into_deck()))
}

/// The box of an element, as whole slide units.
fn mark(deck: &Deck, slide: &Slide, element: &Element) -> Option<[f64; 4]> {
    box_of(&deck.theme, slide, element)
        .map(|r| [r.x.round(), r.y.round(), r.w.round(), r.h.round()])
}

/// The boxes that differ between a slide before and after: what changed on each side.
fn marks(before: &Deck, b: &Slide, after: &Deck, a: &Slide) -> (Vec<[f64; 4]>, Vec<[f64; 4]>) {
    let (mut gone, mut came) = (Vec::new(), Vec::new());
    for element in &a.elements {
        let same = b.elements.iter().find(|old| old.id() == element.id());
        if same != Some(element) {
            came.extend(mark(after, a, element));
        }
    }
    for element in &b.elements {
        let same = a.elements.iter().find(|new| new.id() == element.id());
        if same != Some(element) {
            gone.extend(mark(before, b, element));
        }
    }
    (gone, came)
}

/// Whether anything but the elements of the slide differs: its layout, background, notes, steps.
fn slide_level_change(before: &Deck, b: &Slide, after: &Deck, a: &Slide) -> bool {
    let bare = |s: &Slide| {
        let mut s = s.clone();
        s.elements.clear();
        s
    };
    bare(a) != bare(b) || before.theme != after.theme || before.size != after.size
}

/// The version of the deck the call names with `before`, or the one before this one.
fn earlier(
    store: &mut dyn Store,
    name: &str,
    now: &DeckText,
    given: Option<&str>,
) -> Result<DeckText, ToolError> {
    let found = match given {
        Some(hash) if hash == now.hash => Some(now.clone()),
        Some(hash) => store.earlier_version(name, Some(hash), &now.hash),
        None => store.earlier_version(name, None, &now.hash),
    };
    found.ok_or_else(|| match given {
        Some(hash) => ToolError::new(format!(
            "The version {hash} of `{name}` is not kept here (only the last few this server read or wrote are). Use render_slide now, change the slide, then render_diff with the hash render_slide gave."
        )),
        None => ToolError::new(format!(
            "There is no earlier version of `{name}` to compare with: it has not changed since it was first read here. Give `elements` or `operations` to see a change before you write it, or `before` with a deck hash."
        )),
    })
}

pub fn render_diff(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (now, current) = agent.read(store, &name)?;
    let id = slide_id(&current, args.get("slide").unwrap_or(&Value::Null))?;
    let (step, scale) = (step_of(args)?, scale_of(args)?);
    let given = args
        .get("before")
        .and_then(Value::as_str)
        .and_then(|b| b.trim().split(':').next())
        .map(str::trim)
        .filter(|b| !b.is_empty());
    let seed = store.entropy();
    let proposal = proposed(&current, &id, args, seed)?;
    let (before_text, before_deck) = match (&proposal, given) {
        (Some(_), None) => (now.clone(), current.clone()),
        _ => {
            let text = earlier(store, &name, &now, given)?;
            let deck = canonical::parse(&text.text)
                .map_err(|e| ToolError::new(format!("The earlier version cannot be read: {e}")))?;
            (text, deck)
        }
    };
    let after_deck = proposal.as_ref().unwrap_or(&current);
    let place = |deck: &Deck| deck.slides.iter().position(|s| s.id == id);
    let (Some(before_slide), Some(after_slide)) = (place(&before_deck), place(after_deck)) else {
        return Err(ToolError::new(
            "That slide is not in both versions (it was added or taken away), so there is nothing to put side by side. Use render_slide to look at it.",
        ));
    };
    let (gone, came) = marks(
        &before_deck,
        &before_deck.slides[before_slide],
        after_deck,
        &after_deck.slides[after_slide],
    );
    let level = slide_level_change(
        &before_deck,
        &before_deck.slides[before_slide],
        after_deck,
        &after_deck.slides[after_slide],
    );
    let compare = Compare {
        before: &before_deck,
        after: after_deck,
        before_slide,
        after_slide,
        step,
        scale,
        before_marks: gone.clone(),
        after_marks: came.clone(),
    };
    let drawn = store.draw_compare(&compare).map_err(drawing_error)?;
    let nothing = gone.is_empty() && came.is_empty() && !level;
    let (after_label, note) = if proposal.is_some() {
        (
            "proposed".to_owned(),
            "Before is on the left and the proposed slide on the right; the boxes that changed are outlined. Nothing was written.",
        )
    } else if nothing {
        (
            now.hash.clone(),
            "The two versions of this slide are the same.",
        )
    } else {
        (
            now.hash.clone(),
            "Before is on the left, after on the right; the boxes that changed are outlined.",
        )
    };
    let answer = json!({
        "deck": name,
        "slide": id,
        "number": after_slide + 1,
        "step": step,
        "before": before_text.hash,
        "after": after_label,
        "proposed": proposal.is_some(),
        "outlined": { "before": gone.len(), "after": came.len() },
        "slideLevelChange": level,
        "width": drawn.width,
        "height": drawn.height,
        "warnings": drawn.warnings,
        "note": note,
    });
    let mut out = ToolOutput::json(answer);
    out.images.push(Image {
        mime: "image/png".to_owned(),
        bytes: drawn.png,
    });
    Ok(out)
}
