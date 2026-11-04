//! A picture's adjustments as the effects PowerPoint puts inside a picture's `a:blip`: blur,
//! greyscale, saturation (`a:hsl`), and brightness with contrast (`a:lum`). PowerPoint draws them
//! a little differently from the editor's filters, so a touched-up picture looks close, not equal.

use slides_core::Adjust;

use crate::units::{length, thousandths};
use crate::xml::Xml;

/// Writes the effects of `adjust`, in the order the schema lists them. Nothing is written for an
/// adjustment that changes nothing.
pub fn write_effects(x: &mut Xml, adjust: &Adjust) {
    let some = |v: Option<f64>| v.filter(|v| v.is_finite() && *v != 0.0);
    if let Some(blur) = adjust.blur.filter(|b| b.is_finite() && *b > 0.0) {
        x.open("a:blur").int("rad", length(blur)).close();
    }
    if adjust.greyscale {
        x.open("a:grayscl").close();
    }
    if let Some(saturation) = some(adjust.saturation) {
        x.open("a:hsl")
            .int("hue", 0)
            .int("sat", thousandths(saturation))
            .int("lum", 0)
            .close();
    }
    let (bright, contrast) = (some(adjust.brightness), some(adjust.contrast));
    if bright.is_some() || contrast.is_some() {
        x.open("a:lum")
            .int("bright", thousandths(bright.unwrap_or(0.0)))
            .int("contrast", thousandths(contrast.unwrap_or(0.0)))
            .close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(adjust: &Adjust) -> String {
        let mut x = Xml::fragment();
        write_effects(&mut x, adjust);
        x.into_string()
    }

    #[test]
    fn nothing_is_written_for_an_adjustment_that_changes_nothing() {
        assert_eq!(written(&Adjust::default()), "");
        let zero = Adjust {
            brightness: Some(0.0),
            ..Adjust::default()
        };
        assert_eq!(written(&zero), "");
    }

    #[test]
    fn each_adjustment_becomes_its_effect() {
        let all = Adjust {
            brightness: Some(0.2),
            contrast: Some(-0.5),
            saturation: Some(-1.0),
            greyscale: true,
            blur: Some(2.0),
            ..Adjust::default()
        };
        let xml = written(&all);
        assert!(xml.contains(r#"<a:blur rad="19050"/>"#), "{xml}");
        assert!(xml.contains("<a:grayscl/>"), "{xml}");
        assert!(
            xml.contains(r#"<a:hsl hue="0" sat="-100000" lum="0"/>"#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"<a:lum bright="20000" contrast="-50000"/>"#),
            "{xml}"
        );
    }
}
