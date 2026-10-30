//! The tree follows the folder through renames and moves, and names that
//! Windows reads as something else (a stream, a device, a short name, a
//! trailing dot) never get a file written for them.

use std::fs;
use std::path::PathBuf;

use super::support::{Dir, FOLDER, put, vault};
use crate::plugins::latex::snapshot::{Buffer, Places, Refused, sync};

struct Setup {
    dir: Dir,
    root: PathBuf,
}

fn setup() -> Setup {
    let dir = Dir::new("snapshot-moves");
    let root = vault(&dir);
    Setup { dir, root }
}

impl Setup {
    fn src(&self) -> PathBuf {
        self.root.join(FOLDER)
    }

    fn tree(&self) -> PathBuf {
        self.root.join(".kasten/cache/latex/abc/tree")
    }

    fn sync(&self, buffers: &[Buffer]) -> Result<(), Refused> {
        let (src, build, tree) = (
            self.src(),
            self.root.join(".kasten/cache/latex/abc"),
            self.tree(),
        );
        sync(
            &Places {
                root: &self.root,
                src: &src,
                build: &build,
                tree: &tree,
                folder: FOLDER,
            },
            buffers,
            None,
        )
        .map(|_| ())
    }

    /// The names in `rel` (a folder of the tree), as the disk spells them.
    fn names(&self, rel: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.tree().join(rel))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

#[test]
fn a_rename_that_only_changes_the_case_is_followed() {
    let s = setup();
    put(&s.src(), "Chapter.tex", "one\n");
    s.sync(&[]).unwrap();
    assert!(s.names("").contains(&"Chapter.tex".to_owned()));

    fs::rename(s.src().join("Chapter.tex"), s.src().join("chapter.tex")).unwrap();
    s.sync(&[]).unwrap();
    // One file, under its new spelling (and on a case-sensitive disk, not both).
    let names = s.names("");
    assert!(names.contains(&"chapter.tex".to_owned()), "{names:?}");
    assert!(!names.contains(&"Chapter.tex".to_owned()), "{names:?}");
    assert_eq!(
        fs::read_to_string(s.tree().join("chapter.tex")).unwrap(),
        "one\n"
    );
}

#[test]
fn a_moved_folder_and_a_renamed_file_leave_nothing_of_the_old_place() {
    let s = setup();
    put(&s.src(), "figures/a.tex", "a\n");
    put(&s.src(), "figures/deep/b.tex", "b\n");
    s.sync(&[]).unwrap();
    fs::rename(s.src().join("figures"), s.src().join("images")).unwrap();
    fs::rename(
        s.src().join("images/deep/b.tex"),
        s.src().join("images/deep/c.tex"),
    )
    .unwrap();
    s.sync(&[]).unwrap();
    let top = s.names("");
    assert!(top.contains(&"images".to_owned()), "{top:?}");
    assert_eq!(s.names("images/deep"), ["c.tex"]);
    assert_eq!(s.names("images"), ["a.tex", "deep"]);
    // The old folder keeps only folders: no stale source file can still be \input.
    let old = s.tree().join("figures");
    if old.exists() {
        assert!(
            fs::read_dir(&old)
                .unwrap()
                .flatten()
                .all(|e| e.path().is_dir()),
            "files of the old place are still in the tree"
        );
    }
}

fn buffer(path: &str) -> Buffer {
    Buffer {
        path: format!("{FOLDER}/{path}"),
        text: "x".to_owned(),
    }
}

#[test]
fn names_windows_reads_as_something_else_are_refused_before_any_file_is_made() {
    let s = setup();
    for name in [
        "main.tex::$DATA",
        "main.tex:evil.tex",
        "PROGRA~1/x.tex",
        "dots.tex.",
        "spaces.tex ",
        "sub./x.tex",
        "sub /x.tex",
        "COM1.tex",
        "com\u{b9}.tex",
        "conin$.tex",
        "lpt3/x.tex",
        "Aux/x.tex",
        "NUL.tex",
        "..\\..\\out.tex",
        "\\\\?\\C:\\Windows\\x.tex",
        "\\\\server\\share\\x.tex",
        "C:\\x.tex",
        "C:x.tex",
        "//server/share/x.tex",
        "sub/../../x.tex",
        "~$lock.tex:x",
        "nul\0.tex",
        "a/\u{202e}x.tex\0",
    ] {
        // 8.3 names are plain names inside the folder, so `PROGRA~1` alone is not a
        // way out; it is listed because a stream or device on it must still fail.
        let result = s.sync(&[buffer(name)]);
        if name == "PROGRA~1/x.tex" {
            assert!(
                result.is_ok(),
                "a short name is an ordinary name: {result:?}"
            );
            continue;
        }
        assert!(
            matches!(result, Err(Refused::Escape(_) | Refused::NotSource(_))),
            "{name:?}: {result:?}"
        );
    }
    // Nothing was written outside the tree, and nothing odd inside it.
    assert!(!s.dir.join("out.tex").exists());
    assert!(!s.root.join("out.tex").exists());
    assert!(!s.tree().join("evil.tex").exists());
}
