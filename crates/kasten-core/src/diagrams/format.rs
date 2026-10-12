//! What a diagram's two files must look like, and the stamp that ties the
//! picture to the source it was drawn from.

use super::xml;
use crate::error::{Error, Result};

/// The source: uncompressed `mxfile` XML, readable in a diff and by agents.
pub const EXT: &str = ".drawio";
/// The picture beside it: an ordinary SVG that the editor's export also
/// embeds the editable diagram in.
pub const SIDECAR_EXT: &str = ".drawio.svg";
/// The largest source or picture, in bytes.
pub const MAX_BYTES: usize = 5 * 1024 * 1024;

const STAMP_OPEN: &str = "<!-- kasten-source: ";
const STAMP_CLOSE: &str = " -->";

/// The picture's path, from the source's.
pub fn sidecar_of(path: &str) -> String {
    format!("{path}{}", &SIDECAR_EXT[EXT.len()..])
}

/// A diagram with one empty page, as the editor writes a new one.
pub fn blank_xml() -> String {
    "<mxfile host=\"Kasten\">\n  <diagram id=\"page-1\" name=\"Page-1\">\n    <mxGraphModel dx=\"1000\" dy=\"600\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"850\" pageHeight=\"1100\" math=\"0\" shadow=\"0\">\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n".to_owned()
}

fn too_large(what: &str, len: usize) -> Error {
    Error::Invalid(format!(
        "This {what} is too large ({:.1} MB); the limit is {} MB",
        len as f64 / (1024.0 * 1024.0),
        MAX_BYTES / (1024 * 1024)
    ))
}

/// Checks that `xml` is a well-formed diagram of a sensible size, and
/// returns how many pages it has. Nothing in it is run or fetched: it is
/// only read, so no declaration (`<!DOCTYPE`, `<!ENTITY`) is accepted.
pub fn check_xml(xml: &str) -> Result<usize> {
    if xml.len() > MAX_BYTES {
        return Err(too_large("diagram", xml.len()));
    }
    let scan = xml::scan(xml, "diagram")
        .map_err(|why| Error::Invalid(format!("Not a well-formed diagram. {why}")))?;
    match scan.root.as_str() {
        "mxfile" => Ok(scan.count),
        "mxGraphModel" => Ok(1),
        other => Err(Error::Invalid(format!(
            "This is not a diagram: its root element is <{other}>, not <mxfile>"
        ))),
    }
}

/// Checks that `svg` is a well-formed SVG of a sensible size with nothing in
/// it that runs. It is only ever shown through an `<img>`, never inlined.
pub fn check_svg(svg: &str) -> Result<()> {
    if svg.len() > MAX_BYTES {
        return Err(too_large("picture", svg.len()));
    }
    let scan = xml::scan(svg, "")
        .map_err(|why| Error::Invalid(format!("Not a well-formed picture. {why}")))?;
    if scan.root != "svg" {
        return Err(Error::Invalid(format!(
            "This is not an SVG picture: its root element is <{}>",
            scan.root
        )));
    }
    if scan.script {
        return Err(Error::Invalid(
            "A picture of a diagram may not hold a script element".to_owned(),
        ));
    }
    Ok(())
}

fn without_stamp(svg: &str) -> &str {
    match (svg.rfind("</svg>"), svg.rfind(STAMP_OPEN)) {
        (Some(end), Some(at)) if at > end => &svg[..at],
        _ => svg,
    }
}

/// `svg` with a trailing comment naming the hash of the source it was drawn
/// from, in place of any earlier one. A comment after the root is part of
/// the XML, and the picture itself is not touched.
pub fn stamped(svg: &str, hash: &str) -> String {
    format!(
        "{}\n{STAMP_OPEN}{hash}{STAMP_CLOSE}\n",
        without_stamp(svg).trim_end()
    )
}

/// The hash a picture was stamped with.
pub fn stamp_of(svg: &str) -> Option<&str> {
    let end = svg.rfind("</svg>")?;
    let at = svg.rfind(STAMP_OPEN).filter(|at| *at > end)?;
    let rest = &svg[at + STAMP_OPEN.len()..];
    Some(&rest[..rest.find(STAMP_CLOSE)?])
}

/// The hash in the stamp at the end of a picture, from only its last bytes.
pub(super) fn stamp_in_tail(tail: &str) -> Option<&str> {
    let at = tail.rfind(STAMP_OPEN)?;
    let rest = &tail[at + STAMP_OPEN.len()..];
    Some(&rest[..rest.find(STAMP_CLOSE)?])
}
