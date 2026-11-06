//! The workbook a chart carries, so that "Edit data" in PowerPoint opens the numbers: a single sheet with the categories
//! down the first column and a column for each series. Nothing but what a spreadsheet needs to read it.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

use super::data::{Table, column, esc};

const NS_MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn text_cell(at: &str, text: &str) -> String {
    format!(
        r#"<c r="{at}" t="inlineStr"><is><t>{}</t></is></c>"#,
        esc(text)
    )
}

fn sheet(table: &Table) -> String {
    let mut rows = String::new();
    // The first row names the series.
    rows.push_str(r#"<row r="1">"#);
    for (j, s) in table.series.iter().enumerate() {
        rows.push_str(&text_cell(&format!("{}1", column(j + 1)), &s.name));
    }
    rows.push_str("</row>");
    for (i, category) in table.categories.iter().enumerate() {
        let r = i + 2;
        rows.push_str(&format!(r#"<row r="{r}">"#));
        rows.push_str(&text_cell(&format!("A{r}"), category));
        for (j, s) in table.series.iter().enumerate() {
            rows.push_str(&format!(
                r#"<c r="{}{r}"><v>{}</v></c>"#,
                column(j + 1),
                s.values[i]
            ));
        }
        rows.push_str("</row>");
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="{NS_MAIN}"><sheetData>{rows}</sheetData></worksheet>"#
    )
}

/// The `.xlsx` file for a table. The same table makes the same bytes.
pub fn workbook(table: &Table) -> Vec<u8> {
    let parts: [(&str, String); 5] = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#
                .to_owned(),
        ),
        (
            "_rels/.rels",
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>"#
            ),
        ),
        (
            "xl/workbook.xml",
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#
            ),
        ),
        (
            "xl/_rels/workbook.xml.rels",
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#
            ),
        ),
        ("xl/worksheets/sheet1.xml", sheet(table)),
    ];
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(DateTime::default())
        .unix_permissions(0o644);
    for (name, text) in parts {
        // Writing to memory does not fail; a failure would leave a short file, which a reader refuses.
        if zip.start_file(name, options).is_ok() {
            let _ = zip.write_all(text.as_bytes());
        }
    }
    zip.finish().map(Cursor::into_inner).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use zip::ZipArchive;

    use super::*;
    use crate::chart::data::Series;

    fn table() -> Table {
        Table {
            categories: vec!["Q1".into(), "Q2 & Q3".into()],
            series: vec![Series {
                name: "Sales".into(),
                color: "accent1".into(),
                values: vec![1.5, 2.0],
            }],
        }
    }

    #[test]
    fn the_workbook_holds_the_names_the_categories_and_the_numbers() {
        let bytes = workbook(&table());
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut text = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert!(
            text.contains(r#"<c r="B1" t="inlineStr"><is><t>Sales</t></is></c>"#),
            "{text}"
        );
        assert!(text.contains("<t>Q2 &amp; Q3</t>"), "{text}");
        assert!(text.contains(r#"<c r="B2"><v>1.5</v></c>"#), "{text}");
        assert!(archive.by_name("xl/workbook.xml").is_ok());
    }

    #[test]
    fn the_same_table_makes_the_same_bytes() {
        assert_eq!(workbook(&table()), workbook(&table()));
    }
}
