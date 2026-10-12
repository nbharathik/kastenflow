//! The deck's theme, made from the first master: its colours and fonts, the
//! text styles its title and body styles are, and a layout for each of the
//! file's layouts with the slots its placeholders are.

use std::collections::HashSet;

use slides_core::{
    Colors, Extra, FontSpec, Fonts, Highlight, Layout, ListKind, PlaceholderDef, PlaceholderKind,
    Theme, VAlign,
};

use super::color::{ColorCx, ColorMap};
use super::master::{LayoutInfo, MasterInfo, PhClass, PhShape};
use super::styles::{StyleBook, text_style};
use super::text::body::BodyProps;
use super::text::chain::Chain;
use super::text::levels::{Bullet, Levels};
use super::themefile::ThemeFile;

/// What the theme is made of, beyond the theme itself.
pub struct Built {
    pub theme: Theme,
    pub styles: StyleBook,
    /// The name each layout has, index for index with the layouts given.
    pub names: Vec<String>,
}

/// A layout name from a label: `Title + body` is `title-body`.
pub fn slug(label: &str) -> String {
    let mut out = String::new();
    for c in label.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_owned()
}

/// The fonts a family falls back to, so the editor draws something like it where it is missing.
fn fallbacks(family: &str) -> Vec<String> {
    let list: &[&str] = match family.to_ascii_lowercase().as_str() {
        "calibri" => &["Carlito", "Arial", "sans-serif"],
        "arial" => &["Liberation Sans", "Helvetica", "sans-serif"],
        "cambria" => &["Caladea", "Georgia", "serif"],
        "times new roman" => &["Liberation Serif", "Times", "serif"],
        "courier new" => &["Liberation Mono", "monospace"],
        _ => match crate::fonts::kind_of(&[family]) {
            crate::fonts::Kind::Sans => &["Helvetica Neue", "Arial", "sans-serif"],
            crate::fonts::Kind::Serif => &["Georgia", "serif"],
            crate::fonts::Kind::Mono => &["monospace"],
        },
    };
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn font(family: &str) -> FontSpec {
    FontSpec {
        family: family.to_owned(),
        fallback: fallbacks(family),
        extra: Extra::new(),
    }
}

/// The colours of the deck, as hex, from a theme file read through the master's mapping.
fn colors(file: &ThemeFile, map: &ColorMap) -> Colors {
    let cx = ColorCx {
        palette: &file.palette,
        map,
        deck_map: map,
    };
    let c = cx.deck_colors();
    let hex = |i: usize| c[i].1.to_hex();
    Colors {
        text1: hex(0),
        text2: hex(1),
        bg1: hex(2),
        bg2: hex(3),
        accent1: hex(4),
        accent2: hex(5),
        accent3: hex(6),
        accent4: hex(7),
        accent5: hex(8),
        accent6: hex(9),
        extra: Extra::new(),
    }
}

/// The monospace typeface the deck's text styles use, if any; the styles then name the `code` role instead.
fn code_family(styles: &mut StyleBook) -> Option<String> {
    let family = styles.styles.values().map(|s| s.font.clone()).find(|f| {
        !matches!(f.as_str(), "heading" | "body" | "code")
            && crate::fonts::kind_of(&[f]) == crate::fonts::Kind::Mono
    })?;
    for style in styles.styles.values_mut() {
        if style.font == family {
            style.font = "code".to_owned();
        }
    }
    Some(family)
}

/// The role a prompt such as "Click to add caption" names.
fn role_from_prompt(prompt: &str) -> Option<&'static str> {
    let word = prompt.trim().strip_prefix("Click to add ")?.trim();
    Some(match word {
        "caption" | "attribution" => "caption",
        "code" => "code",
        "quote" => "quote",
        "number" => "number",
        "label" => "label",
        "text" => "body",
        _ => return None,
    })
}

/// A name not yet used: `body`, then `body2`, `body3` ...
fn unique(base: &str, used: &mut HashSet<String>) -> String {
    let mut name = base.to_owned();
    let mut n = 2;
    while used.contains(&name) {
        name = format!("{base}{n}");
        n += 1;
    }
    used.insert(name.clone());
    name
}

/// The master's placeholder a layout's placeholder of a class inherits from.
pub fn master_ph(master: &MasterInfo, class: PhClass) -> Option<&PhShape> {
    let wanted = match class {
        PhClass::Subtitle | PhClass::Picture => PhClass::Body,
        other => other,
    };
    master.placeholders.iter().find(|p| p.class == wanted)
}

/// The layers a placeholder's text starts from, below its own list style.
pub fn chain_for(
    class: PhClass,
    layout: Option<&PhShape>,
    master: &MasterInfo,
    default_text: &Levels,
    shape_style: Option<Levels>,
) -> Chain {
    let styles = match class {
        PhClass::Title => &master.title,
        PhClass::Subtitle | PhClass::Body | PhClass::Picture => &master.body,
        _ => &master.other,
    };
    let mut chain = Chain::new();
    if let Some(l) = layout {
        chain = chain.below(l.lst.clone());
    }
    if let Some(m) = master_ph(master, class) {
        chain = chain.below(m.lst.clone());
    }
    // What the shape's own style says (its font colour) beats the defaults below it.
    if let Some(layer) = shape_style {
        chain = chain.below(layer);
    }
    chain.below(styles.clone()).below(default_text.clone())
}

/// The layers text that is not in a placeholder starts from.
pub fn chain_plain(
    master: &MasterInfo,
    default_text: &Levels,
    shape_style: Option<Levels>,
) -> Chain {
    let mut chain = Chain::new();
    if let Some(layer) = shape_style {
        chain = chain.below(layer);
    }
    chain
        .below(master.other.clone())
        .below(default_text.clone())
}

fn list_of(bullet: Option<Bullet>) -> Option<ListKind> {
    match bullet {
        Some(Bullet::Char) => Some(ListKind::Bullet),
        Some(Bullet::Number) => Some(ListKind::Number),
        _ => None,
    }
}

fn definition(
    ph: &mut PhShape,
    master: &MasterInfo,
    default_text: &Levels,
    size: (f64, f64),
    styles: &mut StyleBook,
    used: &mut HashSet<String>,
) -> PlaceholderDef {
    let base = match ph.class {
        PhClass::Title => "title",
        PhClass::Subtitle => "subtitle",
        PhClass::Picture => "image",
        _ => role_from_prompt(&ph.prompt).unwrap_or("body"),
    };
    let role = unique(base, used);
    let level = chain_for(ph.class, Some(ph), master, default_text, None).level(0);
    let single = [base];
    let names: &[&str] = match ph.class {
        PhClass::Title => &["title", "display"],
        PhClass::Subtitle => &["subtitle"],
        PhClass::Picture => &["caption"],
        _ => &single,
    };
    let style = styles.intern(names, text_style(&level));
    let inherited = master_ph(master, ph.class);
    let rect = ph
        .rect
        .or_else(|| inherited.and_then(|m| m.rect))
        .unwrap_or(match ph.class {
            PhClass::Title => slides_core::resolve::Rect {
                x: size.0 * 0.05,
                y: size.1 * 0.05,
                w: size.0 * 0.9,
                h: size.1 * 0.2,
            },
            _ => slides_core::resolve::Rect {
                x: size.0 * 0.05,
                y: size.1 * 0.3,
                w: size.0 * 0.9,
                h: size.1 * 0.6,
            },
        });
    let body: BodyProps = ph
        .body
        .over(&inherited.map(|m| m.body.clone()).unwrap_or_default());
    let def = PlaceholderDef {
        role: role.clone(),
        kind: if ph.class == PhClass::Picture {
            PlaceholderKind::Image
        } else {
            PlaceholderKind::Text
        },
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        style: Some(style.clone()),
        valign: Some(body.anchor.unwrap_or(VAlign::Top)),
        list: list_of(level.bullet),
        prompt: if ph.prompt.trim().is_empty() {
            format!("Click to add {role}")
        } else {
            ph.prompt.clone()
        },
        extra: Extra::new(),
    };
    ph.role = Some(role);
    ph.style = style;
    def
}

/// Makes the theme, and gives every placeholder of the layouts its role and style.
pub fn build(
    masters: &[MasterInfo],
    layouts: &mut [LayoutInfo],
    default_text: &Levels,
    size: (f64, f64),
) -> Built {
    let master = &masters[0];
    let file = &master.theme;
    let mut styles = StyleBook::empty();
    styles.set(
        "title",
        text_style(&master.title.level(0).over(&default_text.level(0))),
    );
    styles.set(
        "body",
        text_style(&master.body.level(0).over(&default_text.level(0))),
    );
    // Text outside a placeholder starts from the master's other style, when that is not the body's look.
    let other = text_style(&chain_plain(master, default_text, None).level(0));
    if other != styles.styles["body"] {
        styles.set("other", other);
    }

    let mut defs: Vec<Layout> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for info in layouts.iter_mut() {
        let owner = masters.get(info.master).unwrap_or(master);
        let mut name = slug(&info.label);
        if name.is_empty() {
            name = info
                .kind
                .as_deref()
                .map(slug)
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "layout".to_owned());
        }
        let mut candidate = name.clone();
        for n in 2.. {
            if !names.contains(&candidate) {
                break;
            }
            candidate = format!("{name}-{n}");
        }
        let mut used = HashSet::new();
        let placeholders: Vec<PlaceholderDef> = info
            .placeholders
            .iter_mut()
            .filter(|p| !p.class.is_footer())
            .map(|p| definition(p, owner, default_text, size, &mut styles, &mut used))
            .collect();
        defs.push(Layout {
            name: candidate.clone(),
            label: if info.label.is_empty() {
                candidate.clone()
            } else {
                info.label.clone()
            },
            placeholders,
            hide_master: info.hide_master,
            elements: Vec::new(),
            background: None,
            extra: Extra::new(),
        });
        names.push(candidate);
    }
    if defs.is_empty() {
        defs.push(Layout {
            name: "blank".to_owned(),
            label: "Blank".to_owned(),
            placeholders: Vec::new(),
            hide_master: false,
            elements: Vec::new(),
            background: None,
            extra: Extra::new(),
        });
        names.push("blank".to_owned());
    }
    // A text style the file never asked for is still one an editor expects.
    styles.fill_missing();
    let code = code_family(&mut styles)
        .map_or_else(|| slides_core::themes::light().fonts.code, |f| font(&f));

    let theme = Theme {
        name: file.name.clone(),
        colors: colors(file, &master.map),
        fonts: Fonts {
            heading: font(&file.heading),
            body: font(&file.body),
            code,
            extra: Extra::new(),
        },
        text_styles: styles.styles.clone(),
        layouts: defs,
        master: Vec::new(),
        dimmed_opacity: 0.25,
        highlight: Highlight {
            color: "accent1".to_owned(),
            width: 2.0,
            extra: Extra::new(),
        },
        new_slide_layout: None,
        extra: slides_core::Extra::new(),
    };
    Built {
        theme,
        styles,
        names,
    }
}

#[cfg(test)]
mod tests;
