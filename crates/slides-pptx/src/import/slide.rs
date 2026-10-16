//! A slide part turned into a slide of the deck: the shapes it draws over the
//! shapes of its layout, its background, notes, transition and whether it is hidden.

use slides_core::{Background, Element, Slide, Transition, TransitionKind};

use super::color::ColorMap;
use super::cx::{Cx, Env, Importer, PartCx};
use super::dom::{Child as DomChild, Node};
use super::notes;
use super::shapes;
use super::shapes::style::paint_of;

/// Locks a list of elements: the shapes of a layout are not the slide's to move.
fn lock(list: &mut [Element]) {
    for e in list {
        e.base_mut().locked = true;
        if let Some(children) = e.children_mut() {
            lock(children);
        }
    }
}

/// Converts loose shapes of a layout or master into elements of a slide.
fn convert_shapes(imp: &mut Importer, env: &Env, part: &PartCx, nodes: &[Node]) -> Vec<Element> {
    let holder = Node {
        name: "p:spTree".to_owned(),
        attrs: Vec::new(),
        children: nodes.iter().cloned().map(DomChild::Node).collect(),
    };
    let mut cx = Cx::new(imp, env, part);
    let mut elements = shapes::children(&mut cx, &holder);
    shapes::join_connectors(&mut cx, &mut elements);
    elements
}

/// The layout as a part being read; `slide` is the slide a warning is about, none for the layout itself.
fn part_of_layout(env: &Env, layout: usize, slide: Option<&str>) -> PartCx {
    let info = &env.layouts[layout];
    PartCx {
        name: info.part.clone(),
        rels: info.rels.clone(),
        declarations: Vec::new(),
        map: info.map.clone(),
        slide: slide.map(str::to_owned),
        layout: Some(layout),
        in_master: true,
    }
}

fn part_of_master(env: &Env, master: usize, slide: Option<&str>) -> PartCx {
    let info = &env.masters[master];
    PartCx {
        name: info.part.clone(),
        rels: info.rels.clone(),
        declarations: Vec::new(),
        map: info.map.clone(),
        slide: slide.map(str::to_owned),
        layout: None,
        in_master: true,
    }
}

/// A shape as it is drawn, whatever numbers or identifiers the program that saved it gave its parts.
fn without_ids(node: &Node) -> Node {
    let mut copy = node.clone();
    copy.attrs.retain(|(k, _)| k != "id");
    copy.children = copy
        .children
        .iter()
        .map(|c| match c {
            DomChild::Node(n) => DomChild::Node(without_ids(n)),
            text => text.clone(),
        })
        .collect();
    copy
}

/// The shapes a layout (and, for a master other than the first, its master) draws under a slide's
/// own, converted once for the layout: they become the layout's own decoration, and a slide of the
/// layout keeps only the shapes it has itself.
fn decoration(imp: &mut Importer, env: &Env, layout: usize) -> Vec<Element> {
    let info = &env.layouts[layout];
    let mut out = Vec::new();
    // A program that saves one master per layout (LibreOffice does) repeats the first master's shapes.
    let repeats_first = env
        .masters
        .get(info.master)
        .zip(env.masters.first())
        .is_some_and(|(m, first)| {
            m.decorations.len() == first.decorations.len()
                && m.decorations
                    .iter()
                    .zip(&first.decorations)
                    .all(|(a, b)| without_ids(a) == without_ids(b))
        });
    if info.master != 0 && !info.hide_master && !repeats_first {
        let part = part_of_master(env, info.master, None);
        out.extend(convert_shapes(
            imp,
            env,
            &part,
            &env.masters[info.master].decorations,
        ));
    }
    let part = part_of_layout(env, layout, None);
    out.extend(convert_shapes(imp, env, &part, &info.decorations));
    out
}

/// What each layout of the file draws, in the order of the layouts: one list of elements for each.
pub fn layout_decorations(imp: &mut Importer, env: &Env) -> Vec<Vec<Element>> {
    (0..env.layouts.len())
        .map(|layout| decoration(imp, env, layout))
        .collect()
}

/// The elements a master draws on every slide, for the theme.
pub fn master_elements(imp: &mut Importer, env: &Env) -> Vec<Element> {
    let Some(master) = env.masters.first() else {
        return Vec::new();
    };
    let part = part_of_master(env, 0, None);
    let mut out = convert_shapes(imp, env, &part, &master.decorations);
    lock(&mut out);
    out
}

/// What a background node (`p:bg`) fills the slide with, if it is not the theme's plain page.
fn background(cx: &mut Cx, bg: &Node) -> Option<Background> {
    let (fill, placeholder) = if let Some(pr) = bg.child("p:bgPr") {
        (
            pr.elements().find(|n| n.name.ends_with("Fill")).cloned(),
            None,
        )
    } else if let Some(r) = bg.child("p:bgRef") {
        let idx = r.int("idx")?;
        let paint = cx.colors().first(r, None);
        let node = usize::try_from(idx - 1001)
            .ok()
            .and_then(|i| cx.env.theme.format.backgrounds.get(i).cloned());
        (node, paint)
    } else {
        (None, None)
    };
    let fill = fill?;
    if fill.name == "a:blipFill" {
        let rel = fill
            .child("a:blip")
            .and_then(|b| b.attr("r:embed"))
            .and_then(|id| cx.part.rels.get(id))
            .cloned()?;
        let part = cx.imp.pkg.target(&cx.part.name, &rel)?;
        return match cx.imp.media.picture(&mut cx.imp.pkg, &part) {
            Ok(picture) => Some(Background {
                color: None,
                image: Some(picture.src),
                extra: slides_core::Extra::new(),
            }),
            Err(why) => {
                cx.warn_slide(format!("a background picture was left out: {why}"));
                None
            }
        };
    }
    let paint = paint_of(cx, &fill, placeholder.as_ref())?;
    (paint.value != "bg1").then_some(Background {
        color: Some(paint.value),
        image: None,
        extra: slides_core::Extra::new(),
    })
}

/// The background a slide has: its own, else its layout's, else its master's.
fn effective_background(
    imp: &mut Importer,
    env: &Env,
    layout: usize,
    own: Option<(&PartCx, &Node)>,
    slide: &str,
) -> Option<Background> {
    if let Some((part, bg)) = own {
        let mut cx = Cx::new(imp, env, part);
        return background(&mut cx, bg);
    }
    let info = &env.layouts[layout];
    if let Some(bg) = &info.background {
        let part = part_of_layout(env, layout, Some(slide));
        let mut cx = Cx::new(imp, env, &part);
        return background(&mut cx, bg);
    }
    let master = env.masters.get(info.master)?;
    let bg = master.background.as_ref()?;
    let part = part_of_master(env, info.master, Some(slide));
    let mut cx = Cx::new(imp, env, &part);
    background(&mut cx, bg)
}

fn find<'a>(node: &'a Node, name: &str) -> Option<&'a Node> {
    if node.name == name {
        return Some(node);
    }
    node.elements().find_map(|n| find(n, name))
}

fn transition(root: &Node) -> Option<Transition> {
    let t = find(root, "p:transition")?;
    let kind = match t.elements().next()?.name.as_str() {
        "p:fade" => TransitionKind::Fade,
        "p:cut" | "p:none" => return None,
        "p159:morph" => TransitionKind::Morph,
        _ => TransitionKind::Slide,
    };
    let seconds = t
        .int("p14:dur")
        .map(|ms| ms as f64 / 1000.0)
        .or_else(|| match t.attr("spd") {
            Some("slow") => Some(1.0),
            Some("fast") => Some(0.5),
            _ => None,
        })
        .filter(|d| (0.05..=10.0).contains(d));
    Some(Transition {
        kind,
        duration: seconds,
        easing: None,
        extra: slides_core::Extra::new(),
    })
}

/// Converts the slide in `part` into the slide `id`.
pub fn convert(imp: &mut Importer, env: &Env, part: &str, id: &str, keep_markers: bool) -> Slide {
    let rels = imp.pkg.rels_of(part);
    let layout = rels
        .of_kind("slideLayout")
        .find_map(|r| imp.pkg.target(part, r))
        .and_then(|p| env.layout_index.get(&p).copied());
    let (layout, known) = match layout {
        Some(i) => (i, true),
        None => (0, false),
    };
    let name = env
        .layout_names
        .get(layout)
        .cloned()
        .unwrap_or_else(|| "blank".to_owned());
    let mut slide = Slide::new(id, name);
    if !known {
        imp.warnings.warn(
            Some(id),
            None,
            "the slide's layout could not be found; the first layout stands in",
        );
    }
    let doc = match imp.pkg.dom(part) {
        Ok(doc) => doc,
        Err(e) => {
            imp.warnings.warn(
                Some(id),
                None,
                format!("the slide could not be read and is empty: {}", e.message()),
            );
            return slide;
        }
    };
    let root = &doc.root;

    let mut elements = Vec::new();
    let map = root
        .at(&["p:clrMapOvr", "a:overrideClrMapping"])
        .map(ColorMap::from_node)
        .or_else(|| env.layouts.get(layout).map(|l| l.map.clone()))
        .unwrap_or_default();
    let pcx = PartCx {
        name: part.to_owned(),
        rels,
        declarations: doc.declarations.clone(),
        map,
        slide: Some(id.to_owned()),
        layout: env.layouts.get(layout).map(|_| layout),
        in_master: false,
    };
    let own_bg = root.at(&["p:cSld", "p:bg"]);
    slide.background = if env.layouts.is_empty() {
        None
    } else {
        effective_background(imp, env, layout, own_bg.map(|b| (&pcx, b)), id)
    };
    if root.flag("showMasterSp") == Some(false) {
        imp.warnings.warn(
            Some(id),
            None,
            "\"hide background graphics\" on a slide is not kept; the layout's graphics are shown",
        );
    }
    if let Some(tree) = root.at(&["p:cSld", "p:spTree"]) {
        let mut cx = Cx::new(imp, env, &pcx);
        let mut own = shapes::children(&mut cx, tree);
        shapes::join_connectors(&mut cx, &mut own);
        elements.extend(own);
    }
    slide.elements = elements;
    slide.hidden = root.attr("show") == Some("0");
    slide.transition = transition(root);
    if find(root, "p:timing").is_some_and(|t| t.elements().next().is_some()) {
        imp.warnings
            .warn(Some(id), None, "the slide's animations were not imported");
    }

    let notes_text = pcx
        .rels
        .of_kind("notesSlide")
        .find_map(|r| imp.pkg.target(part, r))
        .and_then(|n| imp.pkg.dom(&n).ok())
        .map(|d| notes::read(&d.root))
        .unwrap_or_default();
    let (text, marker) = crate::markers::strip(&notes_text);
    slide.notes = text;
    if let Some(m) = marker {
        if m.backup {
            slide.backup = true;
            slide.hidden = false;
        }
        if keep_markers {
            slide.extra.insert(
                "pptxMarker".to_owned(),
                serde_json::json!({ "slide": m.slide, "step": m.step.map(|(k, n)| [k, n]), "backup": m.backup }),
            );
        }
    }
    if pcx.rels.of_kind("comments").next().is_some() {
        imp.warnings
            .warn(Some(id), None, "the slide's comments were not imported");
    }
    slide
}
