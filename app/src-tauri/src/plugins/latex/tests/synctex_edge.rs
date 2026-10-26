//! SyncTeX against hostile and odd files: a decompression bomb, floods of
//! records, huge numbers, bytes that are not text, and the unit arithmetic
//! worked out by hand (independently of the code).

use std::io::Write;

use flate2::{Compression, write::GzEncoder};

use crate::plugins::latex::synctex::{MAX_UNPACKED, SyncTex, SyncTexError};

fn gz(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

/// `mib` MiB of one byte, packed: a few hundred KB for hundreds of MB.
fn bomb(mib: usize, byte: u8) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    let chunk = vec![byte; 1 << 20];
    for _ in 0..mib {
        encoder.write_all(&chunk).unwrap();
    }
    encoder.finish().unwrap()
}

fn file(preamble: &str, body: &str) -> String {
    format!(
        "SyncTeX Version:1\nInput:1:/p/main.tex\nOutput:pdf\n{preamble}Content:\n!1\n{body}Postamble:\nCount:1\n"
    )
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

#[test]
fn a_gzip_bomb_of_100_mib_is_refused_without_unpacking_it() {
    let packed = bomb(100, b'0');
    assert!(
        packed.len() < 1 << 20,
        "the bomb is small: {}",
        packed.len()
    );
    const { assert!(100 * (1 << 20) > MAX_UNPACKED) };
    assert_eq!(
        SyncTex::from_bytes(&packed).err(),
        Some(SyncTexError::TooLarge)
    );
}

#[test]
fn a_bomb_just_under_the_limit_is_read_as_what_it_is_not() {
    // 60 MiB of "0": inside the limit, so it is read, and is not SyncTeX
    let packed = bomb(60, b'0');
    assert!(matches!(
        SyncTex::from_bytes(&packed),
        Err(SyncTexError::Format(_))
    ));
}

#[test]
fn a_bomb_behind_a_valid_start_is_still_too_big() {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(file("", "{1\n").as_bytes()).unwrap();
    let chunk = vec![b'\n'; 1 << 20];
    for _ in 0..70 {
        encoder.write_all(&chunk).unwrap();
    }
    let packed = encoder.finish().unwrap();
    assert_eq!(
        SyncTex::from_bytes(&packed).err(),
        Some(SyncTexError::TooLarge)
    );
}

#[test]
fn plain_text_over_the_limit_is_too_large_too() {
    let text = file("", "{1\n");
    assert_eq!(
        SyncTex::from_bytes_limited(text.as_bytes(), 20).err(),
        Some(SyncTexError::TooLarge)
    );
}

#[test]
fn a_truncated_or_corrupted_gzip_is_an_error() {
    let packed = gz(file("", "{1\n").as_bytes());
    assert!(SyncTex::from_bytes(&packed).is_ok());
    for cut in [packed.len() - 1, packed.len() - 8, packed.len() / 2, 10, 3] {
        assert!(
            matches!(
                SyncTex::from_bytes(&packed[..cut]),
                Err(SyncTexError::Format(_))
            ),
            "cut at {cut}"
        );
    }
    let mut flipped = packed.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0xff;
    let _ = SyncTex::from_bytes(&flipped);
    // a bad checksum at the end
    let mut bad_crc = packed;
    let end = bad_crc.len() - 5;
    bad_crc[end] ^= 0xff;
    assert!(matches!(
        SyncTex::from_bytes(&bad_crc),
        Err(SyncTexError::Format(_))
    ));
}

#[test]
fn a_flood_of_unclosed_boxes_stays_small_and_is_read() {
    // 5 million "[" lines: each opens a box that is never closed
    let body = format!("{{1\n{}", "[\n".repeat(5_000_000));
    let sync = SyncTex::parse(&file("", &body)).unwrap();
    assert_eq!(sync.forward("main.tex", 1), Err(SyncTexError::NotFound));
}

#[test]
fn a_flood_of_records_is_too_large() {
    let body = format!("{{1\n{}", "(1,1:1,1:1,1,1\n".repeat(2_000_100));
    assert_eq!(
        SyncTex::parse(&file("", &body)).err(),
        Some(SyncTexError::TooLarge)
    );
}

#[test]
fn a_flood_of_inputs_is_too_large() {
    let inputs = "Input:7:a.tex\n".repeat(25_000);
    assert_eq!(
        SyncTex::parse(&file(&inputs, "{1\n")).err(),
        Some(SyncTexError::TooLarge)
    );
    let few = "Input:7:a.tex\n".repeat(1_000);
    assert_eq!(
        SyncTex::parse(&file(&few, "{1\n")).unwrap().inputs().len(),
        1_001
    );
}

#[test]
fn deep_nesting_unwinds_to_the_right_box_afterwards() {
    // 3000 boxes inside each other, closed again, then a lone glue piece:
    // it sits in no box, so it is a point (100 bp, 200 bp) with no size
    let open = "(1,1:6578176,13156352:3289088,822272,411136\n".repeat(3000);
    let close = ")\n".repeat(3000);
    let body = format!("{{1\n{open}{close}g1,7:6578176,13156352\n}}1\n");
    let sync = SyncTex::parse(&file("", &body)).unwrap();
    let hits = sync.forward("main.tex", 7).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(near(hits[0].x, 100.0) && near(hits[0].y, 200.0), "{hits:?}");
    assert!(hits[0].width == 0.0 && hits[0].height == 0.0);
    // the 3000 equal boxes are one hit, not 3000
    assert_eq!(sync.forward("main.tex", 1).unwrap().len(), 1);
}

#[test]
fn numbers_that_overflow_skip_the_record_or_the_file() {
    let body =
        "{1\n(1,5:1e100,1e100:1,1,1\n(1,6:6578176,13156352:3289088,822272,411136\n)\n)\n}1\n";
    // 1e100 sp at a huge unit is not a number any more: the record is skipped
    let sync = SyncTex::parse(&file("Unit:1e300\n", body)).unwrap();
    assert_eq!(sync.forward("main.tex", 5).unwrap()[0].page, 1); // falls to line 6
    assert!(
        sync.forward("main.tex", 6)
            .unwrap()
            .iter()
            .all(|h| h.x.is_finite())
    );
    // tags and lines past u32 are odd records, not wraps
    let body = "{1\n(4294967296,5:1,1:1,1,1\n(1,4294967296:1,1:1,1,1\n(1,99999999999999999999:1,1:1,1,1\n)\n)\n)\n}1\n";
    let sync = SyncTex::parse(&file("", body)).unwrap();
    assert_eq!(sync.forward("main.tex", 5), Err(SyncTexError::NotFound));
    for preamble in [
        "Unit:inf\n",
        "Unit:NaN\n",
        "Unit:-1\n",
        "Magnification:0\n",
        "Magnification:-5\n",
        "X Offset:inf\n",
        "Y Offset:NaN\n",
        "Unit:1e308\nMagnification:1e308\n",
    ] {
        assert!(
            matches!(
                SyncTex::parse(&file(preamble, "{1\n")),
                Err(SyncTexError::Format(_))
            ),
            "{preamble:?}"
        );
    }
}

#[test]
fn bytes_that_are_not_text_are_read_or_refused_never_a_panic() {
    let mut bytes = b"SyncTeX Version:1\nInput:1:/p/ma\xff\xfein.tex\nInput:2:/p/\0nul.tex\nContent:\n{1\n(1,5:6578176,13156352:3289088,822272,411136\n(2,3:\xff,\0:\0\n)\n)\n}1\n".to_vec();
    let sync = SyncTex::from_bytes(&bytes).unwrap();
    assert_eq!(sync.inputs().len(), 2);
    assert!(sync.forward("nul.tex", 3).is_err());
    assert!(sync.inverse(1, 120.0, 195.0).is_ok());
    // NUL everywhere
    bytes.iter_mut().step_by(7).for_each(|b| *b = 0);
    let _ = SyncTex::from_bytes(&bytes);
    let _ = SyncTex::from_bytes(&[0; 4096]);
    let _ = SyncTex::from_bytes(&gz(&[0; 4096]));
}

#[test]
fn a_10_mb_line_is_just_a_line() {
    let long = "x".repeat(10_000_000);
    let body = format!(
        "{{1\n(1,{long},5:1,1\n)\nk1,{long}\n(1,5:6578176,13156352:3289088,822272,411136\n)\n}}1\n"
    );
    let sync = SyncTex::parse(&file("", &body)).unwrap();
    assert_eq!(sync.forward("main.tex", 5).unwrap().len(), 1);
    let sync = SyncTex::parse(&file(&format!("Input:2:{long}\n"), "{1\n")).unwrap();
    assert_eq!(sync.inputs().len(), 2);
}

#[test]
fn the_units_worked_out_by_hand() {
    // A TeX point is 1/72.27 in and a PDF point 1/72 in, and a point is
    // 65536 sp, so one PDF point is 65536 * 72.27 / 72 = 65781.76 sp.
    // Hence: 6578176 sp = 100 bp, 13156352 sp = 200 bp, 3289088 sp = 50 bp,
    // 822272 sp = 12.5 bp, 411136 sp = 6.25 bp. The y of a box is its
    // baseline, measured down from the top of the page.
    let body = "{1\n(1,5:6578176,13156352:3289088,822272,411136\n)\n}1\n";
    let boxes = |preamble: &str| {
        let sync = SyncTex::parse(&file(preamble, body)).unwrap();
        sync.forward("main.tex", 5).unwrap()[0]
    };
    let plain = boxes("Magnification:1000\nUnit:1\n");
    assert!(near(plain.x, 100.0) && near(plain.y, 200.0), "{plain:?}");
    assert!(near(plain.width, 50.0));
    assert!(near(plain.height, 12.5) && near(plain.depth, 6.25));
    assert!(near(plain.top(), 187.5) && near(plain.bottom(), 206.25));
    // the default (nothing said) is the same
    assert_eq!(boxes(""), plain);
    // \mag 1500 scales everything by 1.5
    let mag = boxes("Magnification:1500\nUnit:1\n");
    assert!(near(mag.x, 150.0) && near(mag.y, 300.0) && near(mag.width, 75.0));
    assert!(near(mag.height, 18.75) && near(mag.depth, 9.375));
    // a Unit of 2 doubles it
    let unit = boxes("Unit:2\n");
    assert!(near(unit.x, 200.0) && near(unit.y, 400.0) && near(unit.width, 100.0));
    // a click 1 bp inside the left edge and 5 bp above the baseline is inside
    let sync = SyncTex::parse(&file("", body)).unwrap();
    let source = sync.inverse(1, 101.0, 195.0).unwrap();
    assert_eq!((source.file.as_str(), source.line), ("/p/main.tex", 5));
    // 100 bp above the box is nowhere near it
    assert_eq!(sync.inverse(1, 101.0, 80.0), Err(SyncTexError::NotFound));
}

#[test]
fn file_names_match_whatever_the_case_or_the_slashes() {
    let preamble =
        "Input:2:C:\\Users\\u\\Book\\Main.tex\nInput:3:/p/Case.tex\nInput:4:/p/case.tex\n";
    let body = "{1\n(2,8:6578176,13156352:3289088,822272,411136\n)\n(3,1:6578176,6578176:3289088,822272,411136\n)\n(4,2:6578176,9867264:3289088,822272,411136\n)\n}1\n";
    let sync = SyncTex::parse(&file(preamble, body)).unwrap();
    let want = sync.forward("C:/Users/u/Book/Main.tex", 8).unwrap();
    for name in [
        "c:\\users\\u\\book\\main.tex",
        "MAIN.TEX",
        "\\\\?\\C:\\Users\\u\\Book\\Main.tex",
        "book/main.tex",
    ] {
        assert_eq!(sync.forward(name, 8).unwrap(), want, "{name}");
    }
    // when two files differ only by case, the exact spelling wins
    let upper = sync.forward("Case.tex", 1).unwrap();
    let lower = sync.forward("case.tex", 2).unwrap();
    assert!(near(upper[0].y, 100.0) && near(lower[0].y, 150.0));
    assert_eq!(sync.forward("Case.tex", 2).unwrap(), upper); // nearest line of Case.tex
}
