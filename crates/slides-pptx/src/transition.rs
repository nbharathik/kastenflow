//! A slide's transition as `p:transition`, and back. A transition PowerPoint 2010 or later made lives in
//! `mc:AlternateContent` so that older programs read the plain one beside it; the same is written here.

use slides_core::{MotionDirection, Slide, Transition, TransitionKind};

use crate::xml::Xml;

const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const NS_P159: &str = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";

/// PowerPoint's `dir` for a motion that begins at `from`: the way the content travels, so from the right is `l`.
fn dir_of(from: Option<MotionDirection>) -> &'static str {
    match from.unwrap_or(MotionDirection::Right) {
        MotionDirection::Right => "l",
        MotionDirection::Left => "r",
        MotionDirection::Down => "u",
        MotionDirection::Up => "d",
    }
}

/// The side a motion begins at, from PowerPoint's `dir` (the way the content travels).
fn from_of(dir: &str) -> Option<MotionDirection> {
    Some(match dir {
        "l" => MotionDirection::Right,
        "r" => MotionDirection::Left,
        "u" => MotionDirection::Down,
        "d" => MotionDirection::Up,
        _ => return None,
    })
}

/// How long a transition takes when it names no time, in seconds.
fn usual(kind: &TransitionKind) -> f64 {
    match kind {
        TransitionKind::Morph => 0.6,
        _ => 0.4,
    }
}

/// The transition a slide arrives with: its own, else the deck's. None for a plain cut.
pub fn arrival<'a>(slide: &'a Slide, deck: &'a slides_core::Deck) -> Option<&'a Transition> {
    slide
        .transition
        .as_ref()
        .or(deck.present.transition.as_ref())
        .filter(|t| t.kind != TransitionKind::None)
}

/// `(namespace prefix needed, markup)` for the transition's own element.
fn body(t: &Transition) -> (Option<&'static str>, String) {
    let dir = dir_of(t.direction.clone());
    match t.kind {
        TransitionKind::Fade | TransitionKind::None => (None, "<p:fade/>".to_owned()),
        TransitionKind::Dissolve => (None, "<p:dissolve/>".to_owned()),
        TransitionKind::Slide => (None, format!(r#"<p:push dir="{}"/>"#, dir_of(None))),
        TransitionKind::Push => (None, format!(r#"<p:push dir="{dir}"/>"#)),
        TransitionKind::Wipe => (None, format!(r#"<p:wipe dir="{dir}"/>"#)),
        TransitionKind::Cover => (None, format!(r#"<p:cover dir="{dir}"/>"#)),
        TransitionKind::Uncover => (None, format!(r#"<p:pull dir="{dir}"/>"#)),
        TransitionKind::Zoom => (None, r#"<p:zoom dir="in"/>"#.to_owned()),
        TransitionKind::Flip => (Some("p14"), format!(r#"<p14:flip dir="{dir}"/>"#)),
        TransitionKind::Morph => (
            Some("p159"),
            r#"<p159:morph option="byObject"/>"#.to_owned(),
        ),
    }
}

/// The element a program that knows no extension reads in place of the extended one.
fn plain(t: &Transition) -> &'static str {
    match t.kind {
        TransitionKind::Flip => r#"<p:push dir="l"/>"#,
        _ => "<p:fade/>",
    }
}

fn speed(seconds: f64) -> &'static str {
    if seconds <= 0.5 {
        "fast"
    } else if seconds <= 1.0 {
        "med"
    } else {
        "slow"
    }
}

/// Writes the slide's `p:transition`, after the colour map override and before the timing.
pub fn write(x: &mut Xml, t: &Transition) {
    let seconds = t
        .duration
        .filter(|d| d.is_finite() && *d >= 0.0)
        .unwrap_or_else(|| usual(&t.kind));
    let ms = (seconds * 1000.0).round() as i64;
    let (needs, markup) = body(t);
    let spd = speed(seconds);
    // The extended forms and the timed ones go inside a choice; a plain one still carries its time for newer programs.
    x.open("mc:AlternateContent").attr("xmlns:mc", NS_MC);
    let (prefix, space) = match needs {
        Some("p159") => (
            "p14 p159",
            format!(r#"xmlns:p14="{NS_P14}" xmlns:p159="{NS_P159}""#),
        ),
        _ => ("p14", format!(r#"xmlns:p14="{NS_P14}""#)),
    };
    x.verbatim(&format!(
        r#"<mc:Choice {space} Requires="{prefix}"><p:transition spd="{spd}" p14:dur="{ms}">{markup}</p:transition></mc:Choice><mc:Fallback><p:transition spd="{spd}">{}</p:transition></mc:Fallback>"#,
        if needs.is_some() { plain(t) } else { markup.as_str() }
    ));
    x.close();
}

/// The transition a `p:transition` node says, as the deck holds it. None for a cut.
pub fn read(
    kind_name: &str,
    dir: Option<&str>,
) -> Option<(TransitionKind, Option<MotionDirection>)> {
    let from = dir.and_then(from_of);
    Some(match kind_name {
        "p:cut" | "p:none" => return None,
        "p:fade" => (TransitionKind::Fade, None),
        "p159:morph" => (TransitionKind::Morph, None),
        "p:dissolve" => (TransitionKind::Dissolve, None),
        "p:push" => (TransitionKind::Push, from),
        "p:wipe" => (TransitionKind::Wipe, from),
        "p:cover" => (TransitionKind::Cover, from),
        "p:pull" => (TransitionKind::Uncover, from),
        "p:zoom" => (TransitionKind::Zoom, None),
        "p14:flip" => (TransitionKind::Flip, from),
        _ => (TransitionKind::Slide, None),
    })
}

#[cfg(test)]
mod tests {
    use slides_core::Extra;

    use super::*;

    fn t(
        kind: TransitionKind,
        direction: Option<MotionDirection>,
        duration: Option<f64>,
    ) -> Transition {
        Transition {
            kind,
            duration,
            direction,
            easing: None,
            extra: Extra::new(),
        }
    }

    fn xml(t: &Transition) -> String {
        let mut x = Xml::fragment();
        write(&mut x, t);
        x.into_string()
    }

    #[test]
    fn a_push_from_the_left_travels_right_and_keeps_its_time() {
        let out = xml(&t(
            TransitionKind::Push,
            Some(MotionDirection::Left),
            Some(0.8),
        ));
        assert!(
            out.contains(
                r#"<p:transition spd="med" p14:dur="800"><p:push dir="r"/></p:transition>"#
            ),
            "{out}"
        );
        assert!(
            out.contains(r#"<mc:Fallback><p:transition spd="med"><p:push dir="r"/>"#),
            "{out}"
        );
    }

    #[test]
    fn each_kind_has_its_element_and_a_plain_fallback_where_it_needs_an_extension() {
        let cases = [
            (TransitionKind::Fade, "<p:fade/>"),
            (TransitionKind::Dissolve, "<p:dissolve/>"),
            (TransitionKind::Wipe, r#"<p:wipe dir="l"/>"#),
            (TransitionKind::Cover, r#"<p:cover dir="l"/>"#),
            (TransitionKind::Uncover, r#"<p:pull dir="l"/>"#),
            (TransitionKind::Zoom, r#"<p:zoom dir="in"/>"#),
            (TransitionKind::Flip, r#"<p14:flip dir="l"/>"#),
            (TransitionKind::Morph, r#"<p159:morph option="byObject"/>"#),
        ];
        for (kind, element) in cases {
            let out = xml(&t(kind.clone(), None, None));
            assert!(out.contains(element), "{kind:?}: {out}");
        }
        let morph = xml(&t(TransitionKind::Morph, None, None));
        assert!(
            morph.contains(r#"<mc:Fallback><p:transition spd="med"><p:fade/>"#),
            "{morph}"
        );
        assert!(morph.contains(r#"Requires="p14 p159""#));
    }

    #[test]
    fn what_is_written_reads_back_to_the_same_kind_and_side() {
        for from in [
            MotionDirection::Left,
            MotionDirection::Right,
            MotionDirection::Up,
            MotionDirection::Down,
        ] {
            assert_eq!(
                read("p:push", Some(dir_of(Some(from.clone())))),
                Some((TransitionKind::Push, Some(from)))
            );
        }
        assert_eq!(read("p:cut", None), None);
        assert_eq!(
            read("p:split", Some("l")),
            Some((TransitionKind::Slide, None))
        );
        assert_eq!(
            read("p:pull", Some("u")),
            Some((TransitionKind::Uncover, Some(MotionDirection::Down)))
        );
    }

    #[test]
    fn a_slide_follows_the_deck_unless_it_says_none() {
        let mut engine =
            slides_core::Engine::create("t", "Light", 2).unwrap_or_else(|e| panic!("{e}"));
        engine
            .apply(
                "set_present",
                serde_json::json!({ "transition": { "kind": "push" } }),
            )
            .unwrap_or_else(|e| panic!("{e}"));
        let mut deck = engine.into_deck();
        assert_eq!(
            arrival(&deck.slides[0], &deck).map(|t| t.kind.clone()),
            Some(TransitionKind::Push)
        );
        deck.slides[0].transition = Some(t(TransitionKind::None, None, None));
        assert!(arrival(&deck.slides[0], &deck).is_none());
    }
}
