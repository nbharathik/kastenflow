//! Pictures: a `p:pic` whose box is the element's box and whose crop and mask
//! are the element's. One that says it covers its box (the poster of a page or a
//! video) is cut to the shape of the box, as it is on the slide, instead of being
//! stretched to it. A picture that cannot be used is a grey box and a
//! warning, never a failed export.

use slides_core::{Adjust, Base, Crop, ImageEl, Mask, RawEl};

mod adjust;
mod math;

use super::Site;
use super::common::{name_of, write_c_nv_pr, write_xfrm};
use super::shape::corner;
use crate::cx::Cx;
use crate::media::Picture;
use crate::rels;
use crate::style::{combined, write_effects, write_line};
use crate::units::thousandths;
use crate::xml::Xml;

/// The corner radius of a rounded mask when the style names none.
const DEFAULT_MASK_RADIUS: f64 = 12.0;

/// The most of a picture a crop may cut, so a crop that cuts everything still shows a sliver.
const MOST_CUT: f64 = 0.99;

/// The four cuts of a crop, as fractions of the whole picture that keep something showing.
fn cuts(crop: &Crop) -> [f64; 4] {
    let cut = |v: f64| {
        if v.is_finite() {
            v.clamp(0.0, MOST_CUT)
        } else {
            0.0
        }
    };
    let [left, top, right, bottom] = [
        cut(crop.left),
        cut(crop.top),
        cut(crop.right),
        cut(crop.bottom),
    ];
    [
        left,
        top,
        right.min(MOST_CUT - left),
        bottom.min(MOST_CUT - top),
    ]
}

/// What the picture shows of itself once cropped, as a width and a height in pixels.
fn shown(picture: &Picture, crop: Option<&Crop>) -> (f64, f64) {
    let [l, t, r, b] = crop.map_or([0.0; 4], cuts);
    (
        f64::from(picture.raster.width) * (1.0 - l - r),
        f64::from(picture.raster.height) * (1.0 - t - b),
    )
}

/// The cuts that make a picture cover a box of `w` by `h` without stretching: left and right, or top and bottom.
pub fn cover(picture: &Picture, w: f64, h: f64) -> [f64; 4] {
    let (pw, ph) = (
        f64::from(picture.raster.width),
        f64::from(picture.raster.height),
    );
    if w <= 0.0 || h <= 0.0 || pw <= 0.0 || ph <= 0.0 {
        return [0.0; 4];
    }
    let wanted = w / h;
    let have = pw / ph;
    if have > wanted {
        let side = (1.0 - wanted / have) / 2.0;
        [side, 0.0, side, 0.0]
    } else {
        let side = (1.0 - have / wanted) / 2.0;
        [0.0, side, 0.0, side]
    }
}

/// `a:blipFill` (or the `p:blipFill` of a picture) for the picture, with the given cuts.
pub fn write_blip_fill(
    x: &mut Xml,
    cx: &mut Cx,
    tag: &str,
    picture: &Picture,
    cuts: [f64; 4],
    opacity: f64,
) {
    write_touched_up(x, cx, tag, picture, cuts, opacity, None);
}

/// The same, with the picture's adjustments written as the effects of its `a:blip`.
fn write_touched_up(
    x: &mut Xml,
    cx: &mut Cx,
    tag: &str,
    picture: &Picture,
    cuts: [f64; 4],
    opacity: f64,
    touched: Option<&Adjust>,
) {
    let embed = cx.rels.add(rels::IMAGE, &picture.raster.target());
    x.open(tag);
    x.open("a:blip").attr("r:embed", &embed);
    if let Some(alpha) = combined(None, opacity) {
        x.open("a:alphaModFix")
            .int("amt", thousandths(alpha))
            .close();
    }
    if let Some(adjust) = touched {
        adjust::write_effects(x, adjust);
    }
    if let Some(svg) = &picture.svg {
        let id = cx.rels.add(rels::IMAGE, &svg.target());
        x.open("a:extLst");
        x.open("a:ext")
            .attr("uri", "{96DAC541-7B7A-43D3-8B79-37D633B846F1}");
        x.open("asvg:svgBlip")
            .attr(
                "xmlns:asvg",
                "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
            )
            .attr("r:embed", &id)
            .close();
        x.close();
        x.close();
    }
    x.close();
    if cuts.iter().any(|c| *c > 0.0) {
        x.open("a:srcRect")
            .int("l", thousandths(cuts[0]))
            .int("t", thousandths(cuts[1]))
            .int("r", thousandths(cuts[2]))
            .int("b", thousandths(cuts[3]))
            .close();
    }
    x.open("a:stretch");
    x.open("a:fillRect").close();
    x.close();
    x.close();
}

fn write_pic(
    x: &mut Xml,
    cx: &mut Cx,
    base: &Base,
    site: &Site,
    picture: &Picture,
    crop: Option<&Crop>,
    mask: Option<&Mask>,
) {
    let Site {
        id,
        frame,
        opacity,
        ph,
    } = site;
    let name = match ph {
        Some(ph) if base.name.is_none() => name_of(base, ph.label(), *id),
        _ => name_of(base, "Picture", *id),
    };
    let (pw, ph_px) = shown(picture, crop);
    let (w, h) = (frame.rect.w, frame.rect.h);
    let keeps_shape =
        w > 0.0 && h > 0.0 && ph_px > 0.0 && ((pw / ph_px) / (w / h) - 1.0).abs() < 0.01;

    x.open("p:pic");
    x.open("p:nvPicPr");
    write_c_nv_pr(x, cx, *id, &name, base);
    x.open("p:cNvPicPr");
    x.open("a:picLocks")
        .flag("noGrp", ph.is_some())
        .flag("noChangeAspect", keeps_shape)
        .close();
    x.close();
    x.open("p:nvPr");
    if let Some(ph) = ph {
        ph.write(x);
    }
    x.close();
    x.close();

    write_touched_up(
        x,
        cx,
        "p:blipFill",
        picture,
        crop.map_or([0.0; 4], cuts),
        *opacity,
        base.style.as_ref().and_then(|s| s.adjust.as_ref()),
    );

    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", frame);
    let shaped = base.style.as_ref().and_then(|s| s.mask_shape.as_deref());
    let (geometry, adjust) = match (shaped, mask) {
        (Some(shape), _) => (shape, None),
        (None, Some(Mask::Ellipse)) => ("ellipse", None),
        (None, Some(Mask::RoundRect)) => {
            let radius = base
                .style
                .as_ref()
                .and_then(|s| s.radius)
                .unwrap_or(DEFAULT_MASK_RADIUS);
            ("roundRect", Some(corner(radius, frame)))
        }
        _ => ("rect", None),
    };
    x.open("a:prstGeom").attr("prst", geometry);
    x.open("a:avLst");
    if let Some(value) = adjust {
        x.open("a:gd")
            .attr("name", "adj")
            .attr("fmla", &format!("val {value}"))
            .close();
    }
    x.close();
    x.close();
    if base.style.as_ref().is_some_and(|s| s.stroke.is_some()) {
        write_line(x, cx, base.style.as_ref(), *opacity, false, false);
    }
    write_effects(x, cx, base.style.as_ref(), *opacity);
    x.close();
    x.close();
}

/// A grey box where a picture could not go.
fn write_stand_in(x: &mut Xml, cx: &mut Cx, base: &Base, site: &Site) {
    let Site {
        id, frame, opacity, ..
    } = site;
    x.open("p:sp");
    x.open("p:nvSpPr");
    write_c_nv_pr(x, cx, *id, &name_of(base, "Picture", *id), base);
    x.open("p:cNvSpPr").close();
    x.open("p:nvPr").close();
    x.close();
    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", frame);
    x.open("a:prstGeom").attr("prst", "rect");
    x.open("a:avLst").close();
    x.close();
    // The grey the editor draws in the place of a picture it could not load.
    cx.color("text2")
        .solid_fill(x, combined(Some(0.25), *opacity));
    x.open("a:ln");
    x.open("a:noFill").close();
    x.close();
    x.close();
    x.close();
}

/// The empty slot of a picture, which a person fills in PowerPoint.
fn write_empty_slot(x: &mut Xml, cx: &mut Cx, base: &Base, site: &Site) {
    let Site { id, frame, ph, .. } = site;
    let Some(ph) = ph else { return };
    x.open("p:sp");
    x.open("p:nvSpPr");
    write_c_nv_pr(x, cx, *id, &name_of(base, ph.label(), *id), base);
    x.open("p:cNvSpPr");
    x.open("a:spLocks").attr("noGrp", "1").close();
    x.close();
    x.open("p:nvPr");
    ph.write(x);
    x.close();
    x.close();
    x.open("p:spPr");
    write_xfrm(x, "a:xfrm", frame);
    x.close();
    x.close();
}

/// How a picture is fitted to its box: cut by a crop of its own, or, when it covers its box,
/// cut to the shape of the box (the poster of a page or a video), or else stretched to it.
#[derive(Clone, Copy, Default)]
struct Fit<'a> {
    crop: Option<&'a Crop>,
    covers: bool,
}

fn place(
    x: &mut Xml,
    cx: &mut Cx,
    base: &Base,
    site: &Site,
    path: &str,
    fit: Fit,
    mask: Option<&Mask>,
) {
    match cx.picture(path) {
        Ok(picture) => {
            if let Some(caution) = &picture.caution {
                cx.warn(caution.clone());
            }
            // The size of a picture is only known here, so the cuts that make it fill its box are worked out now.
            let [left, top, right, bottom] = cover(&picture, site.frame.rect.w, site.frame.rect.h);
            let made = Crop {
                left,
                top,
                right,
                bottom,
                extra: slides_core::Extra::new(),
            };
            let crop = fit.crop.or_else(|| fit.covers.then_some(&made));
            write_pic(x, cx, base, site, &picture, crop, mask);
        }
        Err(reason) => {
            // The picture of a formula comes from the host; without it, the formula's source is the next best thing.
            let source = base.alt.as_deref().map(str::trim).filter(|a| !a.is_empty());
            match source {
                Some(latex) if math::is_formula(path) => {
                    cx.warn(format!(
                        "{reason}; the formula is written as its LaTeX source"
                    ));
                    math::write_source(x, cx, base, site, latex);
                }
                _ => {
                    cx.warn(format!("{reason}; a grey box is in its place"));
                    write_stand_in(x, cx, base, site);
                }
            }
        }
    }
}

/// A picture, cropped and masked as the element says.
pub fn write_image(x: &mut Xml, cx: &mut Cx, el: &ImageEl, site: &Site) {
    if el.src.trim().is_empty() {
        // An empty slot is a prompt for an editor only. The theme's own empty logo
        // is a place for a deck's owner to fill; neither is a mistake to report.
        if site.ph.is_some() {
            write_empty_slot(x, cx, &el.base, site);
        } else if !cx.master {
            cx.warn("a picture has no file, so it was left out");
        }
        return;
    }
    place(
        x,
        cx,
        &el.base,
        site,
        el.src.trim(),
        Fit {
            crop: el.crop.as_ref(),
            covers: el.covers(),
        },
        el.mask.as_ref(),
    );
}

/// What an import could not understand: its preview picture, or nothing.
pub fn write_raw(x: &mut Xml, cx: &mut Cx, el: &RawEl, site: &Site) {
    match el
        .preview
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(preview) => place(
            x,
            cx,
            &el.base,
            &Site { ph: None, ..*site },
            preview,
            Fit::default(),
            None,
        ),
        None => cx.warn(format!(
            "content the import kept as `{}` has no picture to show, so it was left out",
            el.original.as_deref().unwrap_or("raw")
        )),
    }
}

#[cfg(test)]
mod tests;
