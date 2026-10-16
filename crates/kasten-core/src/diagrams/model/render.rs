//! A changed model written back into the text it was read from: every change
//! to a cell that was in the file is a replacement of the bytes it touches,
//! a cell taken out takes its lines, and new cells and pages are put in front
//! of `</root>` and `</mxfile>` with their neighbours' indentation. Cells
//! nobody changed are not touched at all.

use super::Doc;
use super::cells::{Cell, Geo, Kind, Origin, Page};
use super::edit::{Edit, apply, drop_attr, indent_before, line_range, set_attr};
use super::text::{esc_attr, fmt_num};

const MODEL_ATTRS: &str = "dx=\"1000\" dy=\"600\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\"";

fn attr_text(name: &str, value: &str) -> String {
    format!(" {name}=\"{}\"", esc_attr(value))
}

fn optional(out: &mut String, name: &str, value: &Option<String>) {
    if let Some(v) = value {
        out.push_str(&attr_text(name, v));
    }
}

/// The `mxGeometry` element for `cell`, its first line indented by nothing
/// (the caller places it) and its inner lines by `ind`.
fn geometry_xml(cell: &Cell, geo: &Geo, ind: &str) -> String {
    let mut attrs = String::new();
    let mut numbered = |name: &str, v: f64, always: bool| {
        if always || v != 0.0 {
            attrs.push_str(&attr_text(name, &fmt_num(v)));
        }
    };
    numbered("x", geo.x, !geo.relative);
    numbered("y", geo.y, !geo.relative);
    numbered("width", geo.w, !geo.relative);
    numbered("height", geo.h, !geo.relative);
    if geo.relative {
        attrs.push_str(" relative=\"1\"");
    }
    if geo.points.is_empty() && cell.extra_points.is_empty() {
        return format!("<mxGeometry{attrs} as=\"geometry\" />");
    }
    let mut out = format!("<mxGeometry{attrs} as=\"geometry\">\n");
    if !geo.points.is_empty() {
        out.push_str(&format!("{ind}  <Array as=\"points\">\n"));
        for (x, y) in &geo.points {
            out.push_str(&format!(
                "{ind}    <mxPoint x=\"{}\" y=\"{}\" />\n",
                fmt_num(*x),
                fmt_num(*y)
            ));
        }
        out.push_str(&format!("{ind}  </Array>\n"));
    }
    for extra in &cell.extra_points {
        out.push_str(&format!("{ind}  {extra}\n"));
    }
    out.push_str(&format!("{ind}</mxGeometry>"));
    out
}

/// A cell that is not in the file yet, as the editor would write it.
fn new_cell_xml(cell: &Cell, ind: &str) -> String {
    let mut out = String::new();
    let (inner, close) = match &cell.wrapper {
        Some(name) => {
            out.push_str(&format!("{ind}<{name}"));
            for (k, v) in &cell.attrs {
                out.push_str(&attr_text(k, v));
            }
            out.push_str(&attr_text("label", &cell.label));
            out.push_str(&attr_text("id", &cell.id));
            out.push_str(">\n");
            (format!("{ind}  "), Some(format!("{ind}</{name}>\n")))
        }
        None => (ind.to_owned(), None),
    };
    out.push_str(&format!("{inner}<mxCell"));
    if cell.wrapper.is_none() {
        out.push_str(&attr_text("id", &cell.id));
        if !cell.label.is_empty() || cell.kind == Kind::Edge {
            out.push_str(&attr_text("value", &cell.label));
        }
    }
    if !cell.style.is_empty() {
        out.push_str(&attr_text("style", &cell.style.to_string()));
    }
    match cell.kind {
        Kind::Vertex => out.push_str(" vertex=\"1\""),
        Kind::Edge => out.push_str(" edge=\"1\""),
        _ => {}
    }
    optional(&mut out, "parent", &cell.parent);
    optional(&mut out, "source", &cell.source);
    optional(&mut out, "target", &cell.target);
    match &cell.geo {
        Some(geo) => {
            let child = format!("{inner}  ");
            out.push_str(&format!(
                ">\n{child}{}\n{inner}</mxCell>\n",
                geometry_xml(cell, geo, &child)
            ));
        }
        None => out.push_str(" />\n"),
    }
    if let Some(close) = close {
        out.push_str(&close);
    }
    out
}

impl Doc {
    /// The text with every change made.
    pub fn render(&self) -> Result<String, String> {
        let mut edits = Vec::new();
        let mut fresh: Vec<&Page> = Vec::new();
        for page in &self.pages {
            if page.src.is_some() {
                self.page_edits(page, &mut edits);
            } else {
                fresh.push(page);
            }
        }
        if !fresh.is_empty() {
            let Some(close) = self.tree.nodes[self.tree.root].close.clone() else {
                return Err("This diagram cannot take another page".to_owned());
            };
            if self.tree.nodes[self.tree.root].name != "mxfile" {
                return Err("A diagram saved as a bare model cannot take another page. Open it in the editor and save it once".to_owned());
            }
            let pre = indent_before(&self.text, close.start);
            let at = close.start - pre.map_or(0, str::len);
            let ind = format!("{}  ", pre.unwrap_or(""));
            let mut text = String::new();
            for page in fresh {
                text.push_str(&self.new_page_xml(page, &ind));
            }
            let text = if pre.is_some() {
                text
            } else {
                format!("\n{text}")
            };
            edits.push(Edit::insert(at, text));
        }
        apply(&self.text, edits)
    }

    fn new_page_xml(&self, page: &Page, ind: &str) -> String {
        let (w, h) = (page.width.unwrap_or(850.0), page.height.unwrap_or(1100.0));
        let mut out = format!(
            "{ind}<diagram{}{}>\n{ind}  <mxGraphModel {MODEL_ATTRS} pageWidth=\"{}\" pageHeight=\"{}\" math=\"0\" shadow=\"0\">\n{ind}    <root>\n",
            attr_text("id", &page.id),
            attr_text("name", &page.name),
            fmt_num(w),
            fmt_num(h)
        );
        let cell_ind = format!("{ind}      ");
        for cell in page.live() {
            out.push_str(&new_cell_xml(cell, &cell_ind));
        }
        out.push_str(&format!(
            "{ind}    </root>\n{ind}  </mxGraphModel>\n{ind}</diagram>\n"
        ));
        out
    }

    fn page_edits(&self, page: &Page, edits: &mut Vec<Edit>) {
        let Some(src) = &page.src else { return };
        let tree = &self.tree;
        if let Some(d) = src.diagram
            && page.name != page.orig_name
        {
            edits.push(set_attr(&tree.nodes[d], "name", &page.name));
        }
        let model = &tree.nodes[src.model];
        if page.width != page.orig_size.0
            && let Some(w) = page.width
        {
            edits.push(set_attr(model, "pageWidth", &fmt_num(w)));
        }
        if page.height != page.orig_size.1
            && let Some(h) = page.height
        {
            edits.push(set_attr(model, "pageHeight", &fmt_num(h)));
        }
        let mut added = String::new();
        let root = &tree.nodes[src.root];
        let mut ind = root
            .children
            .last()
            .and_then(|&c| indent_before(&self.text, tree.nodes[c].open.start))
            .map(str::to_owned);
        if ind.is_none()
            && let Some(close) = &root.close
        {
            ind = indent_before(&self.text, close.start).map(|i| format!("{i}  "));
        }
        let ind = ind.unwrap_or_else(|| "  ".to_owned());
        for cell in &page.cells {
            match (&cell.origin, cell.gone) {
                (Some(o), true) => {
                    let span = o
                        .wrapper
                        .map_or_else(|| tree.nodes[o.node].span(), |w| tree.nodes[w].span());
                    edits.push(Edit {
                        range: line_range(&self.text, span),
                        text: String::new(),
                    });
                }
                (Some(o), false) => self.cell_edits(cell, o, edits),
                (None, false) => added.push_str(&new_cell_xml(cell, &ind)),
                (None, true) => {}
            }
        }
        if !added.is_empty()
            && let Some(close) = &root.close
        {
            match indent_before(&self.text, close.start) {
                Some(pre) => edits.push(Edit::insert(close.start - pre.len(), added)),
                None => edits.push(Edit::insert(close.start, format!("\n{added}"))),
            }
        }
    }

    fn cell_edits(&self, c: &Cell, o: &Origin, edits: &mut Vec<Edit>) {
        let tree = &self.tree;
        let node = &tree.nodes[o.node];
        let old = &o.values;
        let holder = &tree.nodes[o.wrapper.unwrap_or(o.node)];
        if c.label != old.label {
            if c.label_in_wrapper {
                edits.push(set_attr(holder, "label", &c.label));
            } else {
                edits.push(set_attr(node, "value", &c.label));
            }
        }
        if c.style != old.style {
            if c.style.is_empty() {
                edits.extend(drop_attr(node, "style"));
            } else {
                edits.push(set_attr(node, "style", &c.style.to_string()));
            }
        }
        for (name, now, was) in [
            ("parent", &c.parent, &old.parent),
            ("source", &c.source, &old.source),
            ("target", &c.target, &old.target),
        ] {
            if now != was {
                match now {
                    Some(v) => edits.push(set_attr(node, name, v)),
                    None => edits.extend(drop_attr(node, name)),
                }
            }
        }
        if c.attrs != old.attrs && o.wrapper.is_some() {
            for (k, v) in &c.attrs {
                if !old.attrs.iter().any(|(ok, ov)| ok == k && ov == v) {
                    edits.push(set_attr(holder, k, v));
                }
            }
            for (k, _) in &old.attrs {
                if !c.attrs.iter().any(|(nk, _)| nk == k) {
                    edits.extend(drop_attr(holder, k));
                }
            }
        }
        if c.geo != old.geo
            && let Some(geo) = &c.geo
        {
            self.geometry_edits(c, o, geo, old.geo.as_ref(), edits);
        }
    }

    fn geometry_edits(
        &self,
        c: &Cell,
        o: &Origin,
        geo: &Geo,
        old: Option<&Geo>,
        edits: &mut Vec<Edit>,
    ) {
        let tree = &self.tree;
        let cn = &tree.nodes[o.node];
        match (o.geometry, old) {
            (Some(g), Some(was)) => {
                let gn = &tree.nodes[g];
                if was.points == geo.points && was.relative == geo.relative {
                    for (name, now, before) in [
                        ("x", geo.x, was.x),
                        ("y", geo.y, was.y),
                        ("width", geo.w, was.w),
                        ("height", geo.h, was.h),
                    ] {
                        if now != before {
                            edits.push(set_attr(gn, name, &fmt_num(now)));
                        }
                    }
                } else {
                    let ind = indent_before(&self.text, gn.open.start).unwrap_or("");
                    edits.push(Edit {
                        range: gn.span(),
                        text: geometry_xml(c, geo, ind),
                    });
                }
            }
            _ => {
                let ind = indent_before(&self.text, cn.open.start).unwrap_or("");
                let child = format!("{ind}  ");
                let xml = geometry_xml(c, geo, &child);
                match &cn.close {
                    Some(close) => match indent_before(&self.text, close.start) {
                        Some(pre) => {
                            edits.push(Edit::insert(
                                close.start - pre.len(),
                                format!("{child}{xml}\n"),
                            ));
                        }
                        None => edits.push(Edit::insert(close.start, xml)),
                    },
                    None => edits.push(Edit {
                        range: cn.attr_end..cn.open.end,
                        text: format!(">\n{child}{xml}\n{ind}</mxCell>"),
                    }),
                }
            }
        }
    }
}
