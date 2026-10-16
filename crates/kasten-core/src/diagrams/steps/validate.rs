//! What a step may say: ids, labels, style words, links and pictures. The
//! limits are the ones the tools promise agents.

use crate::diagrams::model::valid_id;
use crate::error::{Error, Result};

fn invalid<T>(why: impl Into<String>) -> Result<T> {
    Err(Error::Invalid(why.into()))
}

pub const MAX_LABEL: usize = 2000;

pub fn check_id(id: &str) -> Result<()> {
    if valid_id(id) {
        Ok(())
    } else {
        invalid(format!(
            "“{id}” is not a good id: use 1 to 64 letters, digits, and _ : . -"
        ))
    }
}

pub fn check_label(label: &str) -> Result<()> {
    if label.chars().count() > MAX_LABEL {
        return invalid(format!("A label may have at most {MAX_LABEL} characters"));
    }
    if label
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
    {
        return invalid("A label may not hold control characters");
    }
    Ok(())
}

/// Whether `link` is one a diagram may carry: a web or mail address, a
/// `[[Page]]` link, or a link to another page of the diagram.
pub fn link_ok(link: &str) -> bool {
    let l = link.trim().to_lowercase();
    l.starts_with("http://")
        || l.starts_with("https://")
        || l.starts_with("mailto:")
        || l.starts_with("data:page/id,")
        || (l.starts_with("[[") && l.ends_with("]]"))
}

/// Whether `image` is one a style may name: a picture inside the value or
/// one of the editor's own.
pub fn image_ok(image: &str) -> bool {
    let i = image.trim();
    i.starts_with("data:image/") || (i.starts_with("img/lib/") && !i.contains(".."))
}

/// A style word an agent sets by hand.
pub fn check_style_item(key: &str, value: &str) -> Result<()> {
    let key_ok = !key.is_empty()
        && key.len() <= 40
        && key.starts_with(|c: char| c.is_ascii_alphabetic())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.'));
    if !key_ok {
        return invalid(format!("“{key}” is not a style key (letters and digits)"));
    }
    if value.len() > 300 || value.contains(';') || value.chars().any(char::is_control) {
        return invalid(format!(
            "The value of style key {key} may not have a semicolon or control characters, or be longer than 300 characters"
        ));
    }
    if key == "image" && !image_ok(value) {
        return invalid(
            "A style may name only a picture inside the value (data:image/…) or one of the editor's own (img/lib/…)",
        );
    }
    if matches!(key, "link" | "href" | "url") && !link_ok(value) {
        return invalid(
            "A link must be an http(s) or mailto address, a [[Page]] link or a link to a page of the diagram",
        );
    }
    Ok(())
}

pub fn check_size(what: &str, v: f64) -> Result<()> {
    if !v.is_finite() || !(1.0..=5000.0).contains(&v) {
        return invalid(format!("{what} must be between 1 and 5000, not {v}"));
    }
    Ok(())
}

/// A page is as big as what is drawn on it, which a long pipeline makes far
/// wider than any box.
pub fn check_page_size(what: &str, v: f64) -> Result<()> {
    if !v.is_finite() || !(1.0..=100_000.0).contains(&v) {
        return invalid(format!("{what} must be between 1 and 100000, not {v}"));
    }
    Ok(())
}

pub fn check_coord(what: &str, v: f64) -> Result<()> {
    if !v.is_finite() || v.abs() > 100_000.0 {
        return invalid(format!(
            "{what} must be a number within 100000 of the origin, not {v}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_and_pictures_are_limited_to_what_is_safe() {
        for ok in [
            "https://a.example/x?y=1",
            "http://a",
            "mailto:a@b.c",
            "[[My page]]",
            "data:page/id,page-2",
        ] {
            assert!(link_ok(ok), "{ok}");
        }
        for bad in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://x",
            "data:text/html,x",
            " vbscript:x",
        ] {
            assert!(!link_ok(bad), "{bad}");
        }
        assert!(
            image_ok("data:image/png;base64,AAAA")
                && image_ok("img/lib/clip_art/networking/Router_128x128.png")
        );
        for bad in [
            "https://tracker.example/p.png",
            "img/lib/../../x",
            "/etc/passwd",
            "file:///x.png",
        ] {
            assert!(!image_ok(bad), "{bad}");
        }
    }

    #[test]
    fn style_words_cannot_smuggle_a_second_word_or_a_bad_picture() {
        assert!(check_style_item("fillColor", "#dae8fc").is_ok());
        assert!(check_style_item("fillColor", "#fff;strokeColor=red").is_err());
        assert!(check_style_item("a b", "1").is_err());
        assert!(check_style_item("image", "https://x/y.png").is_err());
        assert!(check_style_item("image", "img/lib/aws4/lambda.png").is_ok());
        assert!(check_style_item("link", "javascript:x").is_err());
        assert!(check_id("web-1").is_ok() && check_id("a b").is_err());
        assert!(check_size("w", 0.0).is_err() && check_size("w", 120.0).is_ok());
    }
}
