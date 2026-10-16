//! What a picture is, from its first bytes: PNG, JPEG, GIF and WebP, and the
//! size it says it has. The name and the type the window gave it are not
//! trusted. An SVG is not a picture here: it is text, and the window sends it
//! as text.

/// A picture's type and, when its header says so, its size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sniffed {
    pub mime: &'static str,
    pub size: Option<(u32, u32)>,
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
    ])))
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
    ])))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
        *b.get(at + 2)?,
        *b.get(at + 3)?,
    ]))
}

fn le24(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
        *b.get(at + 2)?,
        0,
    ]))
}

fn png(b: &[u8]) -> Option<Sniffed> {
    b.starts_with(b"\x89PNG\r\n\x1a\n").then(|| Sniffed {
        mime: "image/png",
        size: be32(b, 16).zip(be32(b, 20)),
    })
}

fn gif(b: &[u8]) -> Option<Sniffed> {
    (b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a")).then(|| Sniffed {
        mime: "image/gif",
        size: le16(b, 6).zip(le16(b, 8)),
    })
}

/// The first start-of-frame marker holds the size.
fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    while at + 4 <= b.len() {
        if b[at] != 0xFF {
            at += 1;
            continue;
        }
        let marker = b[at + 1];
        match marker {
            0xFF => at += 1,
            // Padding, restart markers and the start of an image have no length.
            0x00 | 0x01 | 0xD0..=0xD8 => at += 2,
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                return be16(b, at + 7).zip(be16(b, at + 5));
            }
            _ => at += 2 + be16(b, at + 2)? as usize,
        }
    }
    None
}

fn jpeg(b: &[u8]) -> Option<Sniffed> {
    b.starts_with(&[0xFF, 0xD8, 0xFF]).then(|| Sniffed {
        mime: "image/jpeg",
        size: jpeg_size(b),
    })
}

fn webp_size(b: &[u8]) -> Option<(u32, u32)> {
    match b.get(12..16)? {
        b"VP8 " => Some((le16(b, 26)? & 0x3FFF, le16(b, 28)? & 0x3FFF)),
        b"VP8L" => {
            let bits = u32::from_le_bytes([*b.get(21)?, *b.get(22)?, *b.get(23)?, *b.get(24)?]);
            Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        b"VP8X" => Some((le24(b, 24)? + 1, le24(b, 27)? + 1)),
        _ => None,
    }
}

fn webp(b: &[u8]) -> Option<Sniffed> {
    (b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP")).then(|| Sniffed {
        mime: "image/webp",
        size: webp_size(b),
    })
}

/// The picture `bytes` is, if it is a PNG, JPEG, GIF or WebP.
pub fn picture(bytes: &[u8]) -> Option<Sniffed> {
    png(bytes)
        .or_else(|| jpeg(bytes))
        .or_else(|| gif(bytes))
        .or_else(|| webp(bytes))
}

/// Whether the start of `bytes` reads as an SVG or other XML.
pub fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(512)];
    let text = String::from_utf8_lossy(head);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg"))
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! Pictures made by hand, only as large as their headers.

    pub fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        b.extend(w.to_be_bytes());
        b.extend(h.to_be_bytes());
        b.extend([8, 6, 0, 0, 0]);
        b
    }

    pub fn gif(w: u16, h: u16) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend(w.to_le_bytes());
        b.extend(h.to_le_bytes());
        b
    }

    pub fn jpeg(w: u16, h: u16) -> Vec<u8> {
        // SOI, an APP0 segment to step over, then SOF0 with the size.
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0];
        b.extend([0xFF, 0xC0, 0, 11, 8]);
        b.extend(h.to_be_bytes());
        b.extend(w.to_be_bytes());
        b.extend([1, 1, 0x11, 0]);
        b
    }

    pub fn webp_lossy(w: u16, h: u16) -> Vec<u8> {
        let mut b = vec![0u8; 30];
        b[..4].copy_from_slice(b"RIFF");
        b[8..16].copy_from_slice(b"WEBPVP8 ");
        b[26..28].copy_from_slice(&w.to_le_bytes());
        b[28..30].copy_from_slice(&h.to_le_bytes());
        b
    }
}

#[cfg(test)]
mod tests {
    use super::{fixtures as made, looks_like_svg, picture};

    #[test]
    fn the_four_kinds_are_known_by_their_first_bytes_and_say_their_size() {
        let at = |bytes: Vec<u8>| picture(&bytes).map(|s| (s.mime, s.size));
        assert_eq!(
            at(made::png(640, 480)),
            Some(("image/png", Some((640, 480))))
        );
        assert_eq!(at(made::gif(32, 16)), Some(("image/gif", Some((32, 16)))));
        assert_eq!(
            at(made::jpeg(1200, 800)),
            Some(("image/jpeg", Some((1200, 800))))
        );
        assert_eq!(
            at(made::webp_lossy(300, 200)),
            Some(("image/webp", Some((300, 200))))
        );
    }

    #[test]
    fn a_header_cut_short_is_still_the_kind_it_says_with_no_size() {
        assert_eq!(picture(b"\x89PNG\r\n\x1a\n").map(|s| s.size), Some(None));
        assert_eq!(
            picture(&[0xFF, 0xD8, 0xFF, 0xE0]).map(|s| s.size),
            Some(None)
        );
    }

    #[test]
    fn anything_else_is_not_a_picture_and_an_svg_is_text() {
        for bytes in [&b"just words"[..], b"%PDF-1.7", b"", b"GIF", &[0xFF, 0xD8]] {
            assert!(picture(bytes).is_none(), "{bytes:?}");
        }
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert!(picture(svg).is_none() && looks_like_svg(svg));
        assert!(looks_like_svg(
            b"\xEF\xBB\xBF<?xml version=\"1.0\"?>\n<svg></svg>"
        ));
        assert!(!looks_like_svg(b"<html></html>"));
    }
}
