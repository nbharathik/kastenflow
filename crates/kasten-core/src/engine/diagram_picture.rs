//! A diagram's picture, made ready for the app to draw it as a PNG: the
//! picture the diagram editor drew for this very source when there is one,
//! else the program's own draft, and always cleaned of anything that runs or
//! fetches, so the window that draws it needs no network and runs nothing.

use super::Kasten;
use crate::diagrams::{self, Background, Preview, background_of, sanitize};
use crate::error::{Error, Result};

/// A picture of a diagram, cleaned.
#[derive(Debug, Clone, PartialEq)]
pub struct DiagramPicture {
    /// The SVG text.
    pub svg: String,
    /// `editor` (drawn by the diagram editor for this very source) or `draft`
    /// (drawn by the program).
    pub from: &'static str,
    /// What the draft left out or simplified.
    pub warnings: Vec<String>,
    /// What the diagram says it is drawn on.
    pub background: Background,
}

impl Kasten {
    /// The picture of the diagram at `path` (one of its `page`s, by name) as
    /// cleaned SVG. The editor's own picture is used for the first page when it
    /// is fresh and `use_editor` is true; otherwise the program draws it.
    pub fn diagram_picture(
        &self,
        path: &str,
        page: Option<&str>,
        use_editor: bool,
    ) -> Result<DiagramPicture> {
        let file = self.diagram(path)?;
        let background = background_of(&file.xml);
        let editor = if use_editor && page.is_none() && file.preview == Preview::Fresh {
            self.diagram_preview(path)?
        } else {
            None
        };
        let (svg, from, warnings) = match editor {
            Some(svg) => (svg, "editor", Vec::new()),
            None => {
                let draft = diagrams::draw::draft(&file.xml, page).map_err(|why| {
                    Error::Invalid(format!("A picture of this diagram cannot be drawn: {why}"))
                })?;
                (draft.svg, "draft", draft.warnings)
            }
        };
        let clean = sanitize::sanitize(&svg)?;
        Ok(DiagramPicture {
            svg: clean.svg,
            from,
            warnings,
            background,
        })
    }
}
