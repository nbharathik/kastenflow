use super::SAMPLE;
use crate::citations::{Cites, Numbering, Piece, Refs, lines, pieces, short_venue};
use crate::model::CitationStyle::{Full, List, Numbered, Short};

fn keys(list: &[&str]) -> Vec<String> {
    list.iter().map(|k| (*k).to_owned()).collect()
}

fn short(bib: &str) -> String {
    Refs::from_bibtex(bib).references()[0].short.clone()
}

fn full(bib: &str) -> String {
    Refs::from_bibtex(bib).references()[0].full.clone()
}

#[test]
fn a_short_label_is_authors_year_and_venue() {
    let refs = Refs::from_bibtex(SAMPLE);
    let shown: Vec<String> = refs.references().into_iter().map(|r| r.short).collect();
    assert_eq!(
        shown,
        [
            "Vaswani et al., 2017 (NeurIPS)",
            "Devlin et al., 2019 (NAACL-HLT)",
            "Brown et al., 2020 (arXiv)",
            "Goodfellow et al., 2016",
            "LeCun et al., 2015 (Nature)",
            "Anthropic, 2024",
        ]
    );
}

#[test]
fn a_full_label_is_the_whole_reference_on_one_line() {
    let refs = Refs::from_bibtex(SAMPLE);
    let shown: Vec<String> = refs.references().into_iter().map(|r| r.full).collect();
    assert_eq!(
        shown,
        [
            "A. Vaswani et al. Attention is all you need. In Advances in Neural Information Processing Systems, 2017.",
            "J. Devlin et al. BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. In Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies (NAACL-HLT), 2019.",
            "T. B. Brown et al. Language Models are Few-Shot Learners. arXiv preprint arXiv:2005.14165, 2020.",
            "I. Goodfellow, Y. Bengio, and A. Courville. Deep Learning. MIT Press, 2016.",
            "Y. LeCun, Y. Bengio, and G. Hinton. Deep learning. Nature, 2015.",
            "Anthropic. The Claude 3 Model Family. Technical report, 2024.",
        ]
    );
}

#[test]
fn what_a_work_lacks_is_left_out_without_stray_punctuation() {
    assert_eq!(short("@misc{k, title={Only a title}}"), "Only a title");
    assert_eq!(short("@misc{k, author={Doe, Jane}}"), "Doe");
    assert_eq!(
        short("@misc{k, author={Doe, Jane}, year={2020}}"),
        "Doe, 2020"
    );
    assert_eq!(short("@misc{k, title={T}, year={2020}}"), "T, 2020");
    assert_eq!(short("@misc{k}"), "k");
    assert_eq!(full("@misc{k}"), "k");
    assert_eq!(full("@misc{k, title={Only a title}}"), "Only a title.");
    assert_eq!(full("@misc{k, title={Why?}, year={2020}}"), "Why? 2020.");
    assert_eq!(
        full("@misc{k, author={Doe, Jane}, year={2020}}"),
        "J. Doe. 2020."
    );
    assert_eq!(
        full("@article{k, author={Doe, Jane}, title={T}, journal={J}}"),
        "J. Doe. T. J."
    );
}

#[test]
fn a_long_title_stands_for_a_work_without_authors_but_is_cut() {
    let long = "A very long title that goes on and on and on for far too many words to be a label";
    let label = short(&format!("@misc{{k, title={{{long}}}, year={{2020}}}}"));
    assert!(label.chars().count() <= 48, "{label}");
    assert!(label.starts_with("A very long title"), "{label}");
    assert!(label.ends_with("…, 2020"), "{label}");
}

#[test]
fn each_kind_of_work_names_where_it_appeared() {
    assert_eq!(
        full("@phdthesis{k, author={Doe, Jane}, title={T}, school={MIT}, year={2001}}"),
        "J. Doe. T. PhD thesis, MIT, 2001."
    );
    assert_eq!(
        full("@mastersthesis{k, author={Doe, Jane}, title={T}, school={MIT}, year={2001}}"),
        "J. Doe. T. Master's thesis, MIT, 2001."
    );
    assert_eq!(
        full(
            "@techreport{k, author={Doe, Jane}, title={T}, institution={Lab}, number={7}, year={2001}}"
        ),
        "J. Doe. T. Technical report 7, Lab, 2001."
    );
    assert_eq!(
        full(
            "@article{k, author={Doe, Jane}, title={T}, journal={Journal of Things}, year={2001}}"
        ),
        "J. Doe. T. Journal of Things, 2001."
    );
    assert_eq!(
        full("@incollection{k, author={Doe, Jane}, title={T}, booktitle={Big Book}, year={2001}}"),
        "J. Doe. T. In Big Book, 2001."
    );
}

#[test]
fn a_venue_is_shortened_by_its_acronym_a_known_name_or_left_out() {
    let of = |v: &str| short_venue(v);
    assert_eq!(
        of("Advances in Neural Information Processing Systems"),
        Some("NeurIPS".to_owned())
    );
    assert_eq!(
        of("Advances in neural information processing systems 32"),
        Some("NeurIPS".to_owned())
    );
    assert_eq!(
        of("Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition"),
        Some("CVPR".to_owned())
    );
    assert_eq!(
        of("European Conference on Computer Vision"),
        Some("ECCV".to_owned())
    );
    assert_eq!(
        of("International Conference on Computer Vision"),
        Some("ICCV".to_owned())
    );
    assert_eq!(
        of("International Conference on Machine Learning"),
        Some("ICML".to_owned())
    );
    assert_eq!(
        of("International Conference on Learning Representations"),
        Some("ICLR".to_owned())
    );
    assert_eq!(
        of(
            "Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics"
        ),
        Some("ACL".to_owned())
    );
    assert_eq!(
        of("Empirical Methods in Natural Language Processing"),
        Some("EMNLP".to_owned())
    );
    assert_eq!(
        of("Journal of Machine Learning Research"),
        Some("JMLR".to_owned())
    );
    assert_eq!(
        of("Proceedings of the Thirty-Fourth AAAI Conference on Artificial Intelligence"),
        Some("AAAI".to_owned())
    );
    assert_eq!(of("Some Workshop (WSDM 2020)"), Some("WSDM".to_owned()));
    assert_eq!(
        of("Proceedings of the Conference (ICML)"),
        Some("ICML".to_owned())
    );
    assert_eq!(
        of("arXiv preprint arXiv:2005.14165"),
        Some("arXiv".to_owned())
    );
    assert_eq!(of("Nature"), Some("Nature".to_owned()));
    assert_eq!(
        of("Proceedings of an Extremely Specific Regional Symposium on Things"),
        None
    );
    assert_eq!(of(""), None);
}

#[test]
fn a_journal_with_a_short_form_uses_it() {
    assert_eq!(
        short(
            "@article{k, author={Doe, J}, year={2000}, journal={Proceedings of the National Academy of Sciences of the United States of America}, shortjournal={PNAS}}"
        ),
        "Doe, 2000 (PNAS)"
    );
}

fn refs() -> Refs {
    Refs::from_bibtex(SAMPLE)
}

#[test]
fn short_joins_the_labels_and_marks_a_key_it_does_not_know() {
    let refs = refs();
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    assert_eq!(
        lines(
            &keys(&["vaswani2017attention", "devlin2019bert"]),
            &Short,
            &cites
        ),
        ["Vaswani et al., 2017 (NeurIPS); Devlin et al., 2019 (NAACL-HLT)"]
    );
    assert_eq!(
        lines(
            &keys(&["vaswani2017attention", "nobody2000"]),
            &Short,
            &cites
        ),
        ["Vaswani et al., 2017 (NeurIPS); nobody2000?"]
    );
    assert_eq!(lines(&[], &Short, &cites), [""]);
}

#[test]
fn full_is_a_line_for_each_key() {
    let refs = refs();
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let out = lines(&keys(&["lecun2015deep", "nobody2000"]), &Full, &cites);
    assert_eq!(
        out,
        [
            "Y. LeCun, Y. Bengio, and G. Hinton. Deep learning. Nature, 2015.",
            "nobody2000?"
        ]
    );
}

#[test]
fn numbered_uses_the_numbers_of_the_deck_and_shows_an_unknown_key_as_itself() {
    let refs = refs();
    let numbering = Numbering::new(["devlin2019bert", "vaswani2017attention", "lecun2015deep"]);
    let cites = Cites {
        refs: Some(&refs),
        numbering: Some(&numbering),
    };
    assert_eq!(
        lines(
            &keys(&["vaswani2017attention", "devlin2019bert"]),
            &Numbered,
            &cites
        ),
        ["[2][1]"]
    );
    assert_eq!(
        lines(&keys(&["nobody2000", "lecun2015deep"]), &Numbered, &cites),
        ["[nobody2000?][3]"]
    );
}

#[test]
fn a_list_prints_every_work_of_the_deck_in_the_order_of_its_numbers() {
    let refs = refs();
    let numbering = Numbering::new(["lecun2015deep", "nobody2000", "goodfellow2016deep"]);
    let cites = Cites {
        refs: Some(&refs),
        numbering: Some(&numbering),
    };
    let out = lines(&[], &List, &cites);
    assert_eq!(
        out,
        [
            "[1] Y. LeCun, Y. Bengio, and G. Hinton. Deep learning. Nature, 2015.",
            "[2] nobody2000?",
            "[3] I. Goodfellow, Y. Bengio, and A. Courville. Deep Learning. MIT Press, 2016.",
        ]
    );
    let same = lines(&keys(&["goodfellow2016deep"]), &List, &cites);
    assert_eq!(
        same, out,
        "the keys of a list are already in the deck's numbering"
    );
}

#[test]
fn a_list_with_nothing_to_list_is_one_empty_line() {
    let numbering = Numbering::default();
    let cites = Cites {
        refs: None,
        numbering: Some(&numbering),
    };
    assert_eq!(lines(&[], &List, &cites), [""]);
}

#[test]
fn without_a_bibliography_the_keys_are_written_as_they_are() {
    let none = Cites::default();
    let ks = keys(&["a", "b", "c"]);
    assert_eq!(lines(&ks, &Short, &none), ["(a; b; c)"]);
    assert_eq!(lines(&ks, &Numbered, &none), ["[1][2][3]"]);
    assert_eq!(lines(&ks, &Full, &none), ["a", "b", "c"]);
    assert_eq!(lines(&ks, &List, &none), ["[1] a", "[2] b", "[3] c"]);
    assert_eq!(lines(&[], &Short, &none), [""]);
}

#[test]
fn without_a_bibliography_the_deck_still_numbers_the_works() {
    let numbering = Numbering::new(["x", "a", "b"]);
    let cites = Cites {
        refs: None,
        numbering: Some(&numbering),
    };
    let ks = keys(&["a", "b"]);
    assert_eq!(lines(&ks, &Numbered, &cites), ["[2][3]"]);
    assert_eq!(lines(&ks, &List, &cites), ["[1] x", "[2] a", "[3] b"]);
    assert_eq!(lines(&ks, &Short, &cites), ["(a; b)"]);
}

#[test]
fn a_key_that_only_the_keys_know_is_written_as_itself_and_counts_as_known() {
    let refs = Refs::new(["a", "b"]);
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    assert_eq!(lines(&keys(&["a", "z"]), &Short, &cites), ["a; z?"]);
    assert_eq!(lines(&keys(&["a", "z"]), &Numbered, &cites), ["[1][z?]"]);
}

fn piece(text: &str, key: Option<&str>) -> Piece {
    Piece {
        text: text.to_owned(),
        key: key.map(str::to_owned),
    }
}

#[test]
fn the_pieces_of_a_line_name_the_works_and_leave_the_words_between_them_unnamed() {
    let refs = refs();
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let two = keys(&["vaswani2017attention", "devlin2019bert"]);
    assert_eq!(
        pieces(&two, &Short, &cites),
        [vec![
            piece(
                "Vaswani et al., 2017 (NeurIPS)",
                Some("vaswani2017attention")
            ),
            piece("; ", None),
            piece("Devlin et al., 2019 (NAACL-HLT)", Some("devlin2019bert")),
        ]]
    );
    // Without a bibliography the brackets are words between works too.
    assert_eq!(
        pieces(&keys(&["a", "b"]), &Short, &Cites::default()),
        [vec![
            piece("(", None),
            piece("a", Some("a")),
            piece("; ", None),
            piece("b", Some("b")),
            piece(")", None),
        ]]
    );
    assert_eq!(
        pieces(&keys(&["a", "z"]), &Numbered, &Cites::default()),
        [vec![piece("[1]", Some("a")), piece("[2]", Some("z"))]]
    );
    assert_eq!(
        pieces(&keys(&["a", "b"]), &Full, &Cites::default()),
        [vec![piece("a", Some("a"))], vec![piece("b", Some("b"))]]
    );
    assert_eq!(
        pieces(&keys(&["a"]), &List, &Cites::default()),
        [vec![piece("[1] ", None), piece("a", Some("a"))]]
    );
    // Nothing to cite: one line of nothing, naming nothing.
    assert_eq!(pieces(&[], &Short, &cites), [vec![piece("", None)]]);
}

#[test]
fn put_end_to_end_the_pieces_are_the_lines_in_every_style_with_and_without_a_bibliography() {
    let refs = refs();
    let numbering = Numbering::new(["lecun2015deep", "nobody2000", "devlin2019bert"]);
    let all = keys(&["devlin2019bert", "nobody2000", "lecun2015deep"]);
    let none: &[String] = &[];
    for cites in [
        Cites::default(),
        Cites {
            refs: Some(&refs),
            numbering: None,
        },
        Cites {
            refs: Some(&refs),
            numbering: Some(&numbering),
        },
        Cites {
            refs: None,
            numbering: Some(&numbering),
        },
    ] {
        for style in [Short, Numbered, Full, List] {
            for ks in [&all[..], &all[..1], none] {
                let joined: Vec<String> = pieces(ks, &style, &cites)
                    .into_iter()
                    .map(|line| line.into_iter().map(|p| p.text).collect())
                    .collect();
                assert_eq!(joined, lines(ks, &style, &cites));
            }
        }
    }
}
