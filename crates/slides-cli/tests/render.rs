//! `slides render` and the drawn exports, end to end: through the binary, as a person or an agent's shell would.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/decks")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("slides-render-cli-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    dir
}

/// `slides ...` on a machine with a browser, if this one has one (and the page is built in). Chromium will not run
/// its sandbox as the administrator, so where these tests do (a container) they switch it off themselves, as the
/// message to a person says to; anywhere else the browser is started in its sandbox.
fn slides(args: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_slides"));
    command.args(args);
    if slides_render::private::running_as_root() {
        command.env("SLIDES_RENDER_NO_SANDBOX", "1");
    }
    command
        .output()
        .unwrap_or_else(|e| panic!("the slides binary runs: {e}"))
}

/// `slides ...` on a machine with no browser at all: nothing named, nothing on PATH, nowhere to look.
fn slides_without_a_browser(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_slides"))
        .args(args)
        .env_clear()
        .env("PATH", "")
        .env("HOME", "/nonexistent")
        .env("PLAYWRIGHT_BROWSERS_PATH", "/nonexistent")
        .env("CHROMIUM_PATH", "/nonexistent/chromium")
        .stdin(Stdio::null())
        .output()
        .unwrap_or_else(|e| panic!("the slides binary runs: {e}"))
}

/// Whether this build carries the page slides are drawn with. A release always does; a test build only once the page
/// was built (CI's Rust job does not build it). Without it, drawing says so before any browser is looked for.
fn has_page() -> bool {
    slides_render::bundle::Page::locate().is_some()
}

fn has_browser() -> bool {
    match (
        slides_render::find_browser(),
        slides_render::bundle::Page::locate(),
    ) {
        (Ok(_), Some(_)) => true,
        (browser, page) => {
            eprintln!(
                "SKIPPED: no browser ({}) or no page ({})",
                browser.err().map(|e| e.to_string()).unwrap_or_default(),
                page.is_none()
            );
            false
        }
    }
}

/// The width and height in a PNG's header.
fn png_size(path: &Path) -> (u32, u32) {
    let bytes = fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert!(
        bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "{} is not a PNG",
        path.display()
    );
    let be =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    (be(16), be(20))
}

fn deck(name: &str) -> String {
    fixtures().join(name).display().to_string()
}

#[test]
fn without_a_browser_drawing_says_what_is_needed_and_nothing_else_changes() {
    let dir = temp("nobrowser");
    let png = dir.join("out.png");
    for args in [
        vec![
            "render",
            &deck("minimal.deck"),
            "-o",
            png.to_str().unwrap_or_default(),
        ],
        vec![
            "render",
            &deck("minimal.deck"),
            "--grid",
            "-o",
            png.to_str().unwrap_or_default(),
        ],
        vec![
            "export",
            &deck("minimal.deck"),
            "-o",
            dir.join("out.pdf").to_str().unwrap_or_default(),
        ],
        vec![
            "export",
            &deck("minimal.deck"),
            "-o",
            dir.join("out.html").to_str().unwrap_or_default(),
        ],
    ] {
        let out = slides_without_a_browser(&args);
        assert_eq!(
            out.status.code(),
            Some(1),
            "{args:?}: {}",
            text(&out.stderr)
        );
        let message = text(&out.stderr);
        if !has_page() {
            assert!(message.contains("does not carry the page"), "{message}");
            continue;
        }
        assert!(
            message.contains("needs Chrome or Chromium") && message.contains("CHROMIUM_PATH"),
            "{message}"
        );
        assert!(
            message.contains("/nonexistent/chromium"),
            "the setting that names nothing is told of: {message}"
        );
    }
    assert!(!png.exists(), "nothing was written");
    // PowerPoint needs no browser.
    let pptx = dir.join("out.pptx");
    let out = slides_without_a_browser(&[
        "export",
        &deck("minimal.deck"),
        "-o",
        pptx.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(pptx.exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn lint_without_a_browser_estimates_the_text_and_says_so() {
    let out = slides_without_a_browser(&["lint", &deck("text-heavy.deck"), "--json"]);
    let json: serde_json::Value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|e| panic!("{e}: {}", text(&out.stdout)));
    assert_eq!(json["measuredWith"], "estimate");
    let note = json["note"].as_str().unwrap_or_default();
    let why = if has_page() {
        "Chrome or Chromium"
    } else {
        "does not carry the page"
    };
    assert!(note.contains("estimated") && note.contains(why), "{note}");
    let plain = slides_without_a_browser(&["lint", &deck("text-heavy.deck")]);
    assert!(
        text(&plain.stderr).contains("note: Text sizes were estimated"),
        "{}",
        text(&plain.stderr)
    );
    let asked = slides(&["lint", &deck("text-heavy.deck"), "--json", "--estimate"]);
    let json: serde_json::Value =
        serde_json::from_slice(&asked.stdout).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(json["measuredWith"], "estimate");
    assert!(
        json["note"].is_null(),
        "asking for the estimate needs no excuse"
    );
}

#[test]
fn the_arguments_are_checked_before_a_browser_is_started() {
    for (args, wanted) in [
        (
            vec!["render", "x.deck", "--slide", "0"],
            "--slide is the slide's number",
        ),
        (
            vec!["render", "x.deck", "--scale", "9"],
            "--scale is the pixels",
        ),
        (
            vec!["render", "x.deck", "--grid", "--columns", "0"],
            "--columns is the number of columns",
        ),
        (
            vec!["export", "x.deck", "-o", "x.docx"],
            "pptx, pdf, png and html",
        ),
        (vec!["render"], "missing the deck to render"),
    ] {
        let out = slides_without_a_browser(&args);
        assert_eq!(
            out.status.code(),
            Some(2),
            "{args:?}: {}",
            text(&out.stderr)
        );
        assert!(
            text(&out.stderr).contains(wanted),
            "{args:?}: {}",
            text(&out.stderr)
        );
    }
}

#[test]
fn a_slide_and_the_grid_come_out_as_pictures() {
    if !has_browser() {
        return;
    }
    let dir = temp("render");
    let one = dir.join("one.png");
    let out = slides(&[
        "render",
        &deck("composites.deck"),
        "--slide",
        "4",
        "--step",
        "2",
        "--scale",
        "1",
        "-o",
        one.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(
        text(&out.stdout).contains("960 x 540 pixels"),
        "{}",
        text(&out.stdout)
    );
    assert_eq!(png_size(&one), (960, 540));
    let twice = dir.join("two.png");
    let out = slides(&[
        "render",
        &deck("composites.deck"),
        "--slide",
        "1",
        "--scale",
        "2",
        "-o",
        twice.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(png_size(&twice), (1920, 1080));
    let grid = dir.join("grid.png");
    let out = slides(&[
        "render",
        &deck("composites.deck"),
        "--grid",
        "--columns",
        "3",
        "-o",
        grid.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(png_size(&grid).0, 1600);
    // Slides that do not exist, and steps that do not, are said in words.
    let out = slides(&[
        "render",
        &deck("composites.deck"),
        "--slide",
        "99",
        "-o",
        dir.join("no.png").to_str().unwrap_or_default(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).contains("There is no slide 99: the deck has 12."),
        "{}",
        text(&out.stderr)
    );
    let out = slides(&[
        "render",
        &deck("composites.deck"),
        "--slide",
        "4",
        "--step",
        "9",
        "-o",
        dir.join("no.png").to_str().unwrap_or_default(),
    ]);
    assert!(
        text(&out.stderr).contains("steps 0 to 4"),
        "{}",
        text(&out.stderr)
    );
    assert!(!dir.join("no.png").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_deck_is_exported_as_a_pdf_pictures_and_a_web_page() {
    if !has_browser() {
        return;
    }
    let dir = temp("export");
    let pdf = dir.join("talk.pdf");
    let out = slides(&[
        "export",
        &deck("composites.deck"),
        "-o",
        pdf.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(
        text(&out.stdout).contains("12 pages"),
        "{}",
        text(&out.stdout)
    );
    assert!(fs::read(&pdf).unwrap_or_default().starts_with(b"%PDF-"));
    let by_flag = slides(&[
        "export",
        &deck("four-three.deck"),
        "--format",
        "pdf",
        "--notes",
        "-o",
        dir.join("handout.pdf").to_str().unwrap_or_default(),
    ]);
    assert!(by_flag.status.success(), "{}", text(&by_flag.stderr));
    assert!(
        text(&by_flag.stdout).contains("2 pages"),
        "{}",
        text(&by_flag.stdout)
    );

    let html = dir.join("talk.html");
    let out = slides(&[
        "export",
        &deck("composites.deck"),
        "-o",
        html.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(
        fs::read_to_string(&html)
            .unwrap_or_default()
            .starts_with("<!doctype html>")
    );

    let pictures = dir.join("pictures.png");
    let out = slides(&[
        "export",
        &deck("four-three.deck"),
        "--scale",
        "1",
        "-o",
        pictures.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(png_size(&dir.join("pictures-01.png")), (720, 540));
    assert_eq!(png_size(&dir.join("pictures-02.png")), (720, 540));
    assert!(!pictures.exists(), "several pictures are several files");
    let single = dir.join("single.png");
    let out = slides(&[
        "export",
        &deck("composites.deck"),
        "--slide",
        "5",
        "--scale",
        "1",
        "-o",
        single.to_str().unwrap_or_default(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(png_size(&single), (960, 540));
    let _ = fs::remove_dir_all(&dir);
}
