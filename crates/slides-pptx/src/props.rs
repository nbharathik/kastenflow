//! The small parts every presentation has: document properties, the settings
//! and view state PowerPoint keeps, and the (empty) list of table styles.

use slides_core::Deck;

use crate::layouts::open_root;
use crate::xml::{NS_A, Xml};

const NS_CP: &str = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC: &str = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS: &str = "http://purl.org/dc/terms/";
const NS_DCMITYPE: &str = "http://purl.org/dc/dcmitype/";
const NS_XSI: &str = "http://www.w3.org/2001/XMLSchema-instance";
const NS_APP: &str = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const NS_VT: &str = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";

/// Who made the file.
pub const CREATOR: &str = "KastenFlow Slides";

/// `docProps/core.xml`: the title, and who made it. It carries no date, so the
/// same deck always makes the same file.
pub fn core(deck: &Deck) -> Vec<u8> {
    let mut x = Xml::document();
    x.open("cp:coreProperties")
        .attr("xmlns:cp", NS_CP)
        .attr("xmlns:dc", NS_DC)
        .attr("xmlns:dcterms", NS_DCTERMS)
        .attr("xmlns:dcmitype", NS_DCMITYPE)
        .attr("xmlns:xsi", NS_XSI);
    x.text_element("dc:title", &deck.title);
    x.text_element("dc:creator", CREATOR);
    x.text_element("cp:lastModifiedBy", CREATOR);
    x.close();
    x.finish()
}

/// What `docProps/app.xml` counts.
pub struct Counts {
    pub slides: usize,
    pub notes: usize,
    pub hidden: usize,
}

/// The name PowerPoint gives a slide size.
fn format_of(deck: &Deck) -> &'static str {
    let ratio = deck.size.w / deck.size.h.max(1.0);
    if (ratio - 16.0 / 9.0).abs() < 0.01 {
        "On-screen Show (16:9)"
    } else if (ratio - 4.0 / 3.0).abs() < 0.01 {
        "On-screen Show (4:3)"
    } else {
        "Custom"
    }
}

/// `docProps/app.xml`: the program, and how many slides there are.
pub fn app(deck: &Deck, counts: &Counts) -> Vec<u8> {
    let mut x = Xml::document();
    x.open("Properties")
        .attr("xmlns", NS_APP)
        .attr("xmlns:vt", NS_VT);
    x.text_element("TotalTime", "0");
    x.text_element("Application", CREATOR);
    x.text_element("PresentationFormat", format_of(deck));
    x.text_element("Slides", &counts.slides.to_string());
    x.text_element("Notes", &counts.notes.to_string());
    x.text_element("HiddenSlides", &counts.hidden.to_string());
    x.text_element("ScaleCrop", "false");
    x.text_element("LinksUpToDate", "false");
    x.text_element("SharedDoc", "false");
    x.text_element("HyperlinksChanged", "false");
    x.close();
    x.finish()
}

/// `ppt/presProps.xml`: nothing to remember yet.
pub fn pres_props() -> Vec<u8> {
    let mut x = Xml::document();
    open_root(&mut x, "p:presentationPr");
    x.close();
    x.finish()
}

/// `ppt/viewProps.xml`: open in the normal view at full size.
pub fn view_props() -> Vec<u8> {
    let mut x = Xml::document();
    open_root(&mut x, "p:viewPr");
    x.open("p:normalViewPr");
    x.leaf("p:restoredLeft", &[("sz", "15620")]);
    x.leaf("p:restoredTop", &[("sz", "94660")]);
    x.close();
    x.open("p:slideViewPr");
    x.open("p:cSldViewPr");
    x.open("p:cViewPr").attr("varScale", "1");
    x.open("p:scale");
    x.leaf("a:sx", &[("n", "100"), ("d", "100")]);
    x.leaf("a:sy", &[("n", "100"), ("d", "100")]);
    x.close();
    x.leaf("p:origin", &[("x", "0"), ("y", "0")]);
    x.close();
    x.open("p:guideLst").close();
    x.close();
    x.close();
    x.leaf("p:gridSpacing", &[("cx", "76200"), ("cy", "76200")]);
    x.close();
    x.finish()
}

/// `ppt/tableStyles.xml`: the default is PowerPoint's own medium style; the tables
/// of a deck do not use it, they carry their own borders and fills.
pub fn table_styles() -> Vec<u8> {
    let mut x = Xml::document();
    x.open("a:tblStyleLst")
        .attr("xmlns:a", NS_A)
        .attr("def", "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}")
        .close();
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::deck;

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap_or_default()
    }

    #[test]
    fn the_core_properties_hold_the_title_and_the_creator_but_no_date() {
        let mut deck = deck();
        deck.title = "Tools & models".into();
        let out = text(core(&deck));
        assert!(
            out.contains(
                "<dc:title>Tools &amp; models</dc:title><dc:creator>KastenFlow Slides</dc:creator>"
            ),
            "{out}"
        );
        assert!(!out.contains("dcterms:created"), "{out}");
    }

    #[test]
    fn the_extended_properties_count_the_slides_and_name_the_size() {
        let deck = deck();
        let out = text(app(
            &deck,
            &Counts {
                slides: 12,
                notes: 3,
                hidden: 2,
            },
        ));
        assert!(out.contains("<Application>KastenFlow Slides</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>12</Slides><Notes>3</Notes><HiddenSlides>2</HiddenSlides>"), "{out}");
        let mut narrow = deck;
        narrow.size = slides_core::Size {
            w: 720.0,
            h: 540.0,
            extra: slides_core::Extra::new(),
        };
        assert!(
            text(app(
                &narrow,
                &Counts {
                    slides: 1,
                    notes: 0,
                    hidden: 0
                }
            ))
            .contains("On-screen Show (4:3)")
        );
        narrow.size = slides_core::Size {
            w: 500.0,
            h: 500.0,
            extra: slides_core::Extra::new(),
        };
        assert!(
            text(app(
                &narrow,
                &Counts {
                    slides: 1,
                    notes: 0,
                    hidden: 0
                }
            ))
            .contains("<PresentationFormat>Custom")
        );
    }

    #[test]
    fn the_settings_parts_are_small_and_well_formed_roots() {
        assert!(text(pres_props()).ends_with("<p:presentationPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>"));
        assert!(text(view_props()).contains("<p:normalViewPr>"));
        assert!(text(table_styles()).contains(r#"def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}""#));
    }
}
