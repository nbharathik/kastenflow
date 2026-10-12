//! The QR code of ISO/IEC 18004 as far as a slide needs it: text in byte mode, the error correction level M, versions 1
//! to 10 (up to 213 bytes). It follows the standard step by step: the data and its padding, Reed-Solomon codewords in
//! blocks that are interleaved, the function patterns, the zigzag of data modules, the mask with the least penalty, and
//! the format and version information.

/// The most bytes a code holds at this level.
pub const MOST_BYTES: usize = 213;

/// A code: `size` modules across, `modules[y][x]` true for dark.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Code {
    pub version: usize,
    pub size: usize,
    pub modules: Vec<Vec<bool>>,
}

/// Level M: the codewords of error correction for each block, and the blocks as (how many, data codewords in each), by version.
const BLOCKS: [(usize, [(usize, usize); 2]); 10] = [
    (10, [(1, 16), (0, 0)]),
    (16, [(1, 28), (0, 0)]),
    (26, [(1, 44), (0, 0)]),
    (18, [(2, 32), (0, 0)]),
    (24, [(2, 43), (0, 0)]),
    (16, [(4, 27), (0, 0)]),
    (18, [(4, 31), (0, 0)]),
    (22, [(2, 38), (2, 39)]),
    (22, [(3, 36), (2, 37)]),
    (26, [(4, 43), (1, 44)]),
];

/// Where the alignment patterns are centred (rows and columns), by version.
const ALIGNMENT: [&[usize]; 10] = [
    &[],
    &[6, 18],
    &[6, 22],
    &[6, 26],
    &[6, 30],
    &[6, 34],
    &[6, 22, 38],
    &[6, 24, 42],
    &[6, 26, 46],
    &[6, 28, 50],
];

/// The two bits of level M in the format information.
const LEVEL_M: u32 = 0b00;

/// How many data codewords a version holds.
pub fn data_codewords(version: usize) -> usize {
    let (_, groups) = BLOCKS[version - 1];
    groups.iter().map(|(count, each)| count * each).sum()
}

/// How many codewords a version holds in all, data and error correction.
pub fn total_codewords(version: usize) -> usize {
    let (ec, groups) = BLOCKS[version - 1];
    data_codewords(version) + ec * groups.iter().map(|(count, _)| count).sum::<usize>()
}

/// The modules across a version.
pub fn size_of(version: usize) -> usize {
    17 + 4 * version
}

// ---- Reed-Solomon over GF(256), with the polynomial 0x11D

/// The product of two numbers of the field.
pub fn gf_multiply(x: u8, y: u8) -> u8 {
    let mut z: u8 = 0;
    for i in (0..8).rev() {
        z = (z << 1) ^ ((z >> 7) * 0x1D);
        z ^= ((y >> i) & 1) * x;
    }
    z
}

/// The divisor for `degree` codewords of correction: the product of (x - 2^i) for i below the degree, without its leading term.
pub fn divisor(degree: usize) -> Vec<u8> {
    let mut result = vec![0u8; degree];
    result[degree - 1] = 1;
    let mut root = 1u8;
    for _ in 0..degree {
        for j in 0..degree {
            result[j] = gf_multiply(result[j], root);
            if j + 1 < degree {
                result[j] ^= result[j + 1];
            }
        }
        root = gf_multiply(root, 2);
    }
    result
}

/// The codewords of correction for `data`: the remainder of dividing it, as a polynomial, by the divisor.
pub fn remainder(data: &[u8], divisor: &[u8]) -> Vec<u8> {
    let mut result = vec![0u8; divisor.len()];
    for &byte in data {
        let factor = byte ^ result[0];
        result.rotate_left(1);
        let last = result.len() - 1;
        result[last] = 0;
        for (r, &d) in result.iter_mut().zip(divisor) {
            *r ^= gf_multiply(d, factor);
        }
    }
    result
}

// ---- bits

#[derive(Default)]
struct Bits(Vec<bool>);

impl Bits {
    fn push(&mut self, value: u32, count: usize) {
        for i in (0..count).rev() {
            self.0.push((value >> i) & 1 == 1);
        }
    }

    fn bytes(&self) -> Vec<u8> {
        self.0
            .chunks(8)
            .map(|c| c.iter().fold(0u8, |byte, bit| (byte << 1) | u8::from(*bit)))
            .collect()
    }
}

/// The smallest version that holds `length` bytes, if there is one.
pub fn version_for(length: usize) -> Option<usize> {
    (1..=10).find(|&v| {
        let count_bits = if v <= 9 { 8 } else { 16 };
        4 + count_bits + 8 * length <= data_codewords(v) * 8
    })
}

/// The data codewords for the bytes at the version: the mode, the count, the bytes, the end and the padding.
fn data_for(bytes: &[u8], version: usize) -> Vec<u8> {
    let capacity = data_codewords(version) * 8;
    let mut bits = Bits::default();
    bits.push(0b0100, 4);
    bits.push(
        u32::try_from(bytes.len()).unwrap_or(0),
        if version <= 9 { 8 } else { 16 },
    );
    for &b in bytes {
        bits.push(u32::from(b), 8);
    }
    bits.push(0, 4.min(capacity - bits.0.len()));
    bits.push(0, (8 - bits.0.len() % 8) % 8);
    let mut data = bits.bytes();
    let mut pad = [0xEC, 0x11].into_iter().cycle();
    while data.len() < data_codewords(version) {
        data.push(pad.next().unwrap_or(0xEC));
    }
    data
}

/// How a version's codewords are divided: the codewords of correction in each block, and how many of data each block has, in order.
pub fn block_lengths(version: usize) -> (usize, Vec<usize>) {
    let (ec, groups) = BLOCKS[version - 1];
    (
        ec,
        groups
            .iter()
            .flat_map(|(count, each)| std::iter::repeat_n(*each, *count))
            .collect(),
    )
}

/// The data and the correction codewords of every block, interleaved: the first codeword of each block, the second ...
pub fn codewords(data: &[u8], version: usize) -> Vec<u8> {
    let (ec, lengths) = block_lengths(version);
    let divisor = divisor(ec);
    let mut blocks: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    let mut at = 0;
    for each in lengths {
        let part = data[at..at + each].to_vec();
        at += each;
        let checks = remainder(&part, &divisor);
        blocks.push((part, checks));
    }
    let longest = blocks.iter().map(|(d, _)| d.len()).max().unwrap_or(0);
    let mut out = Vec::with_capacity(total_codewords(version));
    for i in 0..longest {
        out.extend(blocks.iter().filter_map(|(d, _)| d.get(i).copied()));
    }
    for i in 0..ec {
        out.extend(blocks.iter().map(|(_, c)| c[i]));
    }
    out
}

// ---- the grid

/// The modules of a code as they are placed, and which of them are the code's own pattern rather than data.
#[derive(Clone)]
pub struct Grid {
    pub size: usize,
    pub modules: Vec<Vec<bool>>,
    pub function: Vec<Vec<bool>>,
}

impl Grid {
    fn set(&mut self, x: usize, y: usize, dark: bool) {
        self.modules[y][x] = dark;
        self.function[y][x] = true;
    }

    fn finder(&mut self, cx: usize, cy: usize) {
        for dy in -4i32..=4 {
            for dx in -4i32..=4 {
                let (x, y) = (cx as i32 + dx, cy as i32 + dy);
                let distance = dx.abs().max(dy.abs());
                if (0..self.size as i32).contains(&x) && (0..self.size as i32).contains(&y) {
                    self.set(x as usize, y as usize, distance != 2 && distance != 4);
                }
            }
        }
    }

    fn alignment(&mut self, cx: usize, cy: usize) {
        for dy in -2i32..=2 {
            for dx in -2i32..=2 {
                self.set(
                    (cx as i32 + dx) as usize,
                    (cy as i32 + dy) as usize,
                    dx.abs().max(dy.abs()) != 1,
                );
            }
        }
    }

    /// The format information, twice, for a mask.
    fn format(&mut self, mask: u32) {
        let bits = format_bits(LEVEL_M, mask);
        let bit = |i: usize| (bits >> i) & 1 == 1;
        let size = self.size;
        for i in 0..=5 {
            self.set(8, i, bit(i));
        }
        self.set(8, 7, bit(6));
        self.set(8, 8, bit(7));
        self.set(7, 8, bit(8));
        for i in 9..15 {
            self.set(14 - i, 8, bit(i));
        }
        for i in 0..8 {
            self.set(size - 1 - i, 8, bit(i));
        }
        for i in 8..15 {
            self.set(8, size - 15 + i, bit(i));
        }
        // The one module that is always dark.
        self.set(8, size - 8, true);
    }

    fn version_info(&mut self, version: usize) {
        if version < 7 {
            return;
        }
        let bits = version_bits(version);
        for i in 0..18 {
            let bit = (bits >> i) & 1 == 1;
            let a = self.size - 11 + i % 3;
            let b = i / 3;
            self.set(a, b, bit);
            self.set(b, a, bit);
        }
    }
}

/// The 15 bits of format information: the level and the mask, their correction code, and the standard's mask over all.
pub fn format_bits(level: u32, mask: u32) -> u32 {
    let data = (level << 3) | mask;
    let mut rem = data;
    for _ in 0..10 {
        rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    }
    ((data << 10) | rem) ^ 0x5412
}

/// The 18 bits of version information, for versions 7 and up.
pub fn version_bits(version: usize) -> u32 {
    let v = version as u32;
    let mut rem = v;
    for _ in 0..12 {
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
    }
    (v << 12) | rem
}

/// The grid of a version with its patterns drawn and its data modules empty (the format is drawn for mask 0, to be drawn again).
pub fn patterns(version: usize) -> Grid {
    let size = size_of(version);
    let mut grid = Grid {
        size,
        modules: vec![vec![false; size]; size],
        function: vec![vec![false; size]; size],
    };
    for i in 0..size {
        grid.set(6, i, i % 2 == 0);
        grid.set(i, 6, i % 2 == 0);
    }
    grid.finder(3, 3);
    grid.finder(size - 4, 3);
    grid.finder(3, size - 4);
    let centres = ALIGNMENT[version - 1];
    let last = centres.len().saturating_sub(1);
    for (i, &cy) in centres.iter().enumerate() {
        for (j, &cx) in centres.iter().enumerate() {
            if (i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0) {
                continue;
            }
            grid.alignment(cx, cy);
        }
    }
    grid.format(0);
    grid.version_info(version);
    grid
}

/// Puts the codewords in the grid's free modules in the order of the standard: up and down the pairs of columns from the right.
fn place(grid: &mut Grid, data: &[u8]) {
    let size = grid.size;
    let mut at = 0usize;
    let mut right = size as i32 - 1;
    while right >= 1 {
        if right == 6 {
            right = 5;
        }
        for vert in 0..size {
            for j in 0..2 {
                let x = (right - j) as usize;
                let upward = ((right + 1) & 2) == 0;
                let y = if upward { size - 1 - vert } else { vert };
                if !grid.function[y][x] && at < data.len() * 8 {
                    grid.modules[y][x] = (data[at >> 3] >> (7 - (at & 7))) & 1 == 1;
                    at += 1;
                }
            }
        }
        right -= 2;
    }
}

/// Whether the mask turns the module at (x, y).
pub fn inverts(mask: u32, x: usize, y: usize) -> bool {
    match mask {
        0 => (x + y).is_multiple_of(2),
        1 => y.is_multiple_of(2),
        2 => x.is_multiple_of(3),
        3 => (x + y).is_multiple_of(3),
        4 => (x / 3 + y / 2).is_multiple_of(2),
        5 => (x * y) % 2 + (x * y) % 3 == 0,
        6 => ((x * y) % 2 + (x * y) % 3).is_multiple_of(2),
        _ => ((x + y) % 2 + (x * y) % 3).is_multiple_of(2),
    }
}

fn mask_data(grid: &mut Grid, mask: u32) {
    for y in 0..grid.size {
        for x in 0..grid.size {
            if !grid.function[y][x] && inverts(mask, x, y) {
                grid.modules[y][x] = !grid.modules[y][x];
            }
        }
    }
}

/// How badly a grid would scan, by the four rules of the standard: runs of one colour, blocks of one colour, patterns that look
/// like the finder patterns, and a balance of dark and light that is far from even.
pub fn penalty(modules: &[Vec<bool>]) -> u32 {
    let size = modules.len();
    let mut score = 0u32;
    let mut lines: Vec<Vec<bool>> = modules.to_vec();
    lines.extend((0..size).map(|x| (0..size).map(|y| modules[y][x]).collect::<Vec<bool>>()));
    // Runs of five or more of one colour, in a row or a column.
    for line in &lines {
        let mut run = 1;
        for i in 1..size {
            if line[i] == line[i - 1] {
                run += 1;
            } else {
                if run >= 5 {
                    score += 3 + (run as u32 - 5);
                }
                run = 1;
            }
        }
        if run >= 5 {
            score += 3 + (run as u32 - 5);
        }
    }
    // Blocks of two by two.
    for y in 0..size - 1 {
        for x in 0..size - 1 {
            let c = modules[y][x];
            if modules[y][x + 1] == c && modules[y + 1][x] == c && modules[y + 1][x + 1] == c {
                score += 3;
            }
        }
    }
    // The pattern of a finder (dark, light, three dark, light, dark) with four light modules at either end.
    const A: [bool; 11] = [
        true, false, true, true, true, false, true, false, false, false, false,
    ];
    const B: [bool; 11] = [
        false, false, false, false, true, false, true, true, true, false, true,
    ];
    for line in &lines {
        for start in 0..size.saturating_sub(10) {
            let window = &line[start..start + 11];
            if window == A || window == B {
                score += 40;
            }
        }
    }
    // Dark and light out of balance.
    let dark: usize = modules.iter().flatten().filter(|m| **m).count();
    let total = size * size;
    let off = (dark * 20).abs_diff(total * 10);
    score += (off.div_ceil(total).saturating_sub(1) as u32) * 10;
    score
}

/// The code for some text, at level M, in the smallest version that holds it; None for no text or more than 213 bytes.
pub fn encode(text: &str) -> Option<Code> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() > MOST_BYTES {
        return None;
    }
    let version = version_for(bytes.len())?;
    let data = codewords(&data_for(bytes, version), version);
    let mut best: Option<(u32, u32, Grid)> = None;
    for mask in 0..8 {
        let mut grid = patterns(version);
        place(&mut grid, &data);
        mask_data(&mut grid, mask);
        grid.format(mask);
        let score = penalty(&grid.modules);
        if best.as_ref().is_none_or(|(least, _, _)| score < *least) {
            best = Some((score, mask, grid));
        }
    }
    let (_, _, grid) = best?;
    Some(Code {
        version,
        size: grid.size,
        modules: grid.modules,
    })
}
