use std::ffi::OsStr;
use std::sync::atomic::AtomicBool;

use super::*;

fn decide(
    explicit: Option<bool>,
    variable: Option<&str>,
    root: bool,
) -> std::result::Result<Sandbox, String> {
    sandbox_for(explicit, variable.map(OsStr::new), root)
}

#[test]
fn the_sandbox_stays_on_unless_it_is_switched_off_on_purpose() {
    assert_eq!(decide(None, None, false), Ok(Sandbox::On));
    // Only the value 1 switches it off.
    for other in ["0", "", "true", "yes", "on", "2", " 1", "1 "] {
        assert_eq!(
            decide(None, Some(other), false),
            Ok(Sandbox::On),
            "{other:?}"
        );
    }
    assert_eq!(decide(None, Some("1"), false), Ok(Sandbox::Off));
    // A program that says so itself does not need the variable, and the variable cannot override its saying no.
    assert_eq!(decide(Some(true), None, false), Ok(Sandbox::Off));
    assert_eq!(decide(Some(false), Some("1"), false), Ok(Sandbox::On));
}

#[test]
fn as_the_administrator_the_sandbox_is_not_switched_off_for_the_person() {
    let said = decide(None, None, true).err().unwrap_or_default();
    for wanted in [
        "administrator",
        "sandbox",
        "SLIDES_RENDER_NO_SANDBOX=1",
        "ordinary user",
        "hostile",
    ] {
        assert!(said.contains(wanted), "{wanted} in: {said}");
    }
    assert_eq!(
        decide(None, Some("0"), true).err().as_deref(),
        Some(said.as_str()),
        "a variable that is not 1 does not help"
    );
    assert_eq!(
        decide(Some(false), Some("1"), true).err().as_deref(),
        Some(said.as_str())
    );
    assert_eq!(decide(None, Some("1"), true), Ok(Sandbox::Off));
    assert_eq!(decide(Some(true), None, true), Ok(Sandbox::Off));
}

#[test]
fn a_browser_whose_sandbox_would_not_start_is_told_of_in_words_that_name_the_setting() {
    for stderr in [
        "[1:1:0929/000000.000000:FATAL:zygote_host_impl_linux.cc(132)] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md.",
        "Running as root without --no-sandbox is not supported. See https://crbug.com/638180.",
        "FATAL:sandbox_linux.cc: Check failed: setuid sandbox",
    ] {
        let Error::Launch(said) = launch_failure(true, "exit status: 1", stderr.as_bytes()) else {
            panic!("a launch error");
        };
        assert!(
            said.contains("sandbox could not start") && said.contains("SLIDES_RENDER_NO_SANDBOX=1"),
            "{said}"
        );
        assert!(
            said.contains("does not run the browser without its sandbox"),
            "{said}"
        );
    }
}

#[test]
fn a_browser_that_stops_without_a_word_with_its_sandbox_on_is_pointed_to_the_setting() {
    // A browser that stops at once can be gone before what it wrote is read. With the sandbox on, that is the likely
    // reason, so the setting is named; it is still never used for the person.
    for silent in [
        &b""[..],
        b"\n  \n",
        b"ERROR:dbus/bus.cc:408] Failed to connect to the bus",
    ] {
        let Error::Launch(said) = launch_failure(true, "exit status: 1", silent) else {
            panic!("a launch error");
        };
        for wanted in [
            "exit status: 1",
            "sandbox could not start",
            "SLIDES_RENDER_NO_SANDBOX=1",
            "does not run the browser without its sandbox",
        ] {
            assert!(said.contains(wanted), "{wanted} in: {said}");
        }
    }
    // With the sandbox already off, a silent stop is only a stop.
    let Error::Launch(said) = launch_failure(false, "exit status: 1", b"") else {
        panic!("a launch error");
    };
    assert!(!said.contains("SLIDES_RENDER_NO_SANDBOX"), "{said}");
}

#[test]
fn other_failures_are_told_as_they_are_and_never_blamed_on_the_sandbox() {
    let Error::Launch(said) = launch_failure(
        true,
        "exit status: 127",
        b"error while loading shared libraries: libnss3.so: cannot open shared object file",
    ) else {
        panic!("a launch error");
    };
    assert!(
        said.contains("libnss3.so") && !said.contains("SLIDES_RENDER_NO_SANDBOX"),
        "{said}"
    );
    // With the sandbox already off, a sandbox complaint is just what the browser said.
    let Error::Launch(said) = launch_failure(false, "exit status: 1", b"No usable sandbox!") else {
        panic!("a launch error");
    };
    assert!(
        said.contains("No usable sandbox!") && !said.contains("does not run the browser"),
        "{said}"
    );
}

#[test]
fn the_warning_about_no_sandbox_is_said_once_however_often_it_is_asked() {
    let flag = AtomicBool::new(false);
    let mut lines: Vec<String> = Vec::new();
    for _ in 0..5 {
        say_once(&flag, |line| lines.push(line.to_owned()));
    }
    assert_eq!(lines.len(), 1);
    assert!(
        lines[0].starts_with("warning: SLIDES_RENDER_NO_SANDBOX"),
        "{}",
        lines[0]
    );
    assert!(
        lines[0].contains("without its sandbox") && !lines[0].contains('\n'),
        "{}",
        lines[0]
    );
}

#[test]
fn what_a_browser_said_is_boiled_down_to_its_last_lines() {
    let noisy = "ERROR:dbus/bus.cc:408] Failed to connect to the bus\nline one\n\nline two\nline three\nline four\nERROR: DBus again";
    assert_eq!(said(noisy.as_bytes()), "line two / line three / line four");
    assert_eq!(said(b""), "");
}
