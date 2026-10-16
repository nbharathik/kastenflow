//! The model against the golden diagrams: reading them, writing them back
//! unchanged, and changing a cell by replacing only the bytes it owns.

use super::*;

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/diagrams/",
            $name
        ))
    };
}

const EDITOR: &str = fixture!("editor-output.drawio");
const C4: &str = fixture!("c4-objects.drawio");
const NESTED: &str = fixture!("nested-container.drawio");
const COMPRESSED_FILE: &str = fixture!("compressed.drawio");
const BARE: &str = fixture!("bare-model.drawio");

#[test]
fn every_golden_diagram_is_written_back_byte_for_byte_when_nothing_changed() {
    for text in [EDITOR, C4, NESTED, BARE] {
        let doc = Doc::parse(text).unwrap();
        assert_eq!(doc.render().unwrap(), text);
    }
}

#[test]
fn cells_are_read_with_labels_styles_geometry_and_parents() {
    let doc = Doc::parse(EDITOR).unwrap();
    let page = &doc.pages[0];
    assert_eq!((page.id.as_str(), page.name.as_str()), ("d1x4Qk", "Page-1"));
    assert_eq!(page.count(), 5);
    let api = page.get("api").unwrap();
    assert_eq!(api.text(), "API\ngateway");
    assert_eq!(api.style.get("fillColor"), Some("#d5e8d4"));
    assert_eq!(api.parent.as_deref(), Some("1"));
    assert_eq!(page.get("db").unwrap().text(), "Orders & users");
    let e2 = page.get("e2").unwrap();
    assert_eq!(
        (e2.source.as_deref(), e2.target.as_deref()),
        (Some("api"), Some("db"))
    );
    assert_eq!(e2.geo.as_ref().unwrap().points, vec![(400.0, 110.0)]);
    assert_eq!(page.default_parent(), "1");
}

#[test]
fn a_child_is_placed_relative_to_its_container_and_the_page_sees_it_absolutely() {
    let doc = Doc::parse(NESTED).unwrap();
    let page = &doc.pages[0];
    assert_eq!(page.get("app").unwrap().geo.as_ref().unwrap().x, 30.0);
    assert_eq!(
        page.abs("app"),
        Some(Rect {
            x: 130.0,
            y: 160.0,
            w: 120.0,
            h: 60.0
        })
    );
    assert_eq!(page.abs("vpc").unwrap().x, 100.0);
    assert_eq!(page.common_parent("app", "cache"), "vpc");
    assert_eq!(page.common_parent("user", "app"), "1");
    assert!(page.inside("app", "vpc") && !page.inside("user", "vpc"));
    assert_eq!(page.descendants("vpc").len(), 3);
}

#[test]
fn c4_objects_carry_their_fields_and_show_their_filled_in_words() {
    let doc = Doc::parse(C4).unwrap();
    let page = &doc.pages[0];
    let cust = page.get("cust").unwrap();
    assert_eq!(cust.wrapper.as_deref(), Some("object"));
    assert_eq!(cust.attr("c4Name"), Some("Customer"));
    assert_eq!(cust.text(), "Customer\n[Person]\nBuys things online.");
    assert_eq!(
        page.get("docs").unwrap().wrapper.as_deref(),
        Some("UserObject")
    );
    assert_eq!(page.get("docs").unwrap().text(), "Docs");
    let rel = page.get("rel1").unwrap();
    assert!(rel.is_edge() && rel.source.as_deref() == Some("cust"));
    assert_eq!(rel.extra_points.len(), 2);
}

#[test]
fn a_compressed_page_is_refused_with_a_hint_and_a_bare_model_is_one_page() {
    let err = Doc::parse(COMPRESSED_FILE).unwrap_err().to_string();
    assert!(
        err.contains("saved compressed") && err.contains("editor"),
        "{err}"
    );
    let doc = Doc::parse(BARE).unwrap();
    assert_eq!(doc.pages.len(), 1);
    assert_eq!(doc.pages[0].count(), 3);
    assert!(Doc::parse("<svg/>").is_err());
    assert!(Doc::parse("<mxfile></mxfile>").is_err());
}

#[test]
fn changing_a_label_replaces_only_that_value() {
    let mut doc = Doc::parse(EDITOR).unwrap();
    doc.pages[0].get_mut("web").unwrap().label = label_html("Web & mobile");
    let out = doc.render().unwrap();
    assert_eq!(
        out,
        EDITOR.replace("value=\"Web app\"", "value=\"Web &amp;amp; mobile\"")
    );
    assert_eq!(
        Doc::parse(&out).unwrap().pages[0]
            .get("web")
            .unwrap()
            .text(),
        "Web & mobile"
    );
}

#[test]
fn changing_a_style_and_a_position_replaces_only_those_values() {
    let mut doc = Doc::parse(EDITOR).unwrap();
    let web = doc.pages[0].get_mut("web").unwrap();
    web.style.set("fillColor", "#f8cecc");
    web.geo.as_mut().unwrap().x = 60.0;
    let out = doc.render().unwrap();
    let want = EDITOR
        .replacen("fillColor=#dae8fc;", "fillColor=#f8cecc;", 1)
        .replacen("x=\"40\" y=\"80\"", "x=\"60\" y=\"80\"", 1);
    assert_eq!(out, want);
}

#[test]
fn a_new_cell_goes_before_the_end_of_root_with_its_neighbours_indentation() {
    let mut doc = Doc::parse(EDITOR).unwrap();
    let mut cell = Cell::new("n1", Kind::Vertex);
    cell.parent = Some("1".into());
    cell.label = "New <one>".into();
    cell.style = Style::parse("rounded=1;html=1;");
    cell.geo = Some(Geo {
        x: 10.0,
        y: 20.5,
        w: 100.0,
        h: 50.0,
        ..Geo::default()
    });
    doc.pages[0].add(cell);
    let out = doc.render().unwrap();
    let added = "        <mxCell id=\"n1\" value=\"New &lt;one&gt;\" style=\"rounded=1;html=1;\" vertex=\"1\" parent=\"1\">\n          <mxGeometry x=\"10\" y=\"20.5\" width=\"100\" height=\"50\" as=\"geometry\" />\n        </mxCell>\n";
    assert_eq!(
        out,
        EDITOR.replace("      </root>", &format!("{added}      </root>"))
    );
}

#[test]
fn a_cell_taken_out_takes_its_lines_and_a_waypoint_change_rewrites_its_geometry() {
    let mut doc = Doc::parse(EDITOR).unwrap();
    doc.pages[0].get_mut("db").unwrap().gone = true;
    let out = doc.render().unwrap();
    assert!(!out.contains("id=\"db\"") && out.contains("id=\"e2\""));
    assert_eq!(out.lines().count(), EDITOR.lines().count() - 3);
    check_ok(&out);

    let mut doc = Doc::parse(EDITOR).unwrap();
    doc.pages[0]
        .get_mut("e2")
        .unwrap()
        .geo
        .as_mut()
        .unwrap()
        .points = vec![(420.0, 90.0), (420.0, 130.0)];
    let out = doc.render().unwrap();
    assert!(
        out.contains("<mxPoint x=\"420\" y=\"90\" />")
            && out.contains("<mxPoint x=\"420\" y=\"130\" />")
    );
    assert!(!out.contains("x=\"400\" y=\"110\""));
    check_ok(&out);
}

#[test]
fn a_cell_with_no_geometry_gets_one_even_when_its_tag_closes_itself() {
    let text = "<mxGraphModel>\n  <root>\n    <mxCell id=\"0\" />\n    <mxCell id=\"1\" parent=\"0\" />\n    <mxCell id=\"a\" value=\"A\" vertex=\"1\" parent=\"1\" />\n  </root>\n</mxGraphModel>\n";
    let mut doc = Doc::parse(text).unwrap();
    doc.pages[0].get_mut("a").unwrap().geo = Some(Geo {
        x: 5.0,
        y: 6.0,
        w: 70.0,
        h: 30.0,
        ..Geo::default()
    });
    let out = doc.render().unwrap();
    assert!(out.contains("<mxCell id=\"a\" value=\"A\" vertex=\"1\" parent=\"1\">\n      <mxGeometry x=\"5\" y=\"6\" width=\"70\" height=\"30\" as=\"geometry\" />\n    </mxCell>"), "{out}");
    check_ok(&out);
}

#[test]
fn a_wrapped_cells_label_and_fields_are_changed_on_the_wrapper() {
    let mut doc = Doc::parse(C4).unwrap();
    let shop = doc.pages[0].get_mut("shop").unwrap();
    for (k, v) in &mut shop.attrs {
        if k == "c4Name" {
            *v = "Webshop".into();
        }
    }
    let out = doc.render().unwrap();
    assert_eq!(out, C4.replace("c4Name=\"Shop\"", "c4Name=\"Webshop\""));
}

#[test]
fn a_page_is_renamed_resized_and_added() {
    let mut doc = Doc::parse(EDITOR).unwrap();
    doc.pages[0].name = "Overview".into();
    doc.pages[0].width = Some(1169.0);
    let two = doc.add_page("Details").unwrap();
    let mut cell = Cell::new("x", Kind::Vertex);
    cell.parent = Some("1".into());
    cell.geo = Some(Geo {
        x: 1.0,
        y: 2.0,
        w: 3.0,
        h: 4.0,
        ..Geo::default()
    });
    doc.pages[two].add(cell);
    let out = doc.render().unwrap();
    assert!(out.contains("name=\"Overview\"") && out.contains("pageWidth=\"1169\""));
    let back = Doc::parse(&out).unwrap();
    assert_eq!(back.pages.len(), 2);
    assert_eq!(back.pages[1].name, "Details");
    assert!(back.pages[1].get("x").is_some());
    assert_eq!(back.find_page(Some("Details")).unwrap(), 1);
    assert_eq!(back.find_page(Some("2")).unwrap(), 1);
    assert!(back.find_page(Some("Nope")).is_err());
    check_ok(&out);
    assert!(Doc::parse(BARE).unwrap().add_page("More").is_err());
}

#[test]
fn cell_blocks_name_each_cell_element_once() {
    let blocks = cell_blocks(C4).unwrap();
    let ids: Vec<&str> = blocks.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, ["0", "1", "cust", "shop", "docs", "rel1"]);
    assert!(blocks[2].1.starts_with("<object ") && blocks[2].1.ends_with("</object>"));
}

fn check_ok(xml: &str) {
    crate::diagrams::check_xml(xml).unwrap();
}
