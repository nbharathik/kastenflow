//! The slide master: the theme's own elements (a header bar, a logo, the slide
//! number), the title and body styles, and the list of layouts.

use slides_core::{Element, ListKind};

use crate::cx::Cx;
use crate::elements::{Env, Ph, write_all};
use crate::layouts::{Slot, open_root, write_slot, write_tree_header};
use crate::rels;
use crate::text::{resolve, write_level};
use crate::units::SLIDE_MASTER_ID;
use crate::xml::Xml;

/// Whether an element shows the number of its slide.
fn shows_slide_number(el: &Element) -> bool {
    match el {
        Element::Group(g) => g.children.iter().any(shows_slide_number),
        Element::Text(t) => t.text.paragraphs.iter().any(|p| {
            p.runs
                .iter()
                .any(|r| r.field.as_deref() == Some("slideNumber"))
        }),
        _ => false,
    }
}

/// The colour mapping every master has: text is dark 1, the background light 1.
fn write_color_map(x: &mut Xml) {
    x.leaf(
        "p:clrMap",
        &[
            ("bg1", "lt1"),
            ("tx1", "dk1"),
            ("bg2", "lt2"),
            ("tx2", "dk2"),
            ("accent1", "accent1"),
            ("accent2", "accent2"),
            ("accent3", "accent3"),
            ("accent4", "accent4"),
            ("accent5", "accent5"),
            ("accent6", "accent6"),
            ("hlink", "hlink"),
            ("folHlink", "folHlink"),
        ],
    );
}

/// The master's own title and body slots sit where the theme puts them on its
/// "title + body" layout, and fall back to the top and the rest of the slide.
fn master_slots(cx: &Cx) -> [Slot<'static>; 2] {
    let theme = &cx.deck.theme;
    let find = |role: &str| {
        theme
            .layout("title-body")
            .and_then(|l| l.placeholder(role))
            .map(|d| (d.x, d.y, d.w, d.h))
    };
    let (w, h) = (cx.deck.size.w, cx.deck.size.h);
    let title = find("title").unwrap_or((64.0, 36.0, w - 128.0, 96.0));
    let body = find("body").unwrap_or((64.0, 148.0, w - 128.0, h - 200.0));
    [
        Slot {
            name: "Title Placeholder 1".to_owned(),
            ph: Ph {
                kind: "title",
                idx: 0,
            },
            rect: title,
            style: "title",
            valign: slides_core::VAlign::Middle,
            list: None,
            prompts: vec!["Click to edit Master title style".to_owned()],
        },
        Slot {
            name: "Text Placeholder 2".to_owned(),
            ph: Ph {
                kind: "body",
                idx: 1,
            },
            rect: body,
            style: "body",
            valign: slides_core::VAlign::Top,
            list: Some(ListKind::Bullet),
            prompts: [
                "Click to edit Master text styles",
                "Second level",
                "Third level",
            ]
            .map(str::to_owned)
            .to_vec(),
        },
    ]
}

fn write_text_styles(x: &mut Xml, cx: &mut Cx) {
    let theme = cx.deck.theme.clone();
    x.open("p:txStyles");
    x.open("p:titleStyle");
    write_level(
        x,
        cx,
        "a:lvl1pPr",
        &resolve::style(&theme, "title"),
        None,
        0,
    );
    x.close();
    x.open("p:bodyStyle");
    for level in 0..9 {
        write_level(
            x,
            cx,
            &format!("a:lvl{}pPr", level + 1),
            &resolve::style(&theme, "body"),
            Some(ListKind::Bullet),
            level,
        );
    }
    x.close();
    x.open("p:otherStyle");
    x.open("a:defPPr");
    x.open("a:defRPr").attr("lang", "en-US").close();
    x.close();
    for level in 0..9 {
        write_level(
            x,
            cx,
            &format!("a:lvl{}pPr", level + 1),
            &resolve::style(&theme, "body"),
            None,
            level,
        );
    }
    x.close();
    x.close();
}

/// The master part. Its layouts are `rId1` to `rIdN` in order, and its theme the one after.
pub fn write(cx: &mut Cx, layouts: usize) -> Vec<u8> {
    cx.master = true;
    let layout_ids: Vec<String> = (1..=layouts)
        .map(|n| {
            cx.rels.add(
                rels::SLIDE_LAYOUT,
                &format!("../slideLayouts/slideLayout{n}.xml"),
            )
        })
        .collect();
    cx.rels.add(rels::THEME, "../theme/theme1.xml");

    let mut x = Xml::document();
    open_root(&mut x, "p:sldMaster");
    x.open("p:cSld");
    x.open("p:bg");
    x.open("p:bgPr");
    crate::color::Color::Scheme("bg1").solid_fill(&mut x, None);
    x.open("a:effectLst").close();
    x.close();
    x.close();
    x.open("p:spTree");
    write_tree_header(&mut x);
    for slot in &master_slots(cx) {
        write_slot(&mut x, cx, slot);
    }
    let elements: Vec<Element> = cx
        .deck
        .theme
        .master
        .iter()
        .filter(|e| cx.deck.present.slide_numbers || !shows_slide_number(e))
        .cloned()
        .collect();
    cx.ids.assign(&elements);
    write_all(&mut x, cx, &elements, &Env::default());
    x.close();
    x.close();
    write_color_map(&mut x);
    x.open("p:sldLayoutIdLst");
    for (n, id) in layout_ids.iter().enumerate() {
        x.open("p:sldLayoutId")
            .int("id", SLIDE_MASTER_ID + 1 + n as i64)
            .attr("r:id", id)
            .close();
    }
    x.close();
    write_text_styles(&mut x, cx);
    x.close();
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{deck, with_deck};

    fn master(deck: &slides_core::Deck) -> (String, String) {
        with_deck(deck, &Default::default(), |cx| {
            let n = deck.theme.layouts.len();
            let xml = String::from_utf8(write(cx, n)).unwrap_or_default();
            (xml, String::from_utf8(cx.rels.to_xml()).unwrap_or_default())
        })
    }

    #[test]
    fn the_master_lists_every_layout_and_relates_to_them_and_the_theme() {
        let deck = deck();
        let (xml, rels) = master(&deck);
        let n = deck.theme.layouts.len();
        assert_eq!(xml.matches("<p:sldLayoutId ").count(), n);
        assert!(
            xml.contains(r#"<p:sldLayoutId id="2147483649" r:id="rId1"/>"#),
            "{xml}"
        );
        assert!(
            xml.contains(&format!(
                r#"<p:sldLayoutId id="{}" r:id="rId{n}"/>"#,
                2147483648_i64 + n as i64
            )),
            "{xml}"
        );
        assert_eq!(
            rels.matches("relationships/slideLayout\"").count(),
            n,
            "{rels}"
        );
        assert!(rels.contains(&format!(r#"Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml""#, n + 1)), "{rels}");
    }

    #[test]
    fn the_master_paints_the_background_maps_the_colours_and_carries_the_styles() {
        let (xml, _) = master(&deck());
        assert!(xml.contains(r#"<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>"#), "{xml}");
        assert!(
            xml.contains(r#"<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1""#),
            "{xml}"
        );
        assert_eq!(
            xml.matches("<a:lvl9pPr").count(),
            2,
            "body and other styles have nine levels"
        );
        assert!(
            xml.contains(r#"<p:titleStyle><a:lvl1pPr marL="0" indent="0" algn="l">"#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"<a:defRPr lang="en-US" sz="3600" b="1""#),
            "{xml}"
        );
    }

    #[test]
    fn the_theme_s_own_elements_are_drawn_on_the_master_after_its_placeholders() {
        let mut deck = deck();
        deck.theme = slides_core::themes::lecture();
        // A new deck shows no number; this one asks for it.
        deck.present.slide_numbers = true;
        let (xml, _) = master(&deck);
        // The header bar, the logo slot (empty, so not written) and the slide number.
        assert!(xml.contains("slidenum"), "{xml}");
        assert!(xml.contains(r#"<p:nvPr userDrawn="1"/>"#), "{xml}");
        assert!(
            xml.contains(r#"<a:fld id="{"#) && xml.contains("‹#›"),
            "{xml}"
        );
        assert!(
            xml.find("Title Placeholder 1").unwrap_or(usize::MAX)
                < xml.find("userDrawn").unwrap_or(0)
        );
    }

    #[test]
    fn turning_slide_numbers_off_takes_the_number_off_the_master() {
        let mut deck = deck();
        deck.present.slide_numbers = false;
        let (xml, _) = master(&deck);
        assert!(!xml.contains("slidenum"), "{xml}");
        deck.present.slide_numbers = true;
        let (on, _) = master(&deck);
        assert!(on.contains("slidenum"));
    }

    #[test]
    fn the_master_s_placeholders_take_the_title_and_body_boxes_of_the_first_content_layout() {
        let (xml, _) = master(&deck());
        assert!(
            xml.contains(r#"<p:ph type="title"/>"#)
                && xml.contains(r#"<p:ph type="body" idx="1"/>"#),
            "{xml}"
        );
        assert!(
            xml.contains("<a:t>Click to edit Master text styles</a:t>")
                && xml.contains("<a:t>Third level</a:t>"),
            "{xml}"
        );
    }
}
