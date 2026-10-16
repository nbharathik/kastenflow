//! The place the previews are drawn in is private, and LibreOffice's input and output are never written through
//! a link or taken from an earlier import. LibreOffice itself is replaced by a small script.

#![cfg(unix)]

use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

fn scratch(name: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "slides-previews-{name}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
    dir
}

/// A folder as `workplace_in` would lend it.
fn private_folder(name: &str) -> PathBuf {
    let dir = scratch(name).join("work");
    private::ensure_private(&dir).unwrap_or_else(|e| panic!("{e}"));
    dir
}

#[cfg(unix)]
mod unix {
    use std::os::unix::fs::{MetadataExt, PermissionsExt, chown, symlink};

    use super::*;

    /// A stand-in for LibreOffice: `body` runs with `$IN` (the file to convert) and `$OUT` (the folder for the result).
    fn office(dir: &Path, body: &str) -> String {
        let program = dir.join("fake-office");
        let script = format!(
            "#!/bin/sh\nIN=''\nOUT=''\nwhile [ $# -gt 0 ]; do\n  case \"$1\" in\n    --outdir) OUT=\"$2\"; shift ;;\n    -*) ;;\n    *) IN=\"$1\" ;;\n  esac\n  shift\ndone\n{body}\n"
        );
        fs::write(&program, script).unwrap_or_else(|e| panic!("{e}"));
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755))
            .unwrap_or_else(|e| panic!("{e}"));
        program.display().to_string()
    }

    fn mode(path: &Path) -> u32 {
        fs::symlink_metadata(path)
            .unwrap_or_else(|e| panic!("{e}"))
            .mode()
            & 0o777
    }

    /// The folder lent out next under `base`, asked for until it is `dir` or five seconds pass. A program another test
    /// starts holds a copy of every open file until it runs, and a lock goes only with its last copy, so a folder just
    /// given back can look taken for a moment.
    fn lent_again(base: &Path, dir: &Path) -> Option<PathBuf> {
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            // Each folder lent here is given back at once, so a wrong one is not kept from the next try.
            let lent = workplace_in(&[base.to_path_buf()])
                .map(|s| s.dir.clone())
                .ok();
            if lent.as_deref() == Some(dir) || Instant::now() > until {
                return lent;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_conversion_that_makes_a_pdf_gives_its_path_and_the_input_is_kept_private() {
        let dir = private_folder("ok");
        let office = office(&dir, "cp \"$IN\" \"$OUT/import.pdf\"");
        let pdf = draw_pdf(&office, &dir, b"the pptx bytes").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(pdf, dir.join("import.pdf"));
        assert_eq!(fs::read(&pdf).unwrap_or_default(), b"the pptx bytes");
        assert_eq!(mode(&dir.join("import.pptx")), 0o600);
        // Once more, with other bytes and a shorter file: nothing of the first is left.
        let again = draw_pdf(&office, &dir, b"two").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(fs::read(again).unwrap_or_default(), b"two");
    }

    #[test]
    fn the_file_to_convert_is_not_written_through_a_link_someone_planted() {
        let dir = private_folder("link-in");
        let victim = scratch("victim").join("precious.txt");
        fs::write(&victim, "keep me").unwrap_or_else(|e| panic!("{e}"));
        symlink(&victim, dir.join("import.pptx")).unwrap_or_else(|e| panic!("{e}"));
        let office = office(&dir, "true");
        let said = draw_pdf(&office, &dir, b"attacker chosen bytes")
            .err()
            .unwrap_or_default();
        assert!(
            said.contains("link") && said.contains("import.pptx"),
            "{said}"
        );
        assert_eq!(fs::read_to_string(&victim).unwrap_or_default(), "keep me");
    }

    #[test]
    fn the_pdf_is_not_written_through_a_link_either() {
        let dir = private_folder("link-out");
        let victim = scratch("victim2").join("precious.txt");
        fs::write(&victim, "keep me").unwrap_or_else(|e| panic!("{e}"));
        symlink(&victim, dir.join("import.pdf")).unwrap_or_else(|e| panic!("{e}"));
        let office = office(&dir, "cp \"$IN\" \"$OUT/import.pdf\"");
        let said = draw_pdf(&office, &dir, b"x").err().unwrap_or_default();
        assert!(
            said.contains("link") && said.contains("import.pdf"),
            "{said}"
        );
        assert_eq!(fs::read_to_string(&victim).unwrap_or_default(), "keep me");
    }

    #[test]
    fn a_pdf_of_an_earlier_import_is_not_taken_for_this_ones() {
        let dir = private_folder("stale");
        fs::write(dir.join("import.pdf"), "%PDF-1.4 of another deck")
            .unwrap_or_else(|e| panic!("{e}"));
        let office = office(&dir, "true");
        let said = draw_pdf(&office, &dir, b"x").err().unwrap_or_default();
        assert!(said.contains("made no PDF"), "{said}");
        assert_eq!(
            fs::metadata(dir.join("import.pdf"))
                .map(|m| m.len())
                .unwrap_or(9),
            0
        );
    }

    #[test]
    fn a_program_that_cannot_be_started_or_stops_badly_is_told_of() {
        let dir = private_folder("bad");
        let said = draw_pdf("/no/such/office", &dir, b"x")
            .err()
            .unwrap_or_default();
        assert!(said.contains("cannot start /no/such/office"), "{said}");
        let office = office(&dir, "exit 3");
        let said = draw_pdf(&office, &dir, b"x").err().unwrap_or_default();
        assert!(said.contains("stopped with"), "{said}");
    }

    #[test]
    fn the_folder_to_work_in_is_closed_to_other_users() {
        let base = scratch("base").join("places");
        let slot = workplace_in(std::slice::from_ref(&base)).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(mode(&base), 0o700);
        assert_eq!(mode(&slot.dir), 0o700);
        assert!(slot.dir.starts_with(&base));
        // A second import at the same time works in another folder; when the first is done its folder comes back.
        let second = workplace_in(std::slice::from_ref(&base)).unwrap_or_else(|e| panic!("{e}"));
        assert_ne!(second.dir, slot.dir);
        let first = slot.dir.clone();
        drop(slot);
        assert_eq!(lent_again(&base, &first), Some(first));
    }

    #[test]
    fn a_folder_someone_else_planted_or_left_open_or_made_a_link_is_not_used() {
        // Open to other users.
        let open = scratch("open").join("places");
        fs::create_dir_all(&open).unwrap_or_else(|e| panic!("{e}"));
        fs::set_permissions(&open, fs::Permissions::from_mode(0o777))
            .unwrap_or_else(|e| panic!("{e}"));
        let said = workplace_in(std::slice::from_ref(&open))
            .err()
            .unwrap_or_default();
        assert!(
            said.contains("can be entered by other users") && said.contains("no private folder"),
            "{said}"
        );
        assert!(!open.join("slot-0.lock").exists(), "nothing was made in it");
        // A link to somebody's folder.
        let victim = scratch("victim-dir");
        let link = scratch("link").join("places");
        symlink(&victim, &link).unwrap_or_else(|e| panic!("{e}"));
        let said = workplace_in(std::slice::from_ref(&link))
            .err()
            .unwrap_or_default();
        assert!(said.contains("link or a file"), "{said}");
        assert_eq!(fs::read_dir(&victim).map(Iterator::count).unwrap_or(9), 0);
        // Another user's.
        if private::current_uid() == Some(0) {
            let theirs = scratch("theirs").join("places");
            private::ensure_private(&theirs).unwrap_or_else(|e| panic!("{e}"));
            chown(&theirs, Some(4242), None).unwrap_or_else(|e| panic!("{e}"));
            let said = workplace_in(std::slice::from_ref(&theirs))
                .err()
                .unwrap_or_default();
            assert!(said.contains("belongs to another user"), "{said}");
        }
        // The next place is used when the first is no good.
        let good = scratch("good").join("places");
        let slot = workplace_in(&[open, good.clone()]).unwrap_or_else(|e| panic!("{e}"));
        assert!(slot.dir.starts_with(&good));
    }
}
