//! Layouts. Each layout of the theme becomes a `p:sldLayout` holding its slots as
//! placeholders, so a new slide made from it in PowerPoint has the same slots,
//! in the same places and in the same type. The slot's text style is written
//! into the placeholder, and the prompt is the slot's own.

use slides_core::{Layout, ListKind, PlaceholderDef, PlaceholderKind, VAlign};

use crate::cx::Cx;
use crate::elements::{Env, Ph, ph_of, write_all};
use crate::rels;
use crate::text::metrics::DEFAULT_INSETS;
use crate::text::resolve;
use crate::units::{emu, length};
use crate::xml::{NS_A, NS_P, NS_R, Xml};

/// How many list levels a slot's style spells out.
const LEVELS: usize = 5;

/// The layout type PowerPoint knows the layout by, where it has one.
fn layout_type(name: &str) -> Option<&'static str> {
    Some(match name {
        "title" => "title",
        "section" => "secHead",
        "title-body" => "obj",
        "title-only" => "titleOnly",
        "two-columns" => "twoObj",
        "comparison" => "twoTxTwoObj",
        "image-caption" => "picTx",
        "blank" => "blank",
        _ => return None,
    })
}

/// A placeholder of a layout or the master: its shape, its text style per level, and its prompt.
pub struct Slot<'a> {
    pub name: String,
    pub ph: Ph,
    pub rect: (f64, f64, f64, f64),
    pub style: &'a str,
    pub valign: VAlign,
    pub list: Option<ListKind>,
    pub prompts: Vec<String>,
}

impl<'a> Slot<'a> {
    pub fn from_def(def: &'a PlaceholderDef, ph: Ph) -> Slot<'a> {
        Slot {
            name: format!("{} {}", ph.label(), ph.idx + 1),
            ph,
            rect: (def.x, def.y, def.w, def.h),
            style: def.style.as_deref().unwrap_or("body"),
            valign: def.valign.clone().unwrap_or(match def.kind {
                PlaceholderKind::Image => VAlign::Middle,
                PlaceholderKind::Text => VAlign::Top,
            }),
            list: def.list.clone(),
            prompts: vec![def.prompt.clone()],
        }
    }
}

/// Writes one placeholder as a `p:sp`.
pub fn write_slot(x: &mut Xml, cx: &mut Cx, slot: &Slot) {
    let id = cx.ids.fresh();
    let style = resolve::style(&cx.deck.theme, slot.style);
    x.open("p:sp");
    x.open("p:nvSpPr");
    x.open("p:cNvPr")
        .int("id", i64::from(id))
        .attr("name", &slot.name)
        .close();
    x.open("p:cNvSpPr");
    x.open("a:spLocks").attr("noGrp", "1").close();
    x.close();
    x.open("p:nvPr");
    slot.ph.write(x);
    x.close();
    x.close();
    x.open("p:spPr");
    x.open("a:xfrm");
    let (left, top, w, h) = slot.rect;
    x.open("a:off")
        .int("x", emu(left))
        .int("y", emu(top))
        .close();
    x.open("a:ext")
        .int("cx", length(w))
        .int("cy", length(h))
        .close();
    x.close();
    x.close();
    x.open("p:txBody");
    x.open("a:bodyPr")
        .attr("wrap", "square")
        .int("lIns", length(DEFAULT_INSETS.left))
        .int("tIns", length(DEFAULT_INSETS.top))
        .int("rIns", length(DEFAULT_INSETS.right))
        .int("bIns", length(DEFAULT_INSETS.bottom))
        .attr("rtlCol", "0")
        .attr("anchor", crate::text::anchor(&slot.valign));
    x.open("a:noAutofit").close();
    x.close();
    x.open("a:lstStyle");
    let levels = if slot.list.is_some() { LEVELS } else { 1 };
    for level in 0..levels {
        crate::text::write_level(
            x,
            cx,
            &format!("a:lvl{}pPr", level + 1),
            &style,
            slot.list.clone(),
            level,
        );
    }
    x.close();
    for (level, prompt) in slot.prompts.iter().enumerate() {
        x.open("a:p");
        if level > 0 {
            x.open("a:pPr").int("lvl", level as i64).close();
        }
        x.open("a:r");
        x.open("a:rPr")
            .attr("lang", "en-US")
            .attr("dirty", "0")
            .close();
        x.text_element("a:t", prompt);
        x.close();
        x.open("a:endParaRPr")
            .attr("lang", "en-US")
            .attr("dirty", "0")
            .close();
        x.close();
    }
    x.close();
    x.close();
}

/// The group every shape tree starts with.
pub fn write_tree_header(x: &mut Xml) {
    x.open("p:nvGrpSpPr");
    x.open("p:cNvPr").int("id", 1).attr("name", "").close();
    x.open("p:cNvGrpSpPr").close();
    x.open("p:nvPr").close();
    x.close();
    x.open("p:grpSpPr");
    x.open("a:xfrm");
    x.open("a:off").int("x", 0).int("y", 0).close();
    x.open("a:ext").int("cx", 0).int("cy", 0).close();
    x.open("a:chOff").int("x", 0).int("y", 0).close();
    x.open("a:chExt").int("cx", 0).int("cy", 0).close();
    x.close();
    x.close();
}

/// The root of a part of the presentation, with the three namespaces every one uses.
pub fn open_root(x: &mut Xml, name: &str) {
    x.open(name)
        .attr("xmlns:a", NS_A)
        .attr("xmlns:r", NS_R)
        .attr("xmlns:p", NS_P);
}

/// A layout part: its background, the decoration it draws behind every slide (written as the
/// shapes and pictures of the layout, which PowerPoint shows on each slide that uses it) and its
/// slots. Its relationships are the master alone, and the pictures it uses.
pub fn write(cx: &mut Cx, layout: &Layout) -> Vec<u8> {
    cx.rels
        .add(rels::SLIDE_MASTER, "../slideMasters/slideMaster1.xml");
    // The decoration is drawn as the master's is: its own empty picture slot is no mistake.
    cx.master = true;
    let mut x = Xml::document();
    open_root(&mut x, "p:sldLayout");
    if let Some(kind) = layout_type(&layout.name) {
        x.attr("type", kind);
    }
    x.attr("preserve", "1").attr("userDrawn", "1");
    if layout.hide_master {
        x.attr("showMasterSp", "0");
    }
    x.open("p:cSld").attr("name", &layout.label);
    if let Some(background) = &layout.background {
        crate::slide::write_background(&mut x, cx, background);
    }
    x.open("p:spTree");
    write_tree_header(&mut x);
    cx.ids.assign(&layout.elements);
    write_all(&mut x, cx, &layout.elements, &Env::default());
    for def in &layout.placeholders {
        if let Some(ph) = ph_of(layout, &def.role) {
            write_slot(&mut x, cx, &Slot::from_def(def, ph));
        }
    }
    x.close();
    x.close();
    x.open("p:clrMapOvr");
    x.open("a:masterClrMapping").close();
    x.close();
    x.close();
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::with_cx;

    fn layout_xml(name: &str) -> String {
        with_cx(|cx| {
            let layout = cx
                .deck
                .theme
                .layout(name)
                .cloned()
                .unwrap_or_else(|| panic!("layout {name}"));
            String::from_utf8(write(cx, &layout)).unwrap_or_default()
        })
    }

    #[test]
    fn a_layout_has_the_type_the_name_the_slots_and_a_relationship_to_the_master() {
        let out = layout_xml("title-body");
        assert!(out.contains(r#"<p:sldLayout xmlns:a="#), "{out}");
        assert!(
            out.contains(r#"type="obj" preserve="1" userDrawn="1"><p:cSld name="Title + body">"#),
            "{out}"
        );
        assert_eq!(out.matches("<p:sp>").count(), 2, "{out}");
        assert!(
            out.contains(r#"<p:ph type="title"/>"#)
                && out.contains(r#"<p:ph type="body" idx="1"/>"#),
            "{out}"
        );
        assert!(
            out.contains("<a:t>Click to add title</a:t>")
                && out.contains("<a:t>Click to add text</a:t>"),
            "{out}"
        );
        assert!(
            out.ends_with("<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"),
            "{out}"
        );
    }

    #[test]
    fn the_box_and_anchor_of_a_slot_are_the_layouts() {
        let out = layout_xml("title");
        assert!(
            out.contains(r#"<p:ph type="ctrTitle"/>"#)
                && out.contains(r#"<p:ph type="subTitle" idx="1"/>"#),
            "{out}"
        );
        // The title is 148 units tall from 174 (a cover centres the pair on the slide), hanging from its bottom edge.
        assert!(
            out.contains(r#"anchor="b""#) && out.contains(r#"anchor="t""#),
            "{out}"
        );
        assert!(out.contains(r#"<a:off x="609600" y="#), "{out}");
    }

    #[test]
    fn a_list_slot_spells_out_bullets_for_five_levels_and_a_plain_one_only_the_first() {
        let body = layout_xml("title-body");
        assert_eq!(body.matches("<a:buChar").count(), LEVELS, "{body}");
        assert!(
            body.contains(r#"<a:lvl5pPr marL="1143000" indent="-228600" algn="l">"#),
            "{body}"
        );
        let title = layout_xml("title-only");
        assert_eq!(title.matches("<a:lvl1pPr").count(), 1);
        assert!(!title.contains("lvl2pPr"), "{title}");
    }

    #[test]
    fn a_layout_that_hides_the_master_says_so() {
        let mut lecture = String::new();
        with_cx(|cx| {
            let theme = slides_core::themes::lecture();
            let layout = theme
                .layout("title")
                .cloned()
                .unwrap_or_else(|| panic!("layout"));
            lecture = String::from_utf8(write(cx, &layout)).unwrap_or_default();
        });
        assert!(lecture.contains(r#"showMasterSp="0""#), "{lecture}");
        assert!(!layout_xml("title-body").contains("showMasterSp"));
    }

    #[test]
    fn a_picture_slot_is_a_picture_placeholder() {
        let out = layout_xml("title-image");
        assert!(out.contains(r#"<p:ph type="pic" idx="2"/>"#), "{out}");
        assert!(out.contains("<a:t>Click to add image</a:t>"), "{out}");
    }

    fn stripe(id: &str) -> slides_core::Element {
        use slides_core::{Base, Element, Extra, Fill, Style};
        let mut base = Base::new(id).place(0.0, 0.0, 40.0, 540.0);
        base.style = Some(Style {
            fill: Some(Fill {
                color: "accent2".to_owned(),
                alpha: None,
                extra: Extra::new(),
            }),
            ..Style::default()
        });
        Element::shape(base, "rect", None)
    }

    #[test]
    fn a_layout_s_decoration_and_background_are_written_before_its_slots() {
        let xml = with_cx(|cx| {
            let mut layout = cx
                .deck
                .theme
                .layout("title-only")
                .cloned()
                .unwrap_or_else(|| panic!("layout"));
            layout.elements = vec![stripe("stripe")];
            layout.background = Some(slides_core::Background {
                color: Some("bg2".to_owned()),
                image: None,
                extra: slides_core::Extra::new(),
            });
            String::from_utf8(write(cx, &layout)).unwrap_or_default()
        });
        assert!(
            xml.contains(r#"<p:cSld name="Title only"><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>"#),
            "{xml}"
        );
        let decoration = xml.find(r#"<p:nvPr userDrawn="1"/>"#).unwrap_or(usize::MAX);
        let slot = xml.find(r#"<p:ph type="title"/>"#).unwrap_or(0);
        assert!(decoration < slot, "{xml}");
        assert!(xml.contains(r#"<a:schemeClr val="accent2"/>"#), "{xml}");
    }

    #[test]
    fn a_layout_with_no_slots_is_a_blank_one() {
        let out = layout_xml("blank");
        assert!(
            out.contains(r#"type="blank""#) && !out.contains("<p:sp>"),
            "{out}"
        );
    }
}
