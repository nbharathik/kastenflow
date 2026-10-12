//! Importing a diagram made elsewhere: a `.drawio` or `.xml` source, a
//! picture the editor exported with the diagram inside it (`.drawio.svg`,
//! or a PNG with a text chunk), whatever it is called. Only the source is
//! kept as the source; a picture that came in is kept as the picture. Every
//! other kind of file is for the editor's own importer.

use super::files::{picture_file, source_file};
use super::format::{MAX_BYTES, check_svg, check_xml, stamped};
use super::names::{free_pair, stem_of_title};
use super::xml;
use crate::error::{Error, Result};
use crate::note::content_hash;
use crate::ops::kind_folder;
use crate::rollback::Rollback;
use crate::vault::Vault;

/// A PNG may be a large picture with a small diagram in it.
const MAX_PNG_BYTES: usize = 64 * 1024 * 1024;

enum Kind {
    Source,
    Svg,
    Png,
}

/// The kind of file and the title its name gives.
fn kind_of(name: &str) -> Result<(Kind, String)> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let lower = name.to_lowercase();
    let strip = |suffixes: &[&str]| {
        suffixes
            .iter()
            .find(|s| lower.ends_with(**s))
            .and_then(|s| name.get(..name.len().checked_sub(s.len())?))
            .map(str::to_owned)
    };
    if let Some(title) = strip(&[".drawio.svg", ".svg"]) {
        Ok((Kind::Svg, title))
    } else if let Some(title) = strip(&[".drawio.png", ".png"]) {
        Ok((Kind::Png, title))
    } else if let Some(title) = strip(&[".drawio", ".xml"]) {
        Ok((Kind::Source, title))
    } else {
        Err(Error::Invalid(
            "Only .drawio, .xml, .drawio.svg and .drawio.png files can be imported here; open a diagram and use the editor's own import for other kinds, such as .vsdx".to_owned(),
        ))
    }
}

fn percent_decode(bytes: &[u8]) -> Option<String> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let pair = bytes.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The diagram the editor keeps in a PNG's `mxfile` text chunk, as it
/// writes it: percent-encoded.
fn diagram_in_png(bytes: &[u8]) -> Option<String> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let mut at = 8;
    while at + 12 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().ok()?) as usize;
        let kind = &bytes[at + 4..at + 8];
        let end = (at + 8).checked_add(len)?;
        if end + 4 > bytes.len() {
            return None;
        }
        let data = &bytes[at + 8..end];
        if kind == b"tEXt"
            && let Some(nul) = data.iter().position(|b| *b == 0)
            && &data[..nul] == b"mxfile"
        {
            return percent_decode(&data[nul + 1..]);
        }
        if kind == b"IEND" {
            return None;
        }
        at = end + 4;
    }
    None
}

fn text_of(name: &str, bytes: &[u8]) -> Result<String> {
    String::from_utf8(bytes.to_vec())
        .map_err(|_| Error::Invalid(format!("{name} is not UTF-8 text")))
}

/// Makes a diagram from a file named `name` holding `bytes`, in `project` or
/// the library; returns its path. A picture that came with the diagram is
/// kept beside it as its picture. Nothing is made if anything is wrong.
pub fn import_diagram(
    vault: &Vault,
    name: &str,
    bytes: &[u8],
    project: Option<&str>,
) -> Result<String> {
    let (kind, title) = kind_of(name)?;
    let limit = if matches!(kind, Kind::Png) {
        MAX_PNG_BYTES
    } else {
        MAX_BYTES
    };
    if bytes.len() > limit {
        return Err(Error::Invalid(format!(
            "{name} is too large to import ({} MB)",
            bytes.len() / (1024 * 1024)
        )));
    }
    let (source, picture) = match kind {
        Kind::Source => (text_of(name, bytes)?, None),
        Kind::Svg => {
            let svg = text_of(name, bytes)?;
            check_svg(&svg)?;
            let content = xml::scan(&svg, "")
                .ok()
                .and_then(|scan| {
                    scan.root_attrs
                        .into_iter()
                        .find(|(key, _)| key == "content")
                })
                .and_then(|(_, value)| xml::unescape(&value))
                .ok_or_else(|| {
                    Error::Invalid(
                        "This picture holds no diagram: it has no copy of one, so it was not saved by the diagram editor".to_owned(),
                    )
                })?;
            (content, Some(svg))
        }
        Kind::Png => {
            let found = diagram_in_png(bytes).ok_or_else(|| {
                Error::Invalid(
                    "This picture holds no diagram: the PNG has no copy of one inside it"
                        .to_owned(),
                )
            })?;
            (found, None)
        }
    };
    check_xml(&source)?;
    let folder = kind_folder(vault, project, "diagrams")?;
    let path = free_pair(vault, &folder, &stem_of_title(&title));
    let mut done = Rollback::default();
    let made = (|| -> Result<()> {
        done.create(&source_file(vault, &path)?, source.as_bytes())?;
        if let Some(svg) = &picture {
            let text = stamped(svg, &content_hash(&source));
            done.create(&picture_file(vault, &path)?, text.as_bytes())?;
        }
        Ok(())
    })();
    match made {
        Ok(()) => Ok(path),
        Err(err) => {
            done.put_back();
            Err(err)
        }
    }
}
