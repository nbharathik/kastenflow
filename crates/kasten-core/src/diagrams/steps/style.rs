//! `update` and `restyle`: words, kinds, colours and style words of cells
//! that are already there.

use std::collections::BTreeMap;

use super::validate::{check_label, check_style_item};
use super::{Runner, Step, invalid};
use crate::diagrams::model::{Cell, Kind, Style, label_html};
use crate::diagrams::presets;
use crate::error::Result;

/// The style a kind of node, group or edge gives to a cell.
fn kind_style(cell: &Cell, name: &str) -> Result<Style> {
    let found = if cell.is_edge() {
        presets::edge_kind(name).map(|k| k.style)
    } else {
        presets::node_kind(name)
            .filter(|k| k.shape.is_none())
            .map(|k| k.style)
            .or_else(|| presets::group_kind(name).map(|k| k.style))
    };
    found.map(Style::parse).ok_or_else(|| {
        let names = if cell.is_edge() {
            presets::edge_kind_names()
        } else {
            presets::node_kind_names()
                .into_iter()
                .chain(presets::group_kind_names())
                .collect()
        };
        invalid(format!(
            "No kind called “{name}” for “{}”. The kinds are {}",
            cell.id,
            names.join(", ")
        ))
    })
}

fn check_set(set: &Option<BTreeMap<String, String>>, unset: &Option<Vec<String>>) -> Result<()> {
    for (k, v) in set.iter().flatten() {
        check_style_item(k, v)?;
    }
    for k in unset.iter().flatten() {
        check_style_item(k, "")?;
    }
    Ok(())
}

/// A new label for `cell`: a C4 cell keeps its template and changes its name.
fn relabel(cell: &mut Cell, text: &str) {
    if cell.attr("placeholders") == Some("1") && cell.attr("c4Name").is_some() {
        let mut lines = text.lines();
        let name = lines.next().unwrap_or("").trim().to_owned();
        let rest = lines.collect::<Vec<_>>().join(" ");
        for (k, v) in &mut cell.attrs {
            match k.as_str() {
                "c4Name" => v.clone_from(&name),
                "c4Description" if !rest.is_empty() => v.clone_from(&rest),
                _ => {}
            }
        }
    } else {
        cell.label = if cell.style.flag("html") {
            label_html(text)
        } else {
            text.to_owned()
        };
    }
}

impl Runner {
    fn styled(&mut self, id: &str) -> Result<&mut Cell> {
        match self.page_mut().get_mut(id) {
            Some(c) if matches!(c.kind, Kind::Vertex | Kind::Edge) => Ok(c),
            _ => Err(invalid(format!(
                "No node or edge called “{id}”. Check the ids with diagram_describe"
            ))),
        }
    }

    pub(super) fn update(&mut self, step: &Step) -> Result<()> {
        let Step::Update {
            id,
            label,
            kind,
            set,
            unset,
        } = step
        else {
            return Err(invalid("not an update step"));
        };
        if let Some(l) = label {
            check_label(l)?;
        }
        check_set(set, unset)?;
        let cell = self.styled(id)?;
        if let Some(name) = kind {
            let style = kind_style(cell, name)?;
            cell.style = style;
        }
        apply_words(cell, set, unset);
        if let Some(l) = label {
            relabel(cell, l);
        }
        self.applied.updated += 1;
        Ok(())
    }

    pub(super) fn restyle(&mut self, step: &Step) -> Result<()> {
        let Step::Restyle {
            ids,
            token,
            kind,
            preset,
            set,
            unset,
        } = step
        else {
            return Err(invalid("not a restyle step"));
        };
        check_set(set, unset)?;
        if ids.is_empty() {
            return Err(invalid("Name the cells to restyle in ids"));
        }
        if kind.is_some() && preset.is_some() {
            return Err(invalid("Give a kind or a preset, not both"));
        }
        let kind = kind.as_ref().or(preset.as_ref());
        for id in ids {
            let cell = self.styled(id)?;
            if let Some(name) = kind {
                let style = kind_style(cell, name)?;
                cell.style = style;
            }
            if let Some(t) = token {
                presets::apply_token(&mut cell.style, t, cell.kind == Kind::Edge)
                    .map_err(invalid)?;
            }
            apply_words(cell, set, unset);
            self.applied.updated += 1;
        }
        Ok(())
    }
}

fn apply_words(
    cell: &mut Cell,
    set: &Option<BTreeMap<String, String>>,
    unset: &Option<Vec<String>>,
) {
    for (k, v) in set.iter().flatten() {
        cell.style.set(k, v);
    }
    for k in unset.iter().flatten() {
        cell.style.remove(k);
    }
}
