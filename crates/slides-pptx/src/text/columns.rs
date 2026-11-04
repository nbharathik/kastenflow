//! Text in columns: a text box that runs its words in two or three columns says so in `a:bodyPr`
//! (`numCol` and `spcCol`). The box's `columns` and `column_gap` reach the body writer through two
//! private keys on a copy of its text, so the writer's signature does not change.

use slides_core::{Text, TextEl};

use crate::units::length;
use crate::xml::Xml;

const COUNT: &str = "numCol";
const GAP: &str = "spcCol";

/// A copy of the box's text that carries its columns, or None for a box in one column.
pub fn with_columns(el: &TextEl) -> Option<Text> {
    let count = el.columns.filter(|n| (2..=3).contains(n))?;
    let mut text = el.text.clone();
    text.extra.insert(COUNT.to_owned(), count.into());
    if let Some(gap) = el.column_gap.filter(|g| g.is_finite() && *g >= 0.0) {
        text.extra.insert(GAP.to_owned(), gap.into());
    }
    Some(text)
}

/// Writes `numCol` and `spcCol` on the `a:bodyPr` just opened, when the text carries columns.
pub fn write(x: &mut Xml, text: &Text) {
    let Some(count) = text.extra.get(COUNT).and_then(|v| v.as_i64()) else {
        return;
    };
    x.int("numCol", count);
    if let Some(gap) = text.extra.get(GAP).and_then(|v| v.as_f64()) {
        x.int("spcCol", length(gap));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use slides_core::{Base, Element, Extra};

    fn boxed(columns: Option<u8>, gap: Option<f64>) -> TextEl {
        let Element::Text(mut el) = Element::text_el(Base::new("t"), Text::plain("a b c")) else {
            panic!("text")
        };
        el.columns = columns;
        el.column_gap = gap;
        el.extra = Extra::new();
        el
    }

    #[test]
    fn two_or_three_columns_are_carried_and_one_is_not() {
        assert!(with_columns(&boxed(None, None)).is_none());
        assert!(with_columns(&boxed(Some(1), None)).is_none());
        assert!(with_columns(&boxed(Some(4), None)).is_none());
        let two = with_columns(&boxed(Some(2), Some(24.0))).expect("columns");
        assert_eq!(two.extra.get(COUNT).and_then(|v| v.as_i64()), Some(2));
        assert_eq!(two.extra.get(GAP).and_then(|v| v.as_f64()), Some(24.0));
    }

    fn written(text: &Text) -> String {
        use crate::text::{Look, write_body};
        use crate::xml::Xml;
        let look = Look {
            style: "body",
            valign: slides_core::VAlign::Top,
            wrap: true,
            opacity: 1.0,
            flipped: false,
            area: None,
        };
        crate::testing::with_cx(|cx| {
            let mut x = Xml::fragment();
            write_body(&mut x, cx, "p:txBody", text, &look);
            x.into_string()
        })
    }

    #[test]
    fn the_body_says_how_many_columns_and_how_far_apart() {
        let text = with_columns(&boxed(Some(3), Some(24.0))).expect("columns");
        let out = written(&text);
        assert!(out.contains(r#"numCol="3""#), "{out}");
        assert!(out.contains(&format!(r#"spcCol="{}""#, 24 * 9525)), "{out}");
        let plain = written(&Text::plain("x"));
        assert!(
            !plain.contains("numCol") && !plain.contains("spcCol"),
            "{plain}"
        );
    }

    #[test]
    fn a_gap_that_is_not_a_number_of_space_is_left_out() {
        let text = with_columns(&boxed(Some(3), Some(-5.0))).expect("columns");
        assert!(text.extra.get(GAP).is_none());
    }
}
