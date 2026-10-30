//! A picture for a LaTeX document: what its bytes are (looked at, never
//! taken from the name), and the name it is kept under in the document's
//! `figures/` folder. TeX takes a PNG, a JPEG or a PDF; an SVG is kept as the
//! drawing it is but needs a converter that Tectonic does not have. Nothing
//! that runs is kept, whatever it is called.

use crate::error::{Error, Result};

/// The kinds of picture a document keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FigureKind {
    Png,
    Jpg,
    Pdf,
    Svg,
}

impl FigureKind {
    /// The ending the file is kept under.
    pub fn ext(self) -> &'static str {
        match self {
            FigureKind::Png => "png",
            FigureKind::Jpg => "jpg",
            FigureKind::Pdf => "pdf",
            FigureKind::Svg => "svg",
        }
    }

    /// The kind in words, as a sentence names it.
    pub fn label(self) -> &'static str {
        match self {
            FigureKind::Png => "a PNG",
            FigureKind::Jpg => "a JPEG",
            FigureKind::Pdf => "a PDF",
            FigureKind::Svg => "an SVG",
        }
    }

    /// The kind an ending names, if it is one of the four.
    fn named_by(ext: &str) -> Option<FigureKind> {
        match ext {
            "png" => Some(FigureKind::Png),
            "jpg" | "jpeg" => Some(FigureKind::Jpg),
            "pdf" => Some(FigureKind::Pdf),
            "svg" => Some(FigureKind::Svg),
            _ => None,
        }
    }
}

/// Endings of files that run or are run by something.
const PROGRAMS: [&str; 30] = [
    "exe", "dll", "bat", "cmd", "com", "msi", "scr", "sh", "bash", "zsh", "ps1", "psm1", "vbs",
    "vbe", "wsf", "js", "mjs", "jar", "app", "py", "pl", "rb", "so", "dylib", "bin", "lnk", "hta",
    "apk", "dmg", "php",
];

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// Whether the bytes start like something that runs (a Windows or Unix program,
/// a script with a `#!` line).
pub fn is_program(bytes: &[u8]) -> bool {
    bytes.starts_with(b"MZ")
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(b"#!")
        || bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe])
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xcf])
        || bytes.starts_with(&[0xca, 0xfe, 0xba, 0xbe])
}

/// `bytes` after an `<?xml ?>` line, comments and a doctype, if the rest starts an `<svg`.
fn is_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(4096)];
    let text = String::from_utf8_lossy(head);
    let mut rest = text.trim_start_matches('\u{feff}').trim_start();
    loop {
        let skipped = ["<?xml", "<!--", "<!DOCTYPE"]
            .into_iter()
            .find(|open| rest.starts_with(open))
            .and_then(|open| {
                let close = match open {
                    "<?xml" => "?>",
                    "<!--" => "-->",
                    _ => ">",
                };
                rest.find(close).map(|at| &rest[at + close.len()..])
            });
        match skipped {
            Some(after) => rest = after.trim_start(),
            None => break,
        }
    }
    rest.strip_prefix("<svg")
        .and_then(|after| after.chars().next())
        .is_some_and(|c| c.is_whitespace() || c == '>' || c == '/')
}

/// What the bytes are: a PNG (signature and first chunk), a JPEG, a PDF or an SVG.
pub fn sniff(bytes: &[u8]) -> Option<FigureKind> {
    if bytes.len() >= 33
        && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        && bytes[8..12] == [0, 0, 0, 13]
        && &bytes[12..16] == b"IHDR"
    {
        Some(FigureKind::Png)
    } else if bytes.len() >= 4 && bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(FigureKind::Jpg)
    } else if bytes.starts_with(b"%PDF-") {
        Some(FigureKind::Pdf)
    } else if is_svg(bytes) {
        Some(FigureKind::Svg)
    } else {
        None
    }
}

/// A name that is safe in `\includegraphics{...}`: lower-case ASCII letters and
/// digits with single dashes between.
fn stem_of(stem: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() {
            if dash && !out.is_empty() {
                out.push('-');
            }
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else {
            dash = true;
        }
        if out.len() >= 60 {
            break;
        }
    }
    if out.is_empty() {
        "figure".to_owned()
    } else {
        out
    }
}

/// The name and kind a picture is kept under: the kind is what the bytes are,
/// and a name that says another is refused. The folders a name came with are
/// dropped, and a program or script is never kept.
pub fn figure_name(name: &str, bytes: &[u8]) -> Result<(String, FigureKind)> {
    let shown = name.trim();
    let base = shown.rsplit(['/', '\\']).next().unwrap_or(shown).trim();
    if base.is_empty() {
        return Err(invalid("A figure needs a name, such as chart.png"));
    }
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext))
            if !stem.trim().is_empty()
                && !ext.is_empty()
                && ext.len() <= 12
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            (stem, Some(ext.to_ascii_lowercase()))
        }
        _ => (base, None),
    };
    let not_a_program =
        "KastenFlow never keeps a program or script; a figure is a PNG, JPEG or PDF picture";
    if ext.as_deref().is_some_and(|e| PROGRAMS.contains(&e)) || is_program(bytes) {
        return Err(invalid(format!("Cannot keep “{shown}”: {not_a_program}")));
    }
    let named = match ext.as_deref() {
        None => None,
        Some(e) => Some(FigureKind::named_by(e).ok_or_else(|| {
            invalid(format!(
                "Cannot keep “{shown}”: a figure is a PNG, JPEG or PDF (an SVG is kept too, but needs a converter). Make the picture a PNG and send that"
            ))
        })?),
    };
    let kind = sniff(bytes).ok_or_else(|| {
        invalid(format!(
            "Cannot keep “{shown}”: what is inside is not a PNG, JPEG, PDF or SVG picture, whatever the name says"
        ))
    })?;
    if let Some(said) = named.filter(|said| *said != kind) {
        return Err(invalid(format!(
            "“{shown}” is named like {} but holds {}. Name it .{}",
            said.label(),
            kind.label(),
            kind.ext()
        )));
    }
    Ok((stem_of(stem), kind))
}

/// The bytes a base64 text stands for (standard or URL-safe letters, spaces and
/// line breaks ignored; a `data:...;base64,` start is dropped).
pub fn base64_decode(text: &str) -> Result<Vec<u8>> {
    let text = text.trim();
    let text = match text.strip_prefix("data:") {
        Some(rest) => rest.split_once("base64,").map_or(text, |(_, data)| data),
        None => text,
    };
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut bits, mut have) = (0u32, 0u32);
    let mut padded = false;
    for c in text.bytes() {
        let value = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => {
                padded = true;
                continue;
            }
            c if c.is_ascii_whitespace() => continue,
            _ => return Err(not_base64()),
        };
        if padded {
            return Err(not_base64());
        }
        bits = (bits << 6) | u32::from(value);
        have += 6;
        if have >= 8 {
            have -= 8;
            out.push((bits >> have) as u8);
            bits &= (1 << have) - 1;
        }
    }
    // One letter alone cannot stand for a byte.
    if have >= 6 {
        return Err(not_base64());
    }
    Ok(out)
}

fn not_base64() -> Error {
    invalid("base64 is not valid base64. Send the file's bytes as standard base64 text")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1 by 1 PNG.
    const PNG: &[u8] =
        b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89";

    #[test]
    fn the_four_kinds_are_known_by_their_bytes() {
        assert_eq!(sniff(PNG), Some(FigureKind::Png));
        assert_eq!(sniff(b"\xff\xd8\xff\xe0\0\x10JFIF"), Some(FigureKind::Jpg));
        assert_eq!(sniff(b"%PDF-1.4\n%%EOF\n"), Some(FigureKind::Pdf));
        for svg in [
            "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            "\u{feff}<?xml version=\"1.0\"?>\n<!-- made by hand -->\n<!DOCTYPE svg>\n<svg>",
            "  \n<svg\nwidth=\"1\">",
        ] {
            assert_eq!(sniff(svg.as_bytes()), Some(FigureKind::Svg), "{svg}");
        }
        for other in [
            &b""[..],
            b"GIF89a....",
            b"<html><svg></svg></html>",
            b"<svgx>",
            b"\x89PNG\r\n\x1a\n",
            b"plain words",
        ] {
            assert_eq!(sniff(other), None, "{other:?}");
        }
    }

    #[test]
    fn a_name_is_made_safe_and_the_bytes_decide_the_kind() {
        let (stem, kind) = figure_name("charts/My Plot (v2).PNG", PNG).unwrap();
        assert_eq!((stem.as_str(), kind), ("my-plot-v2", FigureKind::Png));
        let (stem, _) = figure_name("é.png", PNG).unwrap();
        assert_eq!(stem, "figure");
        // No ending: the bytes say.
        assert_eq!(figure_name("plot", PNG).unwrap().1, FigureKind::Png);
        // Said otherwise, or not a picture at all.
        let why = figure_name("plot.jpg", PNG).unwrap_err().to_string();
        assert!(why.contains("holds a PNG") && why.contains(".png"), "{why}");
        assert!(figure_name("plot.png", b"hello").is_err());
        assert!(figure_name("plot.gif", b"GIF89a").is_err());
        assert!(figure_name(" ", PNG).is_err());
    }

    #[test]
    fn a_program_is_never_kept_whatever_it_is_called() {
        for (name, bytes) in [
            ("run.exe", &b"MZ\x90\0"[..]),
            ("chart.png", b"MZ\x90\0"),
            ("chart.png", b"\x7fELF\x02\x01"),
            ("chart.pdf", b"#!/bin/sh\necho hi"),
            ("a.SH", PNG),
            ("a.js", b"alert(1)"),
        ] {
            let why = figure_name(name, bytes).unwrap_err().to_string();
            assert!(why.contains("never keeps a program"), "{name}: {why}");
        }
    }

    #[test]
    fn base64_goes_both_ways_and_refuses_what_it_is_not() {
        assert_eq!(base64_decode("Zm9vYmFy").unwrap(), b"foobar");
        assert_eq!(base64_decode("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(base64_decode(" Zm9v\nYmE= ").unwrap(), b"fooba");
        assert_eq!(base64_decode("data:image/png;base64,Zm9v").unwrap(), b"foo");
        assert_eq!(
            base64_decode("-_-_").unwrap(),
            base64_decode("+/+/").unwrap()
        );
        for bad in ["Zm9v!", "Zm9vY", "Zg==Zg", "a"] {
            assert!(base64_decode(bad).is_err(), "{bad}");
        }
    }
}
