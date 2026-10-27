//! The browser's sandbox is on unless a person switches it off on purpose, and is never dropped because something
//! failed. These tests use a stand-in for the browser (a script that writes down how it was started and says what
//! Chromium says when it has no sandbox), so they need no real browser and cannot be fooled by one.

#![cfg(unix)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use slides_render::bundle::Page;
use slides_render::private::running_as_root;
use slides_render::{Error, Options, Renderer};

/// A folder of its own for one test.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "slides-render-sandbox-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    dir
}

/// A page that is a folder with an index, so that no built page is needed.
fn page(dir: &Path) -> Page {
    let folder = dir.join("page");
    fs::create_dir_all(&folder).unwrap_or_else(|e| panic!("{e}"));
    fs::write(folder.join("index.html"), "<html></html>").unwrap_or_else(|e| panic!("{e}"));
    Page::Folder(folder)
}

/// A "browser" that writes the arguments it was given on a line of `log`, says what Chromium says without a
/// sandbox, and stops.
#[cfg(unix)]
fn stand_in(dir: &Path, log: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let program = dir.join("fake-chromium");
    fs::write(
        &program,
        format!("#!/bin/sh\necho \"$@\" >> '{}'\necho 'FATAL:zygote_host_impl_linux.cc: No usable sandbox! Update your kernel' >&2\nexit 1\n", log.display()),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755))
        .unwrap_or_else(|e| panic!("{e}"));
    program
}

fn launches(log: &Path) -> Vec<String> {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn launch_error(result: Result<Renderer, Error>) -> String {
    match result {
        Err(Error::Launch(message)) => message,
        Err(other) => panic!("wrong kind of error: {other:?}"),
        Ok(_) => panic!("it should not have started"),
    }
}

/// Whether the setting is in this test's environment, which changes what the tests can show.
fn variable_is_set() -> bool {
    std::env::var_os("SLIDES_RENDER_NO_SANDBOX").is_some()
}

#[cfg(unix)]
#[test]
fn a_program_that_switches_the_sandbox_off_says_so_and_the_browser_gets_the_flag() {
    let dir = scratch("off");
    let log = dir.join("launches.log");
    let options = Options {
        browser: Some(stand_in(&dir, &log)),
        page: Some(page(&dir)),
        profiles: Some(dir.join("profiles")),
        no_sandbox: Some(true),
        ..Options::default()
    };
    let said = launch_error(Renderer::launch_with(options));
    let started = launches(&log);
    assert_eq!(started.len(), 1, "started once, not again: {started:?}");
    assert!(started[0].contains("--no-sandbox"), "{}", started[0]);
    // A browser that stops at once can be gone before its words are read (launch.rs says so): then
    // nothing follows "It said:". Either way the answer is the plain one, with no advice about the sandbox.
    assert!(
        said.contains("No usable sandbox!") || said.contains("It said:"),
        "with the sandbox off the browser's words are just what it said: {said}"
    );
    assert!(
        !said.contains("does not run the browser without its sandbox"),
        "{said}"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_browser_whose_sandbox_will_not_start_is_not_started_again_without_one() {
    if running_as_root() {
        eprintln!(
            "SKIPPED: as the administrator the sandbox is refused before any browser is started (see the next test)"
        );
        return;
    }
    let dir = scratch("failing");
    let log = dir.join("launches.log");
    let options = Options {
        browser: Some(stand_in(&dir, &log)),
        page: Some(page(&dir)),
        profiles: Some(dir.join("profiles")),
        no_sandbox: Some(false),
        ..Options::default()
    };
    let said = launch_error(Renderer::launch_with(options));
    let started = launches(&log);
    assert_eq!(
        started.len(),
        1,
        "no second try without the sandbox: {started:?}"
    );
    assert!(!started[0].contains("--no-sandbox"), "{}", started[0]);
    for wanted in [
        "sandbox could not start",
        "SLIDES_RENDER_NO_SANDBOX=1",
        "does not run the browser without its sandbox",
    ] {
        assert!(said.contains(wanted), "{wanted} in {said}");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn as_the_administrator_nothing_is_started_and_the_message_names_the_setting() {
    if !running_as_root() {
        eprintln!(
            "SKIPPED: this test needs to run as the administrator (a container as root is the usual case)"
        );
        return;
    }
    if variable_is_set() {
        eprintln!("SKIPPED: SLIDES_RENDER_NO_SANDBOX is set in this environment");
        return;
    }
    let dir = scratch("root");
    let log = dir.join("launches.log");
    let options = Options {
        browser: Some(stand_in(&dir, &log)),
        page: Some(page(&dir)),
        profiles: Some(dir.join("profiles")),
        ..Options::default()
    };
    let said = launch_error(Renderer::launch_with(options));
    for wanted in [
        "administrator",
        "SLIDES_RENDER_NO_SANDBOX=1",
        "ordinary user",
        "does not switch it off for you",
    ] {
        assert!(said.contains(wanted), "{wanted} in {said}");
    }
    assert!(launches(&log).is_empty(), "no browser was started");
    // A program that insists on the sandbox is refused the same way, whatever the setting.
    let options = Options {
        browser: Some(stand_in(&dir, &log)),
        page: Some(page(&dir)),
        profiles: Some(dir.join("profiles")),
        no_sandbox: Some(false),
        ..Options::default()
    };
    assert!(launch_error(Renderer::launch_with(options)).contains("administrator"));
    assert!(launches(&log).is_empty());
    let _ = fs::remove_dir_all(&dir);
}
