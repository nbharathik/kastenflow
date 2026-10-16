//! The scanner's spans, put together, are the input again, byte for byte: for
//! the files of the dev vault and for texts shaped like the ones people write.

use slides_bib::{Kind, read, scan};

const FILES: [(&str, &str); 2] = [
    (
        "references.bib",
        include_str!("../../../fixtures/dev-vault/references.bib"),
    ),
    (
        "paper-with-figures.bib",
        include_str!("../../../fixtures/dev-vault/sources/paper-with-figures.bib"),
    ),
];

fn together(text: &str) -> String {
    scan(text).iter().map(|s| &text[s.whole.clone()]).collect()
}

#[test]
fn the_dev_vault_files_come_back_byte_for_byte() {
    for (name, text) in FILES {
        assert_eq!(together(text), text, "{name}");
        let spans = scan(text);
        assert!(
            spans.iter().all(|s| s.kind != Kind::Entry || s.closed),
            "{name}"
        );
    }
}

#[test]
fn the_dev_vault_entries_are_all_found() {
    let keys: Vec<String> = FILES
        .iter()
        .flat_map(|(_, text)| read(text))
        .map(|r| r.key)
        .collect();
    assert_eq!(
        keys,
        [
            "vaswani2017attention",
            "devlin2019bert",
            "he2016resnet",
            "brown2020language",
            "lecun2015deep",
            "goodfellow2016deep",
            "sample2026figures"
        ]
    );
}

#[test]
fn files_as_other_tools_write_them_come_back_byte_for_byte() {
    let zotero = "\u{feff}@article{doe_2020,\r\n\ttitle = {{A} \\emph{b}},\r\n\tauthor = {Doe, J{\\\"o}rg and Roe, A.},\r\n\tjournal = {J.},\r\n\tyear = {2020},\r\n\tkeywords = {a, b},\r\n}\r\n\r\n";
    let jabref = "% Encoding: UTF-8\n\n@Article{k1,\n  author = {X},\n  title  = {Y},\n}\n\n@Comment{jabref-meta: databaseType:bibtex;}\n";
    let mendeley = "@inproceedings{a,\ntitle={T},\nauthor={A},\nyear={2020}}\n@misc{b,title={U}}";
    let macros = "@string{jan = \"January\"}\n@STRING( pnas = \"PNAS\" )\n@article{c, journal = pnas, month = jan # \" 1\", year = 2001}\n";
    for text in [zotero, jabref, mendeley, macros] {
        assert_eq!(together(text), text);
    }
}
