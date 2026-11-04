//! Pictures that come from elsewhere in the store: a draw.io diagram put on a slide in one call, and a picture swapped
//! for another everywhere a deck uses it.

use serde_json::{Value, json};

use super::edit::apply_all;
use super::place;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolResult};
use crate::model::Element;

/// The arguments that say where a picture goes; without any, `place_diagram` takes the largest free space.
const WHERE: [&str; 4] = ["placeholder", "box", "auto", "id"];

fn path_arg<'a>(args: &'a Value, key: &str, help: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ToolError::new(help))
}

/// Puts a draw.io diagram of the store on a slide: it is drawn as a picture, kept in the assets, and placed at its own
/// proportions. The picture remembers the diagram it came from.
pub fn place_diagram(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let diagram = path_arg(
        args,
        "diagram",
        "`diagram` is the draw.io diagram to place: its path or its title (list_diagrams shows them).",
    )?;
    let picture = store.diagram_picture(diagram)?;
    let src = store.add_asset(&picture.name, &picture.bytes)?;
    let mut forwarded = args.clone();
    if let Some(map) = forwarded.as_object_mut() {
        map.insert("src".to_owned(), json!(src));
        map.insert("diagram".to_owned(), json!(picture.diagram));
        map.insert("diagramHash".to_owned(), json!(picture.hash));
        if !map.contains_key("alt") {
            let stem = picture.name.strip_suffix(".svg").unwrap_or(&picture.name);
            map.insert("alt".to_owned(), json!(format!("Diagram: {stem}")));
        }
        if !WHERE
            .iter()
            .any(|key| map.get(*key).is_some_and(|v| !v.is_null()))
        {
            map.insert("auto".to_owned(), json!(true));
        }
    }
    let mut out = place::place_image(agent, store, &forwarded)?;
    if let Some(Value::Object(data)) = &mut out.data {
        data.insert("diagram".to_owned(), json!(picture.diagram));
        data.insert("asset".to_owned(), json!(src));
    }
    if let Some(data) = &out.data {
        out.text = serde_json::to_string_pretty(data).unwrap_or_default();
    }
    Ok(out)
}

/// Where a picture is used, and what to patch to swap it.
#[derive(Default)]
struct Uses {
    /// The patches of the elements that use it: {id, patch}.
    patches: Vec<Value>,
    pictures: usize,
    posters: usize,
}

fn uses(list: &[Element], from: &str, to: &str, found: &mut Uses) {
    for e in list {
        let mut patch = serde_json::Map::new();
        match e {
            Element::Image(i) if i.src == from => {
                patch.insert("src".to_owned(), json!(to));
                found.pictures += 1;
            }
            Element::Video(v) => {
                if v.src == from {
                    patch.insert("src".to_owned(), json!(to));
                    found.pictures += 1;
                }
                if v.poster.as_deref() == Some(from) {
                    patch.insert("poster".to_owned(), json!(to));
                    found.posters += 1;
                }
            }
            Element::Embed(m) if m.poster.as_deref() == Some(from) => {
                patch.insert("poster".to_owned(), json!(to));
                found.posters += 1;
            }
            _ => {}
        }
        if !patch.is_empty() {
            found
                .patches
                .push(json!({ "id": e.id(), "patch": Value::Object(patch) }));
        }
        uses(e.children(), from, to, found);
    }
}

/// Swaps a picture for another everywhere the deck uses it: pictures on the slides (in groups too), the stills of videos
/// and web pages, and slide backgrounds. Nothing is deleted: the old picture stays in the store.
pub fn replace_asset(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let from = path_arg(
        args,
        "from",
        "`from` is the picture to replace, such as assets/old.png (search_assets lists the pictures).",
    )?;
    let to = path_arg(
        args,
        "to",
        "`to` is the picture to use instead, such as assets/new.png (add_asset puts a new one in the store).",
    )?;
    if from == to {
        return Err(ToolError::new(
            "`from` and `to` are the same picture, so there is nothing to replace.",
        ));
    }
    store.read_asset(to).map_err(|_| {
        ToolError::new(format!(
            "There is no picture `{to}`. search_assets lists the pictures there are; add_asset puts a new one in the store."
        ))
    })?;
    let edited = agent.edit(store, &name, None, |engine| {
        let mut operations = Vec::new();
        let (mut pictures, mut posters, mut backgrounds) = (0, 0, 0);
        for slide in &engine.deck().slides {
            let mut found = Uses::default();
            uses(&slide.elements, from, to, &mut found);
            (pictures, posters) = (pictures + found.pictures, posters + found.posters);
            if !found.patches.is_empty() {
                operations.push((
                    "patch_elements".to_owned(),
                    json!({ "slide": slide.id, "patches": found.patches }),
                ));
            }
            if let Some(background) = &slide.background
                && background.image.as_deref() == Some(from)
            {
                let mut value = serde_json::to_value(background).unwrap_or(Value::Null);
                value["image"] = json!(to);
                operations.push((
                    "set_background".to_owned(),
                    json!({ "slide": slide.id, "background": value }),
                ));
                backgrounds += 1;
            }
        }
        // The master and the layouts are the editor's; they are counted so the agent can say so.
        let mut in_theme = Uses::default();
        let theme = &engine.deck().theme;
        uses(&theme.master, from, to, &mut in_theme);
        for layout in &theme.layouts {
            uses(&layout.elements, from, to, &mut in_theme);
        }
        let left = in_theme.pictures + in_theme.posters;
        let note = if pictures + posters + backgrounds == 0 {
            format!("No slide of the deck uses `{from}`.")
        } else if left > 0 {
            format!("{left} use(s) in the master or a layout were left: they are changed in the editor. Nothing is deleted: `{from}` is still in the store.")
        } else {
            format!("Nothing is deleted: `{from}` is still in the store.")
        };
        apply_all(engine, operations)?;
        Ok(json!({
            "from": from,
            "to": to,
            "pictures": pictures,
            "posters": posters,
            "backgrounds": backgrounds,
            "inTheme": left,
            "note": note,
        }))
    })?;
    agent.answer(store, &edited, json!({}))
}
