//! A slide part: the background, then the elements in stacking order.

use slides_core::resolve::Rect;
use slides_core::{Background, Slide};

use crate::backing::Behind;
use crate::cx::Cx;
use crate::elements::{Env, cover, remember, write_all, write_blip_fill};
use crate::layouts::{open_root, write_tree_header};
use crate::xml::Xml;

/// A background, or nothing to let the one behind it show: the slide's own over its layout's, the
/// layout's over the master's.
pub(crate) fn write_background(x: &mut Xml, cx: &mut Cx, background: &Background) {
    let picture = background
        .image
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .and_then(|path| match cx.picture(path) {
            Ok(picture) => Some(picture),
            Err(reason) => {
                cx.warn(format!(
                    "{reason}; the slide's background picture was left out"
                ));
                None
            }
        });
    if picture.is_none() && background.color.is_none() {
        return;
    }
    if picture.is_some() {
        // Words a step dims over a picture cannot be mixed toward one colour.
        let whole = Rect {
            x: 0.0,
            y: 0.0,
            w: cx.deck.size.w,
            h: cx.deck.size.h,
        };
        cx.backing.push(whole, Behind::Unknown);
    }
    x.open("p:bg");
    x.open("p:bgPr");
    match (&picture, &background.color) {
        (Some(picture), _) => {
            let cuts = cover(picture, cx.deck.size.w, cx.deck.size.h);
            write_blip_fill(x, cx, "a:blipFill", picture, cuts, 1.0);
        }
        (None, Some(color)) => cx.color(color).solid_fill(x, None),
        (None, None) => {}
    }
    x.open("a:effectLst").close();
    x.close();
    x.close();
}

/// The slide part. `hidden` skips it when the show is played.
pub fn write(cx: &mut Cx, slide: &Slide, hidden: bool) -> Vec<u8> {
    cx.ids.assign(&slide.elements);
    if cx.step.is_some() {
        // What the layout draws behind the slide is behind its words too.
        let deck = cx.deck;
        if let Some(layout) = deck.theme.layout(&cx.layout) {
            remember(cx, &layout.elements);
        }
    }
    let mut x = Xml::document();
    open_root(&mut x, "p:sld");
    if hidden {
        x.attr("show", "0");
    }
    x.open("p:cSld");
    if let Some(background) = &slide.background {
        write_background(&mut x, cx, background);
    }
    x.open("p:spTree");
    write_tree_header(&mut x);
    write_all(&mut x, cx, &slide.elements, &Env::default());
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
    use serde_json::json;
    use slides_core::Engine;

    use super::*;
    use crate::samples;
    use crate::testing::{MapMedia, with_deck};

    fn deck_with(content: serde_json::Value) -> (slides_core::Deck, String) {
        let mut engine = Engine::create("t", "Light", 5).unwrap_or_else(|e| panic!("{e}"));
        let id = engine
            .apply(
                "add_slide",
                json!({ "layout": "title-body", "content": content }),
            )
            .unwrap_or_else(|e| panic!("{e}"))
            .output["slide"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        (engine.into_deck(), id)
    }

    fn written(
        deck: &slides_core::Deck,
        id: &str,
        media: &MapMedia,
        hidden: bool,
    ) -> (String, Vec<String>) {
        let slide = deck.slide(id).cloned().unwrap_or_else(|| panic!("slide"));
        with_deck(deck, media, |cx| {
            cx.slide = Some(slide.id.clone());
            cx.layout = slide.layout.clone();
            let xml = String::from_utf8(write(cx, &slide, hidden)).unwrap_or_default();
            (
                xml,
                cx.shared
                    .warnings
                    .iter()
                    .map(|w| w.message.clone())
                    .collect(),
            )
        })
    }

    #[test]
    fn a_slide_is_a_shape_tree_of_its_elements_in_stacking_order() {
        let (deck, id) = deck_with(json!({ "title": "Results", "body": "- one\n- two" }));
        let (xml, warnings) = written(&deck, &id, &MapMedia::default(), false);
        assert!(
            xml.starts_with(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<p:sld xmlns:a="
            ),
            "{xml}"
        );
        assert!(
            xml.contains(r#"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/>"#),
            "{xml}"
        );
        assert!(
            !xml.contains("show="),
            "a slide that is shown says nothing: {xml}"
        );
        assert!(
            xml.ends_with(
                "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
            ),
            "{xml}"
        );
        assert!(
            xml.find("Results").unwrap_or(usize::MAX) < xml.find("<a:t>one</a:t>").unwrap_or(0)
        );
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn a_hidden_slide_says_it_is_skipped_in_the_show() {
        let (deck, id) = deck_with(json!({}));
        assert!(
            written(&deck, &id, &MapMedia::default(), true)
                .0
                .contains(r#"show="0""#)
        );
    }

    #[test]
    fn a_slides_background_colour_is_a_solid_fill_under_the_shapes() {
        let (mut deck, id) = deck_with(json!({}));
        deck.slide_mut(&id)
            .unwrap_or_else(|| panic!("slide"))
            .background = Some(Background {
            color: Some("#112233".into()),
            image: None,
            extra: slides_core::Extra::new(),
        });
        let (xml, _) = written(&deck, &id, &MapMedia::default(), false);
        assert!(
            xml.contains(r#"<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>"#),
            "{xml}"
        );
    }

    #[test]
    fn a_background_picture_covers_the_slide_without_stretching() {
        let (mut deck, id) = deck_with(json!({}));
        deck.slide_mut(&id)
            .unwrap_or_else(|| panic!("slide"))
            .background = Some(Background {
            color: Some("bg2".into()),
            image: Some("bg.png".into()),
            extra: slides_core::Extra::new(),
        });
        let mut media = MapMedia::default();
        // Twice as wide as the 16:9 slide needs: a quarter goes from each side... 32:9 covers 16:9 by cutting a quarter each side.
        media
            .0
            .insert("bg.png".into(), samples::solid(320, 90, [0, 0, 0]));
        let (xml, warnings) = written(&deck, &id, &media, false);
        assert!(
            xml.contains(r#"<p:bgPr><a:blipFill><a:blip r:embed="rId1"/><a:srcRect l="25000" t="0" r="25000" b="0"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr>"#),
            "{xml}"
        );
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn a_background_picture_that_is_missing_falls_back_to_the_colour_and_is_reported() {
        let (mut deck, id) = deck_with(json!({}));
        deck.slide_mut(&id)
            .unwrap_or_else(|| panic!("slide"))
            .background = Some(Background {
            color: Some("bg2".into()),
            image: Some("gone.png".into()),
            extra: slides_core::Extra::new(),
        });
        let (xml, warnings) = written(&deck, &id, &MapMedia::default(), false);
        assert!(
            xml.contains(r#"<p:bgPr><a:solidFill><a:schemeClr val="bg2"/>"#),
            "{xml}"
        );
        assert_eq!(warnings.len(), 1, "{warnings:?}");
    }

    #[test]
    fn words_a_step_dims_over_a_background_picture_are_see_through_and_not_mixed_with_a_colour() {
        let (mut deck, id) = deck_with(json!({ "title": "Over a photo" }));
        let slide = deck.slide_mut(&id).unwrap_or_else(|| panic!("slide"));
        slide.steps = 1;
        for element in &mut slide.elements {
            element
                .base_mut()
                .step_states
                .insert(0, slides_core::StepState::Dimmed);
        }
        let mut media = MapMedia::default();
        media
            .0
            .insert("bg.png".into(), samples::solid(320, 90, [0, 0, 0]));
        let at_step_0 = |deck: &slides_core::Deck| {
            let slide = deck.slide(&id).cloned().unwrap_or_else(|| panic!("slide"));
            with_deck(deck, &media, |cx| {
                cx.slide = Some(slide.id.clone());
                cx.layout = slide.layout.clone();
                cx.step = Some(0);
                String::from_utf8(write(cx, &slide, false)).unwrap_or_default()
            })
        };
        let on_the_page = at_step_0(&deck);
        assert!(
            !on_the_page.contains(r#"<a:schemeClr val="tx1"><a:alpha"#),
            "over the plain page the words are mixed toward it: {on_the_page}"
        );
        deck.slide_mut(&id)
            .unwrap_or_else(|| panic!("slide"))
            .background = Some(Background {
            color: None,
            image: Some("bg.png".into()),
            extra: slides_core::Extra::new(),
        });
        let on_a_picture = at_step_0(&deck);
        assert!(
            on_a_picture.contains(r#"<a:schemeClr val="tx1"><a:alpha val="25000"/>"#),
            "{on_a_picture}"
        );
    }
}
