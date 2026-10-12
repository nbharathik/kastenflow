use super::code::{
    Code, block_lengths, data_codewords, divisor, encode, format_bits, gf_multiply, inverts,
    patterns, penalty, remainder, size_of, total_codewords, version_bits, version_for,
};
use super::*;
use crate::composites::expand as expand_element;
use crate::model::{Base, Extra};

// ---- the arithmetic, held to the numbers of the standard

#[test]
fn reed_solomon_gives_the_codewords_of_the_standards_own_example() {
    // "01234567" at version 1, level M, which ISO 18004 works through.
    let data = [
        16u8, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17,
    ];
    assert_eq!(
        remainder(&data, &divisor(10)),
        [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]
    );
}

#[test]
fn the_codewords_of_data_and_correction_are_zero_at_the_roots_of_the_divisor() {
    for (degree, length) in [(10usize, 16usize), (16, 28), (18, 32), (22, 39), (26, 44)] {
        let data: Vec<u8> = (0..length).map(|i| (i * 37 + 11) as u8).collect();
        let checks = remainder(&data, &divisor(degree));
        assert_eq!(checks.len(), degree);
        let word: Vec<u8> = data.iter().chain(&checks).copied().collect();
        let mut root = 1u8;
        for i in 0..degree {
            let at = word.iter().fold(0u8, |acc, &c| gf_multiply(acc, root) ^ c);
            assert_eq!(at, 0, "degree {degree}, root {i}");
            root = gf_multiply(root, 2);
        }
    }
}

#[test]
fn the_field_multiplies_as_the_standard_says() {
    assert_eq!(gf_multiply(2, 128), 0x1D);
    assert_eq!(gf_multiply(0, 77), 0);
    assert_eq!(gf_multiply(1, 77), 77);
    assert_eq!(gf_multiply(3, 7), gf_multiply(7, 3));
}

#[test]
fn the_format_and_version_information_are_the_standards() {
    assert_eq!(format_bits(0b00, 0), 0x5412, "M, mask 0");
    assert_eq!(format_bits(0b01, 0), 0x77C4, "L, mask 0");
    assert_eq!(format_bits(0b11, 0), 0x355F, "Q, mask 0");
    assert_eq!(format_bits(0b10, 7), 0x083B, "H, mask 7");
    assert_eq!(
        [7, 8, 9, 10].map(version_bits),
        [0x07C94, 0x085BC, 0x09A99, 0x0A4D3]
    );
}

#[test]
fn a_version_holds_as_many_codewords_as_the_standard_says() {
    let total = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    let data = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
    for v in 1..=10 {
        assert_eq!(
            (total_codewords(v), data_codewords(v)),
            (total[v - 1], data[v - 1]),
            "version {v}"
        );
        let (ec, lengths) = block_lengths(v);
        assert_eq!(lengths.iter().sum::<usize>(), data[v - 1]);
        assert_eq!(ec * lengths.len() + data[v - 1], total[v - 1]);
    }
}

#[test]
fn the_modules_left_for_data_are_the_number_the_standard_gives_for_each_version() {
    // Independent of how the patterns are drawn: the modules that are not pattern are the codewords' bits and a few spare.
    let raw = [208, 359, 567, 807, 1079, 1383, 1568, 1936, 2336, 2768];
    for v in 1..=10 {
        let grid = patterns(v);
        let free = grid.function.iter().flatten().filter(|f| !**f).count();
        assert_eq!(free, raw[v - 1], "version {v}");
        assert_eq!(grid.size, size_of(v));
    }
}

#[test]
fn the_patterns_are_where_a_reader_looks_for_them() {
    let grid = patterns(2);
    let dark = |x: usize, y: usize| grid.modules[y][x];
    // The three finders: a dark ring, a light ring, and a dark middle, with a light ring round them.
    for (cx, cy) in [(3usize, 3usize), (grid.size - 4, 3), (3, grid.size - 4)] {
        for dy in -3i32..=3 {
            for dx in -3i32..=3 {
                let d = dx.abs().max(dy.abs());
                let (x, y) = ((cx as i32 + dx) as usize, (cy as i32 + dy) as usize);
                assert_eq!(dark(x, y), d != 2, "finder at {cx} {cy}: {dx} {dy}");
            }
        }
    }
    // The timing lines alternate between the finders, and the one module that is always dark is.
    for i in 8..grid.size - 8 {
        assert_eq!((dark(6, i), dark(i, 6)), (i % 2 == 0, i % 2 == 0));
    }
    assert!(dark(8, grid.size - 8));
    // Version 2 has an alignment pattern at 18, 18.
    for dy in -2i32..=2 {
        for dx in -2i32..=2 {
            assert_eq!(
                dark((18 + dx) as usize, (18 + dy) as usize),
                dx.abs().max(dy.abs()) != 1
            );
        }
    }
}

// ---- a reader, written apart from the writer: format, mask, zigzag, blocks, correction, bytes

fn read_format(code: &Code) -> Option<u32> {
    let m = &code.modules;
    let size = code.size;
    let first: [(usize, usize); 15] = [
        (8, 0),
        (8, 1),
        (8, 2),
        (8, 3),
        (8, 4),
        (8, 5),
        (8, 7),
        (8, 8),
        (7, 8),
        (5, 8),
        (4, 8),
        (3, 8),
        (2, 8),
        (1, 8),
        (0, 8),
    ];
    let mut second: Vec<(usize, usize)> = (0..8).map(|i| (size - 1 - i, 8)).collect();
    second.extend((8..15).map(|i| (8, size - 15 + i)));
    let value = |at: &[(usize, usize)]| {
        at.iter()
            .enumerate()
            .fold(0u32, |acc, (i, (x, y))| acc | (u32::from(m[*y][*x]) << i))
    };
    let (a, b) = (value(&first), value(&second));
    (a == b)
        .then(|| (0..8).find(|mask| format_bits(0, *mask) == a))
        .flatten()
}

fn decode(code: &Code) -> Option<Vec<u8>> {
    let mask = read_format(code)?;
    let version = (code.size - 17) / 4;
    let free = patterns(version);
    let size = code.size;
    // The bits in the order the standard walks them: columns in pairs from the right, up then down.
    let mut bits = Vec::new();
    let mut right = size as i32 - 1;
    let mut up = true;
    while right > 0 {
        if right == 6 {
            right -= 1;
        }
        let rows: Vec<usize> = if up {
            (0..size).rev().collect()
        } else {
            (0..size).collect()
        };
        for y in rows {
            for x in [right as usize, right as usize - 1] {
                if !free.function[y][x] {
                    bits.push(code.modules[y][x] ^ inverts(mask, x, y));
                }
            }
        }
        up = !up;
        right -= 2;
    }
    let all: Vec<u8> = bits
        .chunks(8)
        .filter(|c| c.len() == 8)
        .map(|c| c.iter().fold(0u8, |b, bit| (b << 1) | u8::from(*bit)))
        .collect();
    assert_eq!(all.len(), total_codewords(version));
    // Back into blocks.
    let (ec, lengths) = block_lengths(version);
    let longest = *lengths.iter().max()?;
    let mut blocks: Vec<Vec<u8>> = vec![Vec::new(); lengths.len()];
    let mut at = 0;
    for i in 0..longest {
        for (b, length) in lengths.iter().enumerate() {
            if i < *length {
                blocks[b].push(all[at]);
                at += 1;
            }
        }
    }
    let mut checks: Vec<Vec<u8>> = vec![Vec::new(); lengths.len()];
    for _ in 0..ec {
        for block in checks.iter_mut() {
            block.push(all[at]);
            at += 1;
        }
    }
    // Every block must say what the correction says it should.
    for (block, check) in blocks.iter().zip(&checks) {
        assert_eq!(
            &remainder(block, &divisor(ec)),
            check,
            "the correction codewords of a block"
        );
    }
    let data: Vec<u8> = blocks.concat();
    let mut stream = data
        .iter()
        .flat_map(|b| (0..8).rev().map(move |i| (b >> i) & 1 == 1));
    let mut take = |n: usize| {
        (0..n).try_fold(0usize, |acc, _| {
            stream.next().map(|bit| (acc << 1) | usize::from(bit))
        })
    };
    if take(4)? != 0b0100 {
        return None;
    }
    let count = take(if version <= 9 { 8 } else { 16 })?;
    (0..count).map(|_| take(8).map(|v| v as u8)).collect()
}

#[test]
fn a_code_reads_back_as_the_text_that_was_put_in_it() {
    let long = "A fairly long sentence for a code, with some numbers 0123456789 and symbols !?&%. "
        .repeat(2);
    let texts = [
        "A".to_owned(),
        "https://kasten.example/talk".to_owned(),
        "01234567".to_owned(),
        "héllo wörld ✓ 日本".to_owned(),
        "x".repeat(14),
        "x".repeat(15),
        long.clone(),
        "y".repeat(180),
        "z".repeat(181),
        "w".repeat(213),
    ];
    for text in &texts {
        let code = encode(text).unwrap_or_else(|| panic!("a code for {} bytes", text.len()));
        assert_eq!(
            decode(&code).as_deref(),
            Some(text.as_bytes()),
            "{} bytes, version {}",
            text.len(),
            code.version
        );
        assert_eq!(code.size, size_of(code.version));
        assert_eq!(Some(code.version), version_for(text.len()));
    }
}

#[test]
fn a_code_is_the_smallest_version_that_holds_the_bytes_and_none_holds_more_than_213() {
    assert_eq!(encode(&"x".repeat(14)).map(|c| c.version), Some(1));
    assert_eq!(encode(&"x".repeat(15)).map(|c| c.version), Some(2));
    assert_eq!(encode(&"x".repeat(213)).map(|c| c.version), Some(10));
    assert_eq!(encode(&"x".repeat(214)), None);
    assert_eq!(encode(""), None);
}

#[test]
fn the_same_text_is_always_the_same_code() {
    assert_eq!(encode("https://example.com"), encode("https://example.com"));
    assert_ne!(
        encode("https://example.com/a"),
        encode("https://example.com/b")
    );
}

#[test]
fn a_flat_grid_scores_worse_than_a_chequered_one() {
    let size = 25;
    let flat = vec![vec![false; size]; size];
    let cheque: Vec<Vec<bool>> = (0..size)
        .map(|y| (0..size).map(|x| (x + y) % 2 == 0).collect())
        .collect();
    assert!(penalty(&flat) > penalty(&cheque) * 3);
}

// ---- how it is drawn

fn qr(data: &str, caption: Option<&str>, w: f64, h: f64) -> QrEl {
    QrEl {
        base: Base::new("q-1").place(100.0, 100.0, w, h),
        data: data.to_owned(),
        caption: caption.map(str::to_owned),
        extra: Extra::new(),
    }
}

fn parts_of(el: QrEl) -> Vec<Element> {
    expand_element(&crate::themes::light(), "blank", &Element::Qr(el)).unwrap_or_default()
}

fn fill_of(part: &Element) -> String {
    part.base()
        .style
        .as_ref()
        .and_then(|s| s.fill.as_ref())
        .map(|f| f.color.clone())
        .unwrap_or_default()
}

#[test]
fn a_code_is_a_white_tile_with_a_black_rectangle_for_each_run_of_dark_modules() {
    let parts = parts_of(qr("https://kasten.example/talk", None, 300.0, 300.0));
    assert_eq!(fill_of(&parts[0]), "#ffffff");
    assert_eq!(parts[0].base().rect(), Some((100.0, 100.0, 300.0, 300.0)));
    assert!(parts[1..].iter().all(|p| fill_of(p) == "#000000"));
    let found = encode("https://kasten.example/talk").unwrap();
    let runs: usize = found
        .modules
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .filter(|(x, dark)| **dark && (*x == 0 || !row[x - 1]))
                .count()
        })
        .sum();
    assert_eq!(parts.len(), 1 + runs);
    // Every row of dark modules is one rectangle, so there are far fewer than modules.
    let dark: usize = found.modules.iter().flatten().filter(|m| **m).count();
    assert!(runs < dark);
    // The quiet margin: nothing dark within four modules of the tile's edge.
    let module = 300.0 / (found.size + 8) as f64;
    for p in &parts[1..] {
        let (x, y, w, h) = p.base().rect().unwrap();
        assert!(
            x >= 100.0 + 4.0 * module - 0.02 && y >= 100.0 + 4.0 * module - 0.02,
            "{x} {y}"
        );
        assert!(x + w <= 400.0 - 4.0 * module + 0.02 && y + h <= 400.0 - 4.0 * module + 0.02);
    }
}

#[test]
fn the_code_is_square_and_centred_in_a_box_of_another_shape_with_the_caption_under_it() {
    let parts = parts_of(qr("hello", Some("Scan me"), 500.0, 300.0));
    let (x, y, w, h) = parts[0].base().rect().unwrap();
    assert_eq!(w, h, "a square tile");
    assert!(h < 300.0 && y == 100.0);
    assert!((x + w / 2.0 - 350.0).abs() < 0.02, "centred across the box");
    let words = parts.last().unwrap();
    assert_eq!(
        words.text().map(|t| t.plain_text()).as_deref(),
        Some("Scan me")
    );
    assert!(words.base().y.unwrap() >= y + h - 0.02, "under the code");
}

#[test]
fn what_cannot_be_a_code_is_a_note_that_says_why() {
    for (data, wanted) in [
        ("", "Type the address"),
        ("   ", "Type the address"),
        (&"x".repeat(300), "too long"),
    ] {
        let parts = parts_of(qr(data, None, 300.0, 200.0));
        let words: Vec<String> = parts
            .iter()
            .filter_map(|p| p.text().map(|t| t.plain_text()))
            .collect();
        assert!(
            words.iter().any(|w| w.contains(wanted)),
            "{wanted}: {words:?}"
        );
        assert!(parts.iter().all(|p| fill_of(p) != "#000000"));
    }
}

#[test]
fn every_part_is_inside_the_box_however_small() {
    for (w, h) in [
        (300.0, 300.0),
        (40.0, 40.0),
        (500.0, 20.0),
        (0.0, 0.0),
        (10.0, 400.0),
    ] {
        for p in parts_of(qr(
            "https://example.com/some/long/address?x=1",
            Some("caption"),
            w,
            h,
        )) {
            let (x, y, pw, ph) = p.base().rect().unwrap();
            assert!(
                x >= 100.0 - 0.011
                    && y >= 100.0 - 0.011
                    && x + pw <= 100.0 + w + 0.011
                    && y + ph <= 100.0 + h + 0.011,
                "{w}x{h}"
            );
        }
    }
}

#[test]
fn it_says_what_it_holds_for_those_who_cannot_see_it() {
    assert_eq!(
        alt_of(&qr("https://example.com", None, 1.0, 1.0)),
        "QR code: https://example.com"
    );
    assert_eq!(alt_of(&qr("  ", None, 1.0, 1.0)), "QR code");
    assert!(alt_of(&qr(&"a".repeat(100), None, 1.0, 1.0)).ends_with('\u{2026}'));
}
