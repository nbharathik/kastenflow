use super::*;

fn item(kind: Option<ListKind>, level: u8) -> Paragraph {
    Paragraph {
        list: kind,
        level: Some(level),
        ..Paragraph::plain("x")
    }
}

fn num(level: u8) -> Paragraph {
    item(Some(ListKind::Number), level)
}

fn bul(level: u8) -> Paragraph {
    item(Some(ListKind::Bullet), level)
}

fn plain() -> Paragraph {
    item(None, 0)
}

fn styled(style: ListStyle, level: u8) -> Paragraph {
    Paragraph {
        list: Some(style.kind()),
        list_style: Some(style),
        ..item(None, level)
    }
}

fn starting(mut p: Paragraph, at: u32) -> Paragraph {
    p.start = Some(at);
    p
}

#[test]
fn consecutive_items_count_up_and_deeper_items_do_not_interrupt() {
    let list = [num(0), num(0), bul(1), num(1), num(1), num(0)];
    assert_eq!(
        numbers(&list),
        [Some(1), Some(2), None, Some(1), Some(2), Some(3)]
    );
}

#[test]
fn a_plain_paragraph_a_bullet_or_a_shallower_item_start_the_count_again() {
    assert_eq!(
        numbers(&[num(0), plain(), num(0)]),
        [Some(1), None, Some(1)]
    );
    assert_eq!(numbers(&[num(0), bul(0), num(0)]), [Some(1), None, Some(1)]);
    assert_eq!(
        numbers(&[num(0), num(1), num(1), num(0), num(1)]),
        [Some(1), Some(1), Some(2), Some(2), Some(1)]
    );
    assert_eq!(
        numbers(&[num(0), num(1), plain(), num(1)]),
        [Some(1), Some(1), None, Some(1)]
    );
}

#[test]
fn a_paragraph_with_no_level_is_at_the_first_and_levels_stop_at_the_ninth() {
    let p = Paragraph {
        list: Some(ListKind::Number),
        ..Paragraph::plain("x")
    };
    assert_eq!(numbers(&[p.clone(), p]), [Some(1), Some(2)]);
    assert_eq!(level(&num(200)), MAX_LEVEL);
    assert_eq!(level(&Paragraph::plain("x")), 0);
}

#[test]
fn an_item_that_names_a_start_counts_from_there_and_the_next_ones_go_on() {
    let list = [num(0), num(0), starting(num(0), 1), num(0)];
    assert_eq!(numbers(&list), [Some(1), Some(2), Some(1), Some(2)]);
    let list = [starting(num(0), 5), num(0), num(0)];
    assert_eq!(numbers(&list), [Some(5), Some(6), Some(7)]);
    // After a break the list goes on where the earlier one left off.
    let list = [num(0), num(0), plain(), starting(num(0), 3), num(0)];
    assert_eq!(numbers(&list), [Some(1), Some(2), None, Some(3), Some(4)]);
}

#[test]
fn another_style_at_a_level_begins_a_list_of_its_own() {
    let list = [
        styled(ListStyle::Decimal, 0),
        styled(ListStyle::Decimal, 0),
        styled(ListStyle::UpperAlpha, 0),
        styled(ListStyle::UpperAlpha, 0),
        styled(ListStyle::Decimal, 0),
    ];
    assert_eq!(
        numbers(&list),
        [Some(1), Some(2), Some(1), Some(2), Some(1)]
    );
}

#[test]
fn each_level_has_its_own_style_and_they_go_round_again_after_three() {
    let bullets: Vec<_> = (0..5)
        .map(|l| marker(&default_style(&ListKind::Bullet, l), 1))
        .collect();
    assert_eq!(bullets, ["●", "○", "■", "●", "○"]);
    let numbered: Vec<_> = (0..5)
        .map(|l| marker(&default_style(&ListKind::Number, l), 2))
        .collect();
    assert_eq!(numbered, ["2.", "b.", "ii.", "2.", "b."]);
}

#[test]
fn a_style_of_the_other_kind_of_list_is_not_used() {
    let p = Paragraph {
        list: Some(ListKind::Number),
        list_style: Some(ListStyle::Square),
        ..Paragraph::plain("x")
    };
    assert_eq!(style_of(&p), Some(ListStyle::Decimal));
    let p = Paragraph {
        list: Some(ListKind::Bullet),
        list_style: Some(ListStyle::UpperRoman),
        level: Some(1),
        ..Paragraph::plain("x")
    };
    assert_eq!(style_of(&p), Some(ListStyle::Circle));
    assert_eq!(style_of(&plain()), None);
}

#[test]
fn markers_read_as_each_style_writes_them() {
    assert_eq!(marker(&ListStyle::Decimal, 12), "12.");
    assert_eq!(marker(&ListStyle::DecimalParen, 3), "3)");
    assert_eq!(marker(&ListStyle::LowerAlpha, 1), "a.");
    assert_eq!(marker(&ListStyle::LowerAlpha, 27), "aa.");
    assert_eq!(marker(&ListStyle::UpperAlpha, 3), "C.");
    assert_eq!(marker(&ListStyle::LowerRoman, 14), "xiv.");
    assert_eq!(marker(&ListStyle::UpperRoman, 4), "IV.");
    assert_eq!(marker(&ListStyle::LowerRoman, 4000), "4000.");
    assert_eq!(marker(&ListStyle::Arrow, 9), "➢");
    assert_eq!(marker(&ListStyle::Check, 1), "✓");
    assert_eq!(marker(&ListStyle::Dash, 1), "–");
}

#[test]
fn the_marker_of_each_paragraph_is_a_glyph_or_its_count() {
    let list = [
        bul(0),
        num(0),
        num(0),
        plain(),
        styled(ListStyle::UpperRoman, 0),
    ];
    assert_eq!(
        markers(&list),
        [
            Some("●".to_owned()),
            Some("1.".to_owned()),
            Some("2.".to_owned()),
            None,
            Some("I.".to_owned())
        ]
    );
}

#[test]
fn a_marker_that_fits_the_usual_room_keeps_it_and_one_that_does_not_widens_the_level() {
    let list = |n: usize| (0..n).map(|_| num(0)).collect::<Vec<_>>();
    let at = |paragraphs: &[Paragraph], points: f64| {
        hangs_by_level(paragraphs, &vec![points; paragraphs.len()])[0]
    };
    // A bullet at 14 pt is under 19 units wide with its air: it fits in 24.
    assert_eq!(at(&[bul(0), bul(0)], 14.0), 24.0);
    // At 22 pt it is 28.4 units, which is 30 in steps of 6.
    assert_eq!(at(&[bul(0), bul(0)], 22.0), 30.0);
    // A number at 18 pt: "1." is 0.92 em and air, 1.27 em or 30.5 units: 36.
    assert_eq!(at(&list(2), 18.0), 36.0);
    // At 14 pt "1." needs 23.7 units and fits.
    assert_eq!(at(&list(2), 14.0), 24.0);
}

#[test]
fn every_item_of_a_level_hangs_alike_and_each_level_sits_under_the_words_above() {
    let list: Vec<Paragraph> = (0..10).map(|_| num(0)).chain([plain(), bul(1)]).collect();
    let points = vec![14.0; list.len()];
    let got = layout(&list, &points);
    // "10." at 14 pt is 1.54 em and air, 35 units: the whole first level hangs 36.
    assert!(
        got[..10]
            .iter()
            .all(|g| g.margin == 36.0 && g.indent == -36.0),
        "{got:?}"
    );
    // A plain paragraph has no hang and no level.
    assert_eq!(
        got[10],
        Geometry {
            margin: 0.0,
            indent: 0.0
        }
    );
    // The bullet of the second level hangs under the words of the first.
    assert_eq!(
        got[11],
        Geometry {
            margin: 36.0 + 24.0,
            indent: -24.0
        }
    );
    assert_eq!(got[11].first(), 36.0);
}

#[test]
fn a_paragraph_that_is_not_a_list_item_moves_in_a_step_for_each_level() {
    let p = |level: u8| item(None, level);
    let got = layout(&[p(0), p(1), p(3)], &[20.0; 3]);
    assert_eq!(
        got.iter().map(|g| g.margin).collect::<Vec<_>>(),
        [0.0, 24.0, 72.0]
    );
}

#[test]
fn a_paragraph_that_places_itself_is_not_moved_by_its_list_and_stays_in_the_box() {
    let own = Paragraph {
        margin_left: Some(40.0),
        indent: Some(-10.0),
        ..bul(0)
    };
    let got = layout(&[own, bul(0)], &[40.0, 14.0]);
    assert_eq!(
        got[0],
        Geometry {
            margin: 40.0,
            indent: -10.0
        }
    );
    // The big marker did not widen the list for the one that placed itself.
    assert_eq!(got[1].margin, 24.0);
    let out = Paragraph {
        margin_left: Some(10.0),
        indent: Some(-30.0),
        ..bul(0)
    };
    assert_eq!(
        layout(&[out], &[14.0])[0],
        Geometry {
            margin: 10.0,
            indent: -10.0
        }
    );
    let odd = Paragraph {
        margin_left: Some(f64::NAN),
        indent: Some(-5.0),
        ..bul(0)
    };
    assert_eq!(
        layout(&[odd], &[14.0])[0],
        Geometry {
            margin: 0.0,
            indent: 0.0
        }
    );
}

#[test]
fn a_list_hangs_for_its_widest_marker_and_not_for_its_last() {
    let list =
        |n: usize, style: ListStyle| (0..n).map(|_| styled(style.clone(), 0)).collect::<Vec<_>>();
    let hang = |n: usize, style: ListStyle| {
        let paragraphs = list(n, style);
        hangs_by_level(&paragraphs, &vec![14.0; n])[0]
    };
    // Roman numerals: "viii." is wider than "ix.", so a list of nine hangs as far as one of eight.
    assert_eq!(
        hang(9, ListStyle::LowerRoman),
        hang(8, ListStyle::LowerRoman)
    );
    assert!(hang(8, ListStyle::LowerRoman) > hang(3, ListStyle::LowerRoman));
    // Letters: "m." is wider than "n.".
    assert_eq!(
        hang(14, ListStyle::LowerAlpha),
        hang(13, ListStyle::LowerAlpha)
    );
    assert!(hang(13, ListStyle::LowerAlpha) > hang(3, ListStyle::LowerAlpha));
}

#[test]
fn a_marker_as_big_as_a_headline_stops_growing() {
    assert_eq!(hangs_by_level(&[num(0)], &[400.0])[0], 240.0);
}

#[test]
fn a_very_long_list_is_worked_out_in_one_pass() {
    let list: Vec<Paragraph> = (0..30_000).map(|n| num((n % 3) as u8)).collect();
    let points = vec![22.0; list.len()];
    let started = std::time::Instant::now();
    let got = layout(&list, &points);
    assert_eq!(got.len(), list.len());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

/// The cases the editor's own copy of these rules is tested against.
#[derive(serde::Deserialize, serde::Serialize)]
struct Case {
    name: String,
    paragraphs: Vec<Paragraph>,
    points: Vec<f64>,
    numbers: Vec<Option<u32>>,
    markers: Vec<Option<String>>,
    margins: Vec<f64>,
    indents: Vec<f64>,
}

fn cases() -> Vec<(&'static str, Vec<Paragraph>, Vec<f64>)> {
    let long: Vec<Paragraph> = (0..12).map(|_| num(0)).collect();
    vec![
        (
            "a bulleted list of three levels",
            vec![bul(0), bul(1), bul(2), bul(3), bul(0)],
            vec![22.0; 5],
        ),
        (
            "numbers, deeper numbers and a break",
            vec![
                num(0),
                num(0),
                num(1),
                num(1),
                num(2),
                num(0),
                plain(),
                num(0),
            ],
            vec![20.0; 8],
        ),
        (
            "restarts and a continued list",
            vec![
                num(0),
                num(0),
                starting(num(0), 1),
                plain(),
                starting(num(0), 3),
                num(0),
            ],
            vec![18.0; 6],
        ),
        (
            "every style",
            vec![
                styled(ListStyle::Disc, 0),
                styled(ListStyle::Circle, 0),
                styled(ListStyle::Square, 0),
                styled(ListStyle::Arrow, 0),
                styled(ListStyle::Check, 0),
                styled(ListStyle::Dash, 0),
                styled(ListStyle::Decimal, 0),
                styled(ListStyle::DecimalParen, 0),
                styled(ListStyle::LowerAlpha, 0),
                styled(ListStyle::UpperAlpha, 0),
                styled(ListStyle::LowerRoman, 0),
                styled(ListStyle::UpperRoman, 0),
            ],
            vec![24.0; 12],
        ),
        ("a long numbered list at a big size", long, vec![28.0; 12]),
        (
            "indents of their own",
            vec![
                Paragraph {
                    margin_left: Some(60.0),
                    indent: Some(-20.0),
                    ..bul(0)
                },
                Paragraph {
                    margin_left: Some(30.0),
                    ..num(1)
                },
                item(None, 2),
            ],
            vec![20.0; 3],
        ),
    ]
}

fn computed() -> Vec<Case> {
    cases()
        .into_iter()
        .map(|(name, paragraphs, points)| {
            let geometry = layout(&paragraphs, &points);
            Case {
                name: name.to_owned(),
                numbers: numbers(&paragraphs),
                markers: markers(&paragraphs),
                margins: geometry.iter().map(|g| g.margin).collect(),
                indents: geometry.iter().map(|g| g.indent).collect(),
                paragraphs,
                points,
            }
        })
        .collect()
}

fn fixture() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/text/lists.json")
}

/// Writes the cases down for the editor's tests. Run it after changing a rule here.
#[test]
#[ignore = "writes fixtures/text/lists.json"]
fn write_the_list_cases() {
    let text = serde_json::to_string_pretty(&computed()).unwrap();
    std::fs::create_dir_all(fixture().parent().unwrap()).unwrap();
    std::fs::write(fixture(), text + "\n").unwrap();
}

#[test]
fn the_cases_the_editor_is_tested_against_say_what_these_rules_say() {
    let written: Vec<Case> = serde_json::from_str(&std::fs::read_to_string(fixture()).unwrap())
        .expect("fixtures/text/lists.json (run the ignored `write_the_list_cases`)");
    let now = computed();
    assert_eq!(written.len(), now.len());
    for (a, b) in written.iter().zip(&now) {
        assert_eq!(a.name, b.name);
        assert_eq!(a.numbers, b.numbers, "{}", a.name);
        assert_eq!(a.markers, b.markers, "{}", a.name);
        assert_eq!(a.margins, b.margins, "{}", a.name);
        assert_eq!(a.indents, b.indents, "{}", a.name);
        assert_eq!(a.paragraphs, b.paragraphs, "{}", a.name);
    }
}
