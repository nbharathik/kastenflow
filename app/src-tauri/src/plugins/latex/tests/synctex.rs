//! SyncTeX forward and inverse search on a hand-written file: the text format
//! (no real TeX run is needed) compressed by a test helper, as TeX does.

use std::io::Write;

use flate2::{Compression, write::GzEncoder};

use crate::plugins::latex::synctex::{Hit, SyncTex, SyncTexError};

const MAIN: &str = "/home/u/book/main.tex";
const ONE: &str = "/home/u/book/chapters/one.tex";

/// Two pages. Sizes are in TeX's scaled points (65781.76 to a PDF point),
/// so 4736286 is one inch (72) and 9472572 is 144. Page 1 has lines 5 and 6
/// of main.tex and line 3 of one.tex; page 2 has line 10 of main.tex, a
/// box of line 20 with a smaller one of line 21 inside it, and line 8 of
/// one.tex. Boxes of line 0 hold nothing of the source.
const FIXTURE: &str = "SyncTeX Version:1
Input:1:/home/u/book/main.tex
Input:2:/home/u/book/chapters/one.tex
Input:3:/usr/share/texlive/texmf-dist/tex/latex/base/article.cls
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!1234
{1
[1,0:4736286,4736286:34732998,43888646,0
(1,5:4736286,9472572:34732998,655360,196608
g1,5:4736286,9472572
k1,5:5000000,9472572:100000
h1,5:4736286,9472572:34732998,655360,196608
)
(1,6:4736286,10800000:34732998,655360,196608
$1,6:4736286,10800000
)
(2,3:4736286,14000000:34732998,655360,196608
x2,3:4736286,14000000
)
]
}1
{2
[1,0:4736286,4736286:34732998,43888646,0
(1,10:4736286,6000000:34732998,655360,196608
)
(1,20:4736286,12000000:34732998,3000000,1000000
(1,21:8000000,12500000:5000000,655360,196608
)
)
(2,8:4736286,20000000:34732998,655360,196608
)
]
}2
Postamble:
Count:14
Post scriptum:
";

fn bp(sp: f64) -> f64 {
    sp / 65781.76
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

fn gz(text: &str) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(text.as_bytes()).unwrap();
    encoder.finish().unwrap()
}

fn load() -> SyncTex {
    SyncTex::from_bytes(&gz(FIXTURE)).expect("the fixture reads")
}

fn holds(hit: &Hit, x: f64, y: f64, slack: f64) -> bool {
    x >= hit.x - slack
        && x <= hit.x + hit.width + slack
        && y >= hit.top() - slack
        && y <= hit.bottom() + slack
}

#[test]
fn the_compressed_and_the_plain_file_read_the_same() {
    let packed = SyncTex::from_bytes(&gz(FIXTURE)).unwrap();
    let plain = SyncTex::from_bytes(FIXTURE.as_bytes()).unwrap();
    assert_eq!(packed.inputs(), plain.inputs());
    assert_eq!(
        packed.forward("main.tex", 5).unwrap(),
        plain.forward("main.tex", 5).unwrap()
    );
    assert_eq!(packed.inputs().len(), 3);
    assert_eq!(packed.inputs()[0], (1, MAIN.to_owned()));
}

#[test]
fn forward_finds_the_box_of_a_line() {
    let hits = load().forward("main.tex", 5).unwrap();
    assert_eq!(hits.len(), 1);
    let hit = &hits[0];
    assert_eq!(hit.page, 1);
    assert!(near(hit.x, 72.0), "x {}", hit.x);
    assert!(near(hit.y, 144.0), "y {}", hit.y);
    assert!(near(hit.width, bp(34_732_998.0)));
    assert!(near(hit.height, bp(655_360.0)));
    assert!(near(hit.depth, bp(196_608.0)));
    assert!(near(hit.top(), 144.0 - bp(655_360.0)));
    assert!(near(hit.bottom(), 144.0 + bp(196_608.0)));
}

#[test]
fn forward_reads_a_file_by_full_path_relative_path_or_name() {
    let sync = load();
    let by_path = sync.forward(ONE, 3).unwrap();
    assert_eq!(by_path, sync.forward("chapters/one.tex", 3).unwrap());
    assert_eq!(by_path, sync.forward("./chapters/one.tex", 3).unwrap());
    assert_eq!(by_path, sync.forward("one.tex", 3).unwrap());
    assert_eq!(
        by_path,
        sync.forward("\\home\\u\\book\\chapters\\one.tex", 3)
            .unwrap()
    );
    assert_eq!(by_path[0].page, 1);
    assert!(near(by_path[0].y, bp(14_000_000.0)));
}

#[test]
fn a_leaf_on_a_line_does_not_double_the_box_it_sits_in() {
    assert_eq!(load().forward("main.tex", 6).unwrap().len(), 1);
}

#[test]
fn forward_on_a_line_without_a_box_takes_the_next_one_else_the_last() {
    let sync = load();
    let next = sync.forward("main.tex", 7).unwrap();
    assert_eq!(next, sync.forward("main.tex", 10).unwrap());
    assert_eq!(next[0].page, 2);
    let last = sync.forward("main.tex", 500).unwrap();
    assert_eq!(last, sync.forward("main.tex", 21).unwrap());
    assert_eq!(last[0].page, 2);
    assert!(near(last[0].y, bp(12_500_000.0)));
    assert_eq!(
        sync.forward("main.tex", 1).unwrap(),
        sync.forward("main.tex", 5).unwrap()
    );
}

#[test]
fn forward_with_nothing_to_find_is_not_found() {
    let sync = load();
    assert_eq!(sync.forward("other.tex", 5), Err(SyncTexError::NotFound));
    // an input that no box came from
    assert_eq!(sync.forward("article.cls", 5), Err(SyncTexError::NotFound));
    assert_eq!(sync.forward("", 5), Err(SyncTexError::NotFound));
}

#[test]
fn inverse_finds_the_source_of_a_click() {
    let sync = load();
    let src = sync.inverse(1, 100.0, 141.0).unwrap();
    assert_eq!((src.file.as_str(), src.line), (MAIN, 5));
    let src = sync.inverse(1, 100.0, 163.0).unwrap();
    assert_eq!((src.file.as_str(), src.line), (MAIN, 6));
    let src = sync.inverse(1, 80.0, 210.0).unwrap();
    assert_eq!((src.file.as_str(), src.line), (ONE, 3));
    let src = sync.inverse(2, 100.0, 302.0).unwrap();
    assert_eq!((src.file.as_str(), src.line), (ONE, 8));
}

#[test]
fn inverse_takes_the_smallest_box_around_the_click() {
    let sync = load();
    let inner = sync.inverse(2, 130.0, 190.0).unwrap();
    assert_eq!(inner.line, 21);
    let outer = sync.inverse(2, 100.0, 140.0).unwrap();
    assert_eq!(outer.line, 20);
}

#[test]
fn inverse_just_off_a_line_takes_the_nearest_one() {
    let src = load().inverse(1, 100.0, 150.0).unwrap();
    assert_eq!(src.line, 5);
}

#[test]
fn inverse_with_nothing_near_is_not_found() {
    let sync = load();
    assert_eq!(sync.inverse(3, 100.0, 141.0), Err(SyncTexError::NotFound));
    assert_eq!(sync.inverse(0, 100.0, 141.0), Err(SyncTexError::NotFound));
    assert_eq!(sync.inverse(1, 100.0, 700.0), Err(SyncTexError::NotFound));
    assert_eq!(sync.inverse(1, 5000.0, 144.0), Err(SyncTexError::NotFound));
    assert_eq!(
        sync.inverse(1, f64::NAN, 144.0),
        Err(SyncTexError::NotFound)
    );
    assert_eq!(
        sync.inverse(1, 100.0, f64::INFINITY),
        Err(SyncTexError::NotFound)
    );
}

#[test]
fn a_click_found_forward_again_lands_on_the_same_page_and_place() {
    let sync = load();
    let clicks = [
        (1, 100.0, 141.0),
        (1, 100.0, 163.0),
        (1, 80.0, 210.0),
        (2, 100.0, 90.0),
        (2, 130.0, 190.0),
        (2, 100.0, 140.0),
        (2, 100.0, 302.0),
    ];
    for (page, x, y) in clicks {
        let src = sync.inverse(page, x, y).unwrap();
        let hits = sync.forward(&src.file, src.line).unwrap();
        assert!(
            hits.iter().any(|h| h.page == page && holds(h, x, y, 1.0)),
            "click {page} {x} {y} came from {src:?}, which shows at {hits:?}"
        );
    }
}

#[test]
fn magnification_and_offsets_move_the_boxes() {
    let doubled = SyncTex::parse(&FIXTURE.replace("Magnification:1000", "Magnification:2000"))
        .unwrap()
        .forward("main.tex", 5)
        .unwrap();
    assert!(near(doubled[0].x, 144.0));
    assert!(near(doubled[0].width, 2.0 * bp(34_732_998.0)));
    let shifted = SyncTex::parse(&FIXTURE.replace("X Offset:0", "X Offset:4736286"))
        .unwrap()
        .forward("main.tex", 5)
        .unwrap();
    assert!(near(shifted[0].x, 144.0));
    assert!(near(shifted[0].y, 144.0));
}

#[test]
fn a_file_that_is_not_synctex_is_an_error() {
    for text in ["", "hello", "SyncTeX Version:1\nInput:1:/a.tex\n"] {
        assert!(
            matches!(SyncTex::parse(text), Err(SyncTexError::Format(_))),
            "{text:?}"
        );
    }
    let bad_unit = FIXTURE.replace("Unit:1", "Unit:0");
    assert!(matches!(
        SyncTex::parse(&bad_unit),
        Err(SyncTexError::Format(_))
    ));
    let junk = [0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5];
    assert!(matches!(
        SyncTex::from_bytes(&junk),
        Err(SyncTexError::Format(_))
    ));
    assert!(matches!(
        SyncTex::from_bytes(&[]),
        Err(SyncTexError::Format(_))
    ));
}

#[test]
fn a_file_that_unpacks_too_big_is_refused() {
    let big = format!("{FIXTURE}{}", "!1\n".repeat(2000));
    let packed = gz(&big);
    assert_eq!(
        SyncTex::from_bytes_limited(&packed, 5000).err(),
        Some(SyncTexError::TooLarge)
    );
    assert!(SyncTex::from_bytes_limited(&packed, 100_000).is_ok());
}

#[test]
fn odd_records_are_skipped_not_fatal() {
    let odd = FIXTURE.replace(
        "{1\n",
        "{1\n)\n]\nv\nh1\nk\ng1,x:1,2\n(1,7:abc,def:1,2,3\n(,:\n\u{e9}\u{e9}\n",
    );
    let sync = SyncTex::parse(&odd).unwrap();
    assert_eq!(sync.forward("main.tex", 5).unwrap().len(), 1);
}

/// A small, repeatable noise source (no random-number dependency).
fn next(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    *state >> 33
}

#[test]
fn every_cut_and_scramble_is_read_without_panicking() {
    let packed = gz(FIXTURE);
    for cut in 0..=packed.len() {
        let _ = SyncTex::from_bytes(&packed[..cut]);
    }
    let bytes = FIXTURE.as_bytes();
    let mut state = 11_u64;
    for cut in 0..=bytes.len() {
        if let Ok(sync) = SyncTex::from_bytes(&bytes[..cut]) {
            let _ = sync.forward("main.tex", 5);
            let _ = sync.inverse(1, 100.0, 141.0);
        }
    }
    for _ in 0..300 {
        let mut copy = bytes.to_vec();
        for _ in 0..6 {
            let at = next(&mut state) as usize % copy.len();
            copy[at] = (next(&mut state) & 0xff) as u8;
        }
        if let Ok(sync) = SyncTex::from_bytes(&copy) {
            let _ = sync.forward("main.tex", next(&mut state) as u32 % 40);
            let _ = sync.forward("main.tex", u32::MAX);
            let _ = sync.inverse(1 + next(&mut state) as u32 % 3, 100.0, 141.0);
            let _ = sync.inverse(u32::MAX, f64::NEG_INFINITY, f64::NAN);
        }
    }
}
