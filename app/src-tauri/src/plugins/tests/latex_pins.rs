//! The Tectonic pins: four kinds of computer, none offered for download
//! until their checksums are real, and a release build that refuses to ship
//! with a placeholder.

use crate::plugins::pins::{current, declared, for_target, source};
use crate::plugins::{catalog, find};

const TARGETS: [&str; 4] = [
    "x86_64-windows",
    "x86_64-linux",
    "aarch64-macos",
    "x86_64-macos",
];

#[test]
fn tectonic_is_declared_for_the_four_kinds_of_computer() {
    let (version, pins) = declared("latex").expect("latex declares a payload");
    assert_eq!(version, "0.15.0");
    let names: Vec<&str> = pins.iter().map(|(t, _)| *t).collect();
    assert_eq!(names, TARGETS);
    for (target, pin) in pins {
        assert!(
            pin.url
                .starts_with("https://github.com/tectonic-typesetting/tectonic/releases/download/"),
            "{target}: {}",
            pin.url
        );
        assert!(pin.url.contains(version), "{target}: {}", pin.url);
        let ext = if target.ends_with("windows") {
            ".zip"
        } else {
            ".tar.gz"
        };
        assert!(pin.url.ends_with(ext), "{target}: {}", pin.url);
    }
}

#[test]
fn every_pinned_address_is_one_a_download_may_come_from() {
    // `download` checks only redirects against `release_host`, so the pins themselves must pass it.
    for id in ["latex", "diagrams"] {
        let (_, pins) = declared(id).unwrap_or_else(|| panic!("{id} declares a payload"));
        for (target, pin) in pins {
            let url = reqwest::Url::parse(pin.url).unwrap_or_else(|e| panic!("{id} {target}: {e}"));
            assert!(
                crate::plugins::payload::release_host(&url),
                "{id} {target}: {}",
                pin.url
            );
        }
    }
}

#[test]
fn a_pin_still_to_be_supplied_is_never_offered_for_download() {
    let (_, pins) = declared("latex").unwrap();
    for (target, pin) in pins {
        if pin.is_real() {
            continue;
        }
        // The placeholder is not a pin: nothing to download, no size shown, no install.
        assert!(for_target("latex", target).is_none(), "{target}");
    }
    if pins.iter().any(|(_, pin)| !pin.is_real()) {
        assert!(current("latex").is_none());
        assert!(source("latex").is_none());
        assert!(find("latex").unwrap().payload.is_none());
        assert!(
            catalog()
                .iter()
                .all(|p| p.id != "latex" || p.payload.is_none())
        );
    }
}

#[test]
fn a_real_looking_pin_is_recognised_only_when_whole() {
    use crate::plugins::pins::Pin;
    let real = Pin {
        url: "https://github.com/x",
        sha256: "32b9aa48b9b4dfb8b70b8c3a47bc2ee4265ae462bbce1b53492d30ef79916c5d",
        size: 1,
    };
    assert!(real.is_real());
    assert!(!Pin { size: 0, ..real }.is_real());
    assert!(
        !Pin {
            sha256: "TODO_PIN",
            ..real
        }
        .is_real()
    );
    assert!(
        !Pin {
            sha256: "zz9aa48b9b4dfb8b70b8c3a47bc2ee4265ae462bbce1b53492d30ef79916c5d",
            ..real
        }
        .is_real()
    );
    assert!(
        !Pin {
            sha256: "32b9aa",
            ..real
        }
        .is_real()
    );
}

/// Run by `cargo test --release` before a release: every Tectonic pin must be
/// real. A debug run skips it, so the placeholders do not stop development.
#[test]
fn latex_pins_are_real_in_release_builds() {
    if cfg!(debug_assertions) {
        return;
    }
    let (_, pins) = declared("latex").unwrap();
    let missing: Vec<&str> = pins
        .iter()
        .filter(|(_, pin)| !pin.is_real())
        .map(|(target, _)| *target)
        .collect();
    assert!(
        missing.is_empty(),
        "Tectonic's checksum and size are still TODO_PIN for: {missing:?} (see plugins/latex/pinned.rs)"
    );
}
