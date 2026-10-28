//! What the worked example needs made by hand: the chart's PNG (the client
//! makes it; Kasten runs no program), the diagram's PNG (the window draws it),
//! the built PDF (the TeX engine makes it) and the paper's text.

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut body = kind.to_vec();
    body.extend_from_slice(data);
    let mut out = (data.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
    out
}

/// A real, small PNG (8-bit RGB, stored zlib blocks), each pixel from `pixel(x, y)`.
pub fn png(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let mut raw = Vec::new();
    for y in 0..height {
        raw.push(0); // filter: none
        for x in 0..width {
            raw.extend_from_slice(&pixel(x, y));
        }
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (n, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(n + 1 == blocks.len()));
        zlib.extend_from_slice(&(block.len() as u16).to_le_bytes());
        zlib.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut header = width.to_be_bytes().to_vec();
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    out.extend(chunk(b"IHDR", &header));
    out.extend(chunk(b"IDAT", &zlib));
    out.extend(chunk(b"IEND", &[]));
    out
}

/// The chart a client made with its own plotting program: four bars.
pub fn chart() -> Vec<u8> {
    png(120, 80, |x, y| {
        let bar = (x / 30) as usize;
        let height = [30, 52, 41, 66][bar.min(3)];
        if x % 30 > 4 && y >= 80 - height {
            [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40]][bar.min(3)]
        } else {
            [255, 255, 255]
        }
    })
}

/// What the window draws for the diagram: a small grey picture.
pub fn drawn_diagram() -> Vec<u8> {
    png(48, 32, |x, y| {
        if x < 2 || y < 2 || x >= 46 || y >= 30 {
            [60, 60, 60]
        } else {
            [235, 240, 250]
        }
    })
}

/// A valid two-page PDF with a correct cross-reference table.
pub fn pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (n, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend(format!("{} 0 obj\n{body}\nendobj\n", n + 1).bytes());
    }
    let table = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        out.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    let tail = format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{table}\n%%EOF\n",
        objects.len() + 1
    );
    out.extend(tail.bytes());
    out
}

const PARAGRAPHS: [&str; 4] = [
    "A notes vault is a quiet place to think. Each card keeps one idea in plain words, and links join the cards that belong together. When an outside assistant is allowed to work in the vault it should follow the same habits as a careful person: read before it writes, say why it changes something, and leave every change where it can be taken back with one step.",
    "We asked an assistant to write a short paper from the notes it found. It made a document, wrote the text in sections, drew one figure, plotted one chart with its own tools, cited two works from the References and asked the app to build the result. The person watched the changes arrive as one piece of work and decided what to keep.",
    "The numbers in this paper are small on purpose. The point is the way the work was done: every step went through the same guarded operations the editor uses, no step ran a program inside the vault, and nothing was deleted. A reader can follow the history from the first line of the document to the last page of the PDF.",
    "Careful readers will ask what would have happened with a stricter setting. In the review setting each step waits for a person; in the balanced setting ordinary writes go through while larger removals wait; in the autonomous setting a checkpoint is kept first. The work below was done in the balanced setting, so a new Reference waited for its owner.",
];

fn paragraphs(first: usize, count: usize) -> String {
    (first..first + count)
        .map(|n| format!("{}\n", PARAGRAPHS[n % PARAGRAPHS.len()]))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The first sentence of the introduction, which `latex_cite` anchors on.
pub const ATTENTION: &str = "Attention based models changed how long sequences are read.";
/// A sentence of the related work, anchoring the second citation.
pub const SOURCES: &str = "Agents that write papers need sources they can trust.";

/// The whole root file: about two pages of text and the places the figures,
/// the conclusion and the bibliography go.
pub fn paper() -> String {
    format!(
        "\\documentclass[11pt]{{article}}\n\\usepackage[utf8]{{inputenc}}\n\\usepackage{{graphicx}}\n\\title{{A short paper}}\n\\author{{A client of the vault}}\n\\date{{}}\n\n\\begin{{document}}\n\\maketitle\n\n\
\\section{{Introduction}}\n{ATTENTION}\n\n{}\n\
\\section{{Method}}\n{}\n% figure: flow\n\n\
\\section{{Results}}\n{}\n% figure: chart\n\n\
\\section{{Related work}}\n{SOURCES}\n\n{}\n\
% conclusion\n\n\\bibliographystyle{{plain}}\n\\bibliography{{references}}\n\n\\end{{document}}\n",
        paragraphs(0, 3),
        paragraphs(1, 3),
        paragraphs(2, 3),
        paragraphs(3, 2),
    )
}
