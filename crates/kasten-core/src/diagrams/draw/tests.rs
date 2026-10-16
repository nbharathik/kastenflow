//! The draft picture as a whole: valid, safe, deterministic, faithful to the
//! diagram, and honest about what it did not draw.

use std::fs;
use std::path::Path;

use super::*;
use crate::diagrams::spec::{Input, build};
use crate::diagrams::{check_svg, xml};

fn draw(xml: &str) -> Draft {
    draft(xml, None).unwrap()
}

/// The picture without `content`, which holds the diagram as it was written (escaped, so inert).
fn drawing(svg: &str) -> &str {
    &svg[svg.find("\">\n<rect").unwrap()..]
}

fn template(id: &str) -> String {
    build(Input::Template(id.to_owned()), "Draft").unwrap().xml
}

fn wrap(cells: &str) -> String {
    format!(
        "<mxfile><diagram id=\"p\" name=\"First\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>{cells}</root></mxGraphModel></diagram><diagram id=\"q\" name=\"Second\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"z\" value=\"Only here\" style=\"rounded=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"5\" y=\"5\" width=\"90\" height=\"40\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>"
    )
}

fn vertex(id: &str, label: &str, style: &str, at: (i32, i32, i32, i32)) -> String {
    format!(
        "<mxCell id=\"{id}\" value=\"{label}\" style=\"{style}\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" as=\"geometry\"/></mxCell>",
        at.0, at.1, at.2, at.3
    )
}

#[test]
fn a_picture_is_a_valid_svg_that_runs_nothing_and_keeps_the_diagram_in_it() {
    let source = template("three-tier");
    let d = draw(&source);
    check_svg(&d.svg).unwrap();
    assert!(
        d.svg
            .starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\"")
            && d.svg.ends_with(DRAFT_MARK),
        "{}",
        &d.svg[..200]
    );
    for forbidden in [
        "foreignObject",
        "<script",
        "onload",
        "javascript:",
        "<style",
        "href=\"http",
    ] {
        assert!(!d.svg.contains(forbidden), "{forbidden}");
    }
    assert!(d.svg.contains("background: #ffffff") && d.svg.contains("viewBox=\""));
    assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    // The diagram is in `content`, so the file is still a draw.io picture.
    let at = d.svg.find(" content=\"").unwrap() + 10;
    let end = at + d.svg[at..].find('"').unwrap();
    assert_eq!(xml::unescape(&d.svg[at..end]).unwrap(), source);
    // And with the stamp the files carry, it is still a picture.
    let stamped = crate::diagrams::stamped(&d.svg, "abc123");
    check_svg(&stamped).unwrap();
    assert!(
        stamped.ends_with("<!-- kasten-draft -->\n<!-- kasten-source: abc123 -->\n"),
        "{stamped}"
    );
}

#[test]
fn every_box_word_and_arrow_of_the_diagram_is_there() {
    let d = draw(&template("three-tier"));
    for word in [
        "Users",
        "Web app",
        "API",
        "Background jobs",
        "Database",
        "Cache",
        "Presentation",
        "Application",
        "Data",
        "HTTPS",
        "SQL",
        "jobs",
    ] {
        assert!(d.svg.contains(&format!(">{word}</text>")), "{word}");
    }
    // Six arrows: a head at the end of each.
    assert!(d.svg.matches("<polygon").count() >= 6);
    let again = draw(&template("three-tier"));
    assert_eq!(d, again, "drawing twice gives the same picture");
}

#[test]
fn words_and_styles_cannot_break_out_of_the_picture() {
    let hostile =
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; ]]&gt; &lt;!-- x --&gt;";
    let styles = "fillColor=#fff&quot; onload=&quot;x;fontColor=url(javascript:1);shape=mxgraph.evil.&quot;&gt;&lt;script&gt;;fontSize=1e99";
    let d = draw(&wrap(&vertex("a", hostile, styles, (0, 0, 120, 60))));
    check_svg(&d.svg).unwrap();
    let drawn = drawing(&d.svg);
    assert!(
        !drawn.contains("<script")
            && !drawn.contains("onload=")
            && !drawn.contains("javascript:")
            && !drawn.contains("url("),
        "{drawn}"
    );
    assert!(
        drawn.contains("&lt;script&gt;alert(1)&lt;/script&gt;"),
        "{drawn}"
    );
    assert!(!d.svg.contains("<script"));
}

#[test]
fn an_icon_of_a_library_is_a_labelled_box_and_the_warning_says_so() {
    let cells = format!(
        "{}{}{}",
        vertex(
            "fn",
            "Handler",
            "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;",
            (0, 0, 78, 78)
        ),
        vertex(
            "pod",
            "Pod",
            "shape=mxgraph.kubernetes.icon2;prIcon=pod;",
            (200, 0, 50, 48)
        ),
        vertex("odd", "Odd", "shape=trapezoid;", (400, 0, 80, 40)),
    );
    let d = draw(&wrap(&cells));
    assert!(
        d.svg.contains(">aws4.lambda</text>")
            && d.svg.contains(">Handler</text>")
            && d.svg.contains("fill=\"#ed7100\""),
        "{}",
        d.svg
    );
    assert_eq!(d.warnings.len(), 2, "{:?}", d.warnings);
    assert!(
        d.warnings[0].contains("2 icons")
            && d.warnings[0].contains("aws4.lambda")
            && d.warnings[0].contains("pod"),
        "{:?}",
        d.warnings
    );
    assert!(d.warnings[1].contains("trapezoid"));
    let rotated = draw(&wrap(&vertex("r", "R", "rotation=45;", (0, 0, 80, 40))));
    assert!(rotated.warnings.iter().any(|w| w.contains("Rotated")));
}

#[test]
fn a_page_is_chosen_by_name_and_a_page_without_boxes_or_a_compressed_one_is_refused() {
    let xml = wrap(&vertex("a", "On the first", "", (0, 0, 100, 40)));
    assert!(draw(&xml).svg.contains(">On the first</text>"));
    let second = draft(&xml, Some("Second")).unwrap();
    assert!(
        drawing(&second.svg).contains(">Only here</text>")
            && !drawing(&second.svg).contains("On the first")
    );
    assert!(
        draft(&xml, Some("Nope"))
            .unwrap_err()
            .contains("No page called")
    );
    assert!(
        draft(&crate::diagrams::blank_xml(), None)
            .unwrap_err()
            .contains("nothing to draw")
    );
    let packed = "<mxfile><diagram id=\"x\" name=\"y\">7VhZb9pAEP41PBpxmEAe</diagram></mxfile>";
    assert!(
        draft(packed, None)
            .unwrap_err()
            .contains("saved compressed")
    );
    assert!(draft("<svg/>", None).is_err());
}

#[test]
fn a_container_is_drawn_before_what_it_holds_and_the_file_order_is_the_paint_order() {
    let nested = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/diagrams/nested-container.drawio"
    ));
    let d = draw(nested);
    let at = |needle: &str| d.svg.find(needle).unwrap_or_else(|| panic!("{needle}"));
    // The container's strip, then its title, then the boxes inside, then the arrows.
    assert!(at(">VPC</text>") < at(">App</text>") && at(">App</text>") < at(">Cache</text>"));
    assert!(at(">uses</text>") > at(">Cache</text>"));
    assert!(
        d.svg
            .contains("<rect x=\"100\" y=\"100\" width=\"400\" height=\"30\""),
        "{}",
        d.svg
    );
    let a = draw(&wrap(&format!(
        "{}{}",
        vertex("under", "Under", "", (0, 0, 100, 100)),
        vertex("over", "Over", "", (50, 50, 100, 100))
    )));
    assert!(a.svg.find(">Under<").unwrap() < a.svg.find(">Over<").unwrap());
}

#[test]
fn the_shapes_of_the_editor_each_come_out_as_their_own_element() {
    let cells = [
        ("e", "ellipse;"),
        ("r", "rhombus;"),
        ("c", "shape=cylinder3;"),
        ("h", "shape=hexagon;"),
        ("p", "shape=parallelogram;"),
        ("a", "shape=umlActor;"),
        ("d", "shape=document;"),
        ("s", "shape=step;"),
        ("l", "shape=umlLifeline;"),
        ("w", "swimlane;startSize=30;"),
        ("t", "text;html=1;"),
        ("o", "ellipse;shape=cloud;"),
    ]
    .iter()
    .enumerate()
    .map(|(i, (id, style))| vertex(id, id, style, (i as i32 * 150, 0, 120, 100)))
    .collect::<String>();
    let d = draw(&wrap(&cells));
    check_svg(&d.svg).unwrap();
    for element in [
        "<ellipse",
        "<polygon",
        "<circle",
        "<path d=\"M ",
        " Q ",
        "stroke-dasharray",
    ] {
        assert!(d.svg.contains(element), "{element}");
    }
    assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    // A text with no fill or stroke is words only.
    assert!(!d.svg.contains("<rect x=\"1500\""));
}

#[test]
fn a_picture_held_in_the_diagram_is_embedded_and_a_picture_from_outside_never_is() {
    let held = draw(&wrap(&vertex(
        "img",
        "Logo",
        "shape=image;image=data:image/png,iVBORw0KGgo=;",
        (0, 0, 60, 60),
    )));
    assert!(
        held.svg
            .contains("href=\"data:image/png;base64,iVBORw0KGgo=\""),
        "{}",
        held.svg
    );
    check_svg(&held.svg).unwrap();
    let outside = draw(&wrap(&vertex(
        "img",
        "Logo",
        "shape=image;image=https://tracker.example/a.png;",
        (0, 0, 60, 60),
    )));
    assert!(
        !drawing(&outside.svg).contains("tracker.example")
            && !drawing(&outside.svg).contains("<image"),
        "{}",
        outside.svg
    );
    assert!(
        outside.warnings.iter().any(|w| w.contains("icon")),
        "{:?}",
        outside.warnings
    );
}

#[test]
fn a_swimlane_with_its_title_down_the_side_turns_the_words() {
    let d = draw(&wrap(&vertex(
        "lane",
        "Customer",
        "swimlane;horizontal=0;startSize=30;",
        (0, 0, 400, 100),
    )));
    assert!(
        d.svg.contains("rotate(-90 15 50)") && d.svg.contains(">Customer</text>"),
        "{}",
        d.svg
    );
}

#[test]
fn a_huge_diagram_is_cut_short_and_says_so_and_the_picture_stays_inside_its_limits() {
    let cells: String = (0..2100)
        .map(|i| {
            vertex(
                &format!("n{i}"),
                "x",
                "",
                ((i % 50) * 30, (i / 50) * 20, 20, 10),
            )
        })
        .collect();
    let d = draw(&wrap(&cells));
    check_svg(&d.svg).unwrap();
    assert!(
        d.warnings.iter().any(|w| w.contains("first 2000")),
        "{:?}",
        d.warnings
    );
    let far = draw(&wrap(&vertex("a", "A", "", (-90_000, -90_000, 10, 10))));
    assert!(
        far.svg.contains("width=\"30px\"") && far.svg.contains("height=\"30px\""),
        "{}",
        &far.svg[..300]
    );
}

/// The picture of a small diagram, kept beside the tests so a change to the
/// drawing is seen as a change to a file. `KASTEN_BLESS=1` rewrites it; so does a missing file.
#[test]
fn the_picture_of_the_flow_template_is_the_one_kept() {
    let svg = draw(&template("event-driven")).svg;
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/diagrams/event-driven.draft.svg");
    if std::env::var_os("KASTEN_BLESS").is_some() || !file.exists() {
        fs::write(&file, &svg).unwrap();
    }
    let kept = fs::read_to_string(&file).unwrap();
    assert_eq!(
        svg,
        kept.replace("\r\n", "\n"),
        "the drawing changed: run once with KASTEN_BLESS=1 to keep the new picture"
    );
}
