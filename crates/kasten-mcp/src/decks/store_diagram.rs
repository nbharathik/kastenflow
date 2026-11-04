//! A draw.io diagram of the vault, drawn as a picture for a deck (`place_diagram`): the editor's own picture when it drew
//! one for this very diagram, else the program's draft. It is cleaned of scripts and outside links before it is kept.

use std::sync::Mutex;

use kasten_core::Kasten;
use kasten_core::agent::ChangeSet;
use kasten_core::diagrams::{self, Preview, title_of};
use slides_core::agent::{DiagramPicture, StoreError, StoreResult};

use super::store::failed;
use crate::tools::locked;

/// The picture of the diagram `name` (its path or its title), with the staged changes of a chat on top when it has some.
pub(super) fn picture(
    kasten: &Kasten,
    stage: Option<&Mutex<ChangeSet>>,
    name: &str,
) -> StoreResult<DiagramPicture> {
    if !kasten.config().plugin_enabled("diagrams") {
        return Err(StoreError::Unavailable(format!(
            "{}: a diagram is a file of that plugin, and it is off",
            crate::plugins::turn_on_sentence("diagrams")
        )));
    }
    let (path, file) = match stage {
        Some(set) => {
            let set = locked(set);
            let path = kasten.resolve_diagram_staged(&set, name).map_err(failed)?;
            let file = kasten.diagram_in(&set, &path).map_err(failed)?;
            (path, file)
        }
        None => {
            let path = kasten.resolve_diagram(name).map_err(failed)?;
            let file = kasten.diagram(&path).map_err(failed)?;
            (path, file)
        }
    };
    let editors = if stage.is_none() && file.preview == Preview::Fresh {
        kasten.diagram_preview(&path).map_err(failed)?
    } else {
        None
    };
    let svg = match editors {
        Some(svg) => svg,
        None => {
            diagrams::draw::draft(&file.xml, None)
                .map_err(|why| {
                    StoreError::Invalid(format!(
                        "A picture of this diagram cannot be drawn without the diagram editor: {why}. Open the diagram in KastenFlow once and it is drawn."
                    ))
                })?
                .svg
        }
    };
    let clean = diagrams::sanitize::sanitize(&svg).map_err(failed)?;
    Ok(DiagramPicture {
        hash: file.hash.clone(),
        name: format!("{}.svg", title_of(&path)),
        bytes: clean.svg.into_bytes(),
        diagram: path,
    })
}
