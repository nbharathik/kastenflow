//! Agents citing a Reference in a LaTeX file: `\cite{key}` byte-exact at the end
//! of a paragraph or of the text, the document's own `references.bib` made and
//! given the entry once, the Reference itself never touched, keys and titles
//! that could break out refused or escaped, the three modes and one undo.

use crate::latex_more_common::*;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::content_hash;

const KEY: &str = "vaswani2017attention";
const SENTENCE: &str = "We sample the signal at a fixed rate and subtract the mean.";
const BIB: &str = "projects/photo-organiser/latex/article/references.bib";

fn cite_in(doc: &str, file: &str, key: &str, at: Option<&str>) -> AgentOp {
    AgentOp::CiteReference {
        doc: doc.into(),
        file: file.into(),
        key: key.into(),
        at: at.map(str::to_owned),
        reason: None,
    }
}

fn cite(key: &str, at: Option<&str>) -> AgentOp {
    cite_in(ARTICLE, MAIN, key, at)
}

fn entries(t: &crate::common::TempVault, path: &str) -> Vec<slides_bib::Raw> {
    slides_bib::read(&text_of(t, path))
}

#[test]
fn the_citation_goes_at_the_end_of_the_paragraph_and_the_entry_is_added_once() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let told = done(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
    assert_eq!(told["status"], "cited", "{told}");
    assert_eq!(told["key"], KEY);
    assert_eq!(told["cite"], format!(" \\cite{{{KEY}}}"));
    assert_eq!(told["bib"]["added"], true);
    // Only the citation is new, byte for byte.
    assert_eq!(
        text_of(&t, MAIN),
        before.replacen(SENTENCE, &format!("{SENTENCE} \\cite{{{KEY}}}"), 1)
    );
    let bib = entries(&t, BIB);
    assert_eq!(bib.len(), 1);
    assert_eq!(
        (bib[0].key.as_str(), bib[0].kind.as_str()),
        (KEY, "inproceedings")
    );
    assert_eq!(bib[0].fields["title"], "Attention is all you need");
    assert!(bib[0].fields["author"].starts_with("Vaswani, Ashish"));
    // The document does not load a bibliography yet, and is told so.
    assert!(
        told["note"]
            .as_str()
            .unwrap()
            .contains("does not load a bibliography"),
        "{told}"
    );
    // A second citation of the same Reference adds no second entry.
    let bib_text = text_of(&t, BIB);
    let again = done(
        k.agent_run(
            &s,
            &cite(KEY, Some("The method is simple and it works.")),
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(again["bib"]["added"], false, "{again}");
    assert_eq!(text_of(&t, BIB), bib_text);
    assert_eq!(
        text_of(&t, MAIN)
            .matches(&format!("\\cite{{{KEY}}}"))
            .count(),
        2
    );
    // Another Reference is added after it, each once.
    done(
        k.agent_run(&s, &cite("devlin2019bert", Some(SENTENCE)), NOW)
            .unwrap(),
    );
    let keys: Vec<String> = entries(&t, BIB).into_iter().map(|e| e.key).collect();
    assert_eq!(keys, [KEY, "devlin2019bert"]);
}

#[test]
fn without_a_place_the_citation_goes_at_the_end_of_the_text_inside_the_document() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    done(k.agent_run(&s, &cite(KEY, None), NOW).unwrap());
    assert_eq!(
        text_of(&t, MAIN),
        before.replace(
            "The method is simple and it works.\n\n\\end{document}",
            &format!("The method is simple and it works. \\cite{{{KEY}}}\n\n\\end{{document}}")
        )
    );
}

#[test]
fn windows_line_breaks_stay_as_they_were() {
    let (t, k, s) = open();
    let crlf = text_of(&t, MAIN).replace('\n', "\r\n");
    put(&t, MAIN, crlf.as_bytes());
    done(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
    assert_eq!(
        text_of(&t, MAIN),
        crlf.replacen(SENTENCE, &format!("{SENTENCE} \\cite{{{KEY}}}"), 1)
    );
}

#[test]
fn the_reference_itself_is_never_changed() {
    let (t, k, s) = open();
    let reference = content_hash(&text_of(&t, "references.bib"));
    let before = snapshot(t.vault.root());
    done(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
    assert_eq!(content_hash(&text_of(&t, "references.bib")), reference);
    assert!(!exists(&t, "sources/references.bib"));
    // Two files differ from before: the text and the document's own bibliography.
    let after = snapshot(t.vault.root());
    let changed: Vec<&String> = after
        .keys()
        .filter(|path| before.get(*path) != after.get(*path))
        .collect();
    assert_eq!(changed, [MAIN, BIB]);
}

#[test]
fn an_unknown_key_a_plain_one_in_the_wrong_place_and_a_hostile_one_are_refused() {
    let (t, k, s) = open();
    // A Reference whose key could end a citation early.
    put(
        &t,
        "odd.bib",
        b"@misc{odd#key,\n  title = {Odd},\n  year = {2020}\n}\n",
    );
    let before = snapshot(t.vault.root());
    for key in [
        "nobody1999",
        "",
        "a}b",
        "x}\\input{/etc/passwd}",
        "a,b",
        "odd#key",
    ] {
        assert!(
            k.agent_run(&s, &cite(key, Some(SENTENCE)), NOW).is_err(),
            "{key:?}"
        );
    }
    let said = why(k.agent_run(&s, &cite("nobody1999", None), NOW));
    assert!(said.contains("no reference with the key"), "{said}");
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_title_that_could_break_out_of_its_entry_is_made_safe() {
    let (t, k, s) = open();
    put(
        &t,
        "hostile.bib",
        concat!(
            "@article{odd2020,\n  title = \"Odd } brace\",\n  author = {Eve},\n  year = {2020}\n}\n\n",
            "@article{odd2021,\n  title = {See @article{pwn, title={x}} here},\n  year = {2021}\n}\n"
        )
        .as_bytes(),
    );
    for key in ["odd2020", "odd2021"] {
        done(k.agent_run(&s, &cite(key, Some(SENTENCE)), NOW).unwrap());
    }
    let bib = entries(&t, BIB);
    let keys: Vec<&str> = bib.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, ["odd2020", "odd2021"], "{}", text_of(&t, BIB));
    assert_eq!(bib[0].fields["title"], "Odd \\textbraceright{} brace");
    assert_eq!(bib[1].fields["title"], "See @article{pwn, title={x}} here");
    assert!(!text_of(&t, BIB).contains("\n@article{pwn"));
}

#[test]
fn a_key_the_document_already_has_is_cited_without_a_second_entry() {
    let (t, k, s) = open();
    put(
        &t,
        &format!("{ARTICLE}/refs.bib"),
        b"@article{local2020,\n  title = {Local},\n}\n",
    );
    let told = done(
        k.agent_run(&s, &cite("LOCAL2020", Some(SENTENCE)), NOW)
            .unwrap(),
    );
    // The key is written as the document spells it.
    assert_eq!(told["key"], "local2020", "{told}");
    assert_eq!(told["bib"]["added"], false);
    assert!(text_of(&t, MAIN).contains("\\cite{local2020}"));
    assert!(!exists(&t, BIB));
}

#[test]
fn a_document_set_to_the_vaults_bibliography_gets_no_copy() {
    let (t, k, s) = open();
    put(
        &t,
        &format!("{ARTICLE}/kasten-latex.yaml"),
        b"main: main.tex\nbibliography: vault\n",
    );
    put(
        &t,
        "sources/references.bib",
        b"@book{managed2020,\n  title = {Managed},\n}\n",
    );
    let told = done(
        k.agent_run(&s, &cite("managed2020", Some(SENTENCE)), NOW)
            .unwrap(),
    );
    assert_eq!(told["bib"]["added"], false, "{told}");
    assert!(text_of(&t, MAIN).contains("\\cite{managed2020}"));
    assert!(!exists(&t, BIB));
}

#[test]
fn a_locked_document_a_file_that_is_not_text_of_the_document_and_a_double_place_are_refused() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = open();
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        let locked = cite_in(LOCKED, &format!("{LOCKED}/main.tex"), KEY, None);
        assert!(
            why(k.agent_run(&s, &locked, NOW)).contains("locked"),
            "{mode:?}"
        );
        for (doc, file) in [
            (ARTICLE, format!("{ARTICLE}/kasten-latex.yaml")),
            (ARTICLE, format!("{LOCKED}/main.tex")),
            (ARTICLE, "library/welcome-to-kasten.md".to_owned()),
            ("library", MAIN.to_owned()),
        ] {
            assert!(
                k.agent_run(&s, &cite_in(doc, &file, KEY, None), NOW)
                    .is_err(),
                "{file}"
            );
        }
        let twice = why(k.agent_run(&s, &cite(KEY, Some("\\section")), NOW));
        assert!(
            twice.contains("times") && twice.contains("matches once"),
            "{twice}"
        );
        let none = why(k.agent_run(&s, &cite(KEY, Some("nothing like this")), NOW));
        assert!(none.contains("is not in main.tex"), "{none}");
        assert_eq!(snapshot(t.vault.root()), before, "{mode:?}");
        assert!(k.proposals().unwrap().is_empty());
    }
}

#[test]
fn review_holds_the_citation_and_the_other_modes_write_it() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let before = snapshot(t.vault.root());
    let id = pending(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
    assert_eq!(snapshot(t.vault.root()), before);
    let proposal = k.proposals().unwrap().remove(0);
    assert!(
        proposal.diff.contains("\\cite{vaswani2017attention}"),
        "{}",
        proposal.diff
    );
    assert!(
        proposal.diff.contains("references.bib"),
        "{}",
        proposal.diff
    );
    k.accept_proposal(&id, "tester", NOW).unwrap();
    assert!(text_of(&t, MAIN).contains(&format!("\\cite{{{KEY}}}")));
    assert_eq!(entries(&t, BIB).len(), 1);
    for mode in [AgentMode::Balanced, AgentMode::Autonomous] {
        let (t, k, s) = open();
        set_mode(&k, mode);
        let told = done(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
        assert_eq!(told["status"], "cited", "{mode:?}");
        assert!(exists(&t, BIB));
    }
}

#[test]
fn a_session_of_citations_is_taken_back_by_one_undo() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    done(k.agent_run(&s, &cite(KEY, Some(SENTENCE)), NOW).unwrap());
    done(k.agent_run(&s, &cite("devlin2019bert", None), NOW).unwrap());
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(snapshot(t.vault.root()), before);
}
