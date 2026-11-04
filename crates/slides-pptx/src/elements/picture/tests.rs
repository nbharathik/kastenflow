use slides_core::{Element, Extra, Fill, Stroke, Style};

use super::*;
use crate::elements::xml_of;
use crate::samples;
use crate::testing::{MapMedia, deck, with_deck};

mod cover;

fn media() -> MapMedia {
    let mut media = MapMedia::default();
    media.0.insert(
        "assets/wide.png".into(),
        samples::solid(200, 100, [1, 2, 3]),
    );
    media
        .0
        .insert("assets/photo.jpg".into(), samples::JPEG_3X2.to_vec());
    media.0.insert(
        "assets/fig.svg".into(),
        b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
    );
    media
        .0
        .insert("assets/fig.png".into(), samples::solid(40, 20, [9, 9, 9]));
    media.0.insert(
        "assets/tall.png".into(),
        samples::solid(100, 200, [4, 5, 6]),
    );
    media
}

fn image(src: &str, base: Base) -> ImageEl {
    ImageEl {
        base,
        src: src.into(),
        crop: None,
        mask: None,
        extra: Extra::new(),
    }
}

struct Run {
    xml: String,
    warnings: Vec<String>,
    rels: String,
}

fn run_element(el: Element, master: bool) -> Run {
    with_deck(&deck(), &media(), |cx| {
        cx.master = master;
        let xml = xml_of(cx, &el);
        Run {
            xml,
            warnings: cx
                .shared
                .warnings
                .iter()
                .map(|w| w.message.clone())
                .collect(),
            rels: String::from_utf8(cx.rels.to_xml()).unwrap_or_default(),
        }
    })
}

fn run(el: ImageEl) -> Run {
    run_element(Element::Image(el), false)
}

#[test]
fn a_picture_is_stretched_to_its_box_and_names_its_media_by_relationship() {
    let mut base = Base::new("e-1").place(100.0, 50.0, 200.0, 100.0);
    base.alt = Some("A wide picture".into());
    let out = run(image("assets/wide.png", base));
    assert_eq!(
        out.xml,
        concat!(
            r#"<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture 2" descr="A wide picture"/>"#,
            r#"<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>"#,
            r#"<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>"#,
            r#"<p:spPr><a:xfrm><a:off x="952500" y="476250"/><a:ext cx="1905000" cy="952500"/></a:xfrm>"#,
            r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#
        )
    );
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    assert!(
        out.rels.contains(r#"Id="rId1""#) && out.rels.contains(r#"Target="../media/image1.png""#),
        "{}",
        out.rels
    );
}

#[test]
fn adjustments_are_effects_of_the_blip_and_a_mask_shape_is_the_geometry() {
    let mut base = Base::new("e-1").place(0.0, 0.0, 100.0, 100.0);
    base.style = Some(Style {
        adjust: Some(slides_core::Adjust {
            brightness: Some(0.1),
            greyscale: true,
            ..slides_core::Adjust::default()
        }),
        mask_shape: Some("star5".into()),
        ..Style::default()
    });
    let out = run(image("assets/wide.png", base));
    assert!(
        out.xml.contains(
            r#"<a:blip r:embed="rId1"><a:grayscl/><a:lum bright="10000" contrast="0"/></a:blip>"#
        ),
        "{}",
        out.xml
    );
    assert!(
        out.xml.contains(r#"<a:prstGeom prst="star5">"#),
        "{}",
        out.xml
    );
}

#[test]
fn a_picture_without_adjustments_writes_none() {
    let out = run(image(
        "assets/wide.png",
        Base::new("e-1").place(0.0, 0.0, 100.0, 100.0),
    ));
    assert!(
        !out.xml.contains("a:lum") && !out.xml.contains("a:grayscl"),
        "{}",
        out.xml
    );
}

#[test]
fn a_stretched_picture_does_not_lock_its_aspect() {
    let out = run(image(
        "assets/wide.png",
        Base::new("e-1").place(0.0, 0.0, 100.0, 100.0),
    ));
    assert!(out.xml.contains("<a:picLocks/>"), "{}", out.xml);
}

#[test]
fn a_crop_is_the_fractions_cut_from_each_edge() {
    let mut el = image(
        "assets/wide.png",
        Base::new("e-1").place(0.0, 0.0, 100.0, 100.0),
    );
    el.crop = Some(Crop {
        left: 0.25,
        top: 0.0,
        right: 0.25,
        bottom: 0.0,
        extra: Extra::new(),
    });
    let out = run(el);
    assert!(
        out.xml
            .contains(r#"<a:srcRect l="25000" t="0" r="25000" b="0"/><a:stretch>"#),
        "{}",
        out.xml
    );
    assert!(
        out.xml.contains(r#"<a:picLocks noChangeAspect="1"/>"#),
        "the cropped picture is square: {}",
        out.xml
    );
}

#[test]
fn a_crop_cannot_cut_everything() {
    let c = cuts(&Crop {
        left: 0.9,
        top: 2.0,
        right: 0.9,
        bottom: -1.0,
        extra: Extra::new(),
    });
    for (got, want) in c.iter().zip([0.9, 0.99, 0.09, 0.0]) {
        assert!((got - want).abs() < 1e-9, "{c:?}");
    }
}

#[test]
fn a_mask_is_the_geometry_of_the_picture() {
    let with = |mask, radius: Option<f64>| {
        let mut base = Base::new("e-1").place(0.0, 0.0, 200.0, 100.0);
        base.style = Some(Style {
            radius,
            ..Style::default()
        });
        let mut el = image("assets/wide.png", base);
        el.mask = Some(mask);
        run(el).xml
    };
    assert!(with(Mask::Ellipse, None).contains(r#"<a:prstGeom prst="ellipse"><a:avLst/>"#));
    assert!(with(Mask::Rect, Some(30.0)).contains(r#"<a:prstGeom prst="rect"><a:avLst/>"#));
    assert!(
        with(Mask::RoundRect, None)
            .contains(r#"prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 12000"/>"#)
    );
    assert!(with(Mask::RoundRect, Some(25.0)).contains(r#"fmla="val 25000""#));
}

#[test]
fn opacity_outline_and_shadow_belong_to_the_picture() {
    let mut base = Base::new("e-1").place(0.0, 0.0, 200.0, 100.0);
    base.style = Some(Style {
        opacity: Some(0.5),
        stroke: Some(Stroke {
            color: "accent1".into(),
            width: Some(2.0),
            dash: None,
            alpha: None,
            extra: Extra::new(),
        }),
        fill: Some(Fill {
            color: "accent2".into(),
            alpha: None,
            extra: Extra::new(),
        }),
        ..Style::default()
    });
    let out = run(image("assets/wide.png", base)).xml;
    assert!(
        out.contains(r#"<a:blip r:embed="rId1"><a:alphaModFix amt="50000"/></a:blip>"#),
        "{out}"
    );
    assert!(
        out.contains(r#"<a:ln w="19050""#) && out.contains(r#"<a:alpha val="50000"/>"#),
        "{out}"
    );
    assert!(!out.contains("accent2"), "a picture has no fill: {out}");
}

#[test]
fn a_picture_that_is_missing_is_a_grey_box_and_a_warning() {
    let mut base = Base::new("e-1").place(0.0, 0.0, 200.0, 100.0);
    base.alt = Some("Lost".into());
    let out = run(image("assets/none.png", base));
    assert!(
        out.xml.starts_with("<p:sp>") && !out.xml.contains("<p:pic>"),
        "{}",
        out.xml
    );
    assert!(out.xml.contains(r#"descr="Lost""#), "{}", out.xml);
    assert!(
        out.xml.contains(r#"<a:solidFill><a:schemeClr val="tx2"><a:alpha val="25000"/></a:schemeClr></a:solidFill>"#),
        "{}",
        out.xml
    );
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("assets/none.png") && out.warnings[0].contains("not found"));
}

#[test]
fn an_svg_with_a_png_beside_it_carries_both() {
    let out = run(image(
        "assets/fig.svg",
        Base::new("e-1").place(0.0, 0.0, 200.0, 100.0),
    ));
    assert!(
        out.xml.contains(concat!(
            r#"<a:blip r:embed="rId1"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">"#,
            r#"<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId2"/>"#,
            r#"</a:ext></a:extLst></a:blip>"#
        )),
        "{}",
        out.xml
    );
    assert!(
        out.rels.contains("image1.png") && out.rels.contains("image2.svg"),
        "{}",
        out.rels
    );
}

#[test]
fn an_empty_picture_is_left_out_but_an_empty_slot_stays_for_a_person_to_fill() {
    let empty = run(image("", Base::new("e-1").place(0.0, 0.0, 10.0, 10.0)));
    assert_eq!(empty.xml, "");
    assert_eq!(empty.warnings.len(), 1);
    let theme_logo = run_element(
        Element::Image(image(
            "",
            Base::new("master-logo").place(0.0, 0.0, 10.0, 10.0),
        )),
        true,
    );
    assert_eq!(
        (theme_logo.xml.as_str(), theme_logo.warnings.len()),
        ("", 0)
    );

    let deck = deck();
    let mut base = Base::new("e-slot");
    base.placeholder = Some("image".into());
    let slot = Element::Image(image("", base));
    let out = with_deck(&deck, &media(), |cx| {
        cx.layout = "title-image".into();
        (xml_of(cx, &slot), cx.shared.warnings.len())
    });
    assert_eq!(out.1, 0);
    assert!(
        out.0.starts_with(concat!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Picture Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>"#,
            r#"<p:nvPr><p:ph type="pic" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm>"#
        )),
        "{}",
        out.0
    );
    assert!(!out.0.contains("txBody"), "{}", out.0);
}

#[test]
fn a_filled_slot_is_a_picture_placeholder() {
    let mut base = Base::new("e-slot");
    base.placeholder = Some("image".into());
    let slot = Element::Image(image("assets/wide.png", base));
    let out = with_deck(&deck(), &media(), |cx| {
        cx.layout = "title-image".into();
        xml_of(cx, &slot)
    });
    assert!(
        out.contains(
            r#"<a:picLocks noGrp="1"/></p:cNvPicPr><p:nvPr><p:ph type="pic" idx="2"/></p:nvPr>"#
        ),
        "{out}"
    );
}

#[test]
fn raw_content_is_its_preview_or_nothing() {
    let raw = |preview: Option<&str>| {
        Element::Raw(RawEl {
            base: Base::new("e-raw").place(0.0, 0.0, 100.0, 50.0),
            original: Some("pptx:chart".into()),
            xml: None,
            preview: preview.map(str::to_owned),
            extra: Extra::new(),
        })
    };
    let shown = run_element(raw(Some("assets/wide.png")), false);
    assert!(shown.xml.starts_with("<p:pic>"), "{}", shown.xml);
    let none = run_element(raw(None), false);
    assert_eq!(none.xml, "");
    assert!(
        none.warnings[0].contains("pptx:chart"),
        "{:?}",
        none.warnings
    );
}

#[test]
fn covering_a_box_cuts_the_sides_that_overflow() {
    let picture = |w, h| Picture {
        raster: crate::media::Stored::for_test(w, h),
        svg: None,
        caution: None,
    };
    let close =
        |got: [f64; 4], want: [f64; 4]| got.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-9);
    assert!(close(
        cover(&picture(200, 100), 100.0, 100.0),
        [0.25, 0.0, 0.25, 0.0]
    ));
    assert!(close(
        cover(&picture(100, 200), 100.0, 100.0),
        [0.0, 0.25, 0.0, 0.25]
    ));
    assert!(close(cover(&picture(100, 100), 100.0, 100.0), [0.0; 4]));
    assert!(close(cover(&picture(100, 100), 0.0, 100.0), [0.0; 4]));
}
