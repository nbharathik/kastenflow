//! The build tree: the document's folder mirrored into the cache with the
//! window's unsaved text laid over it, copying only what changed, and
//! never reading, or being told to read, anything outside the folder.

use std::fs;
use std::path::Path;

use super::support::{Dir, FOLDER, link, put, vault};
use crate::plugins::latex::snapshot::{
    Buffer, MAX_BUFFERS, Places, Refused, Stats, VAULT_BIB, check_buffers, sync,
};

struct Setup {
    dir: Dir,
    root: std::path::PathBuf,
}

fn setup() -> Setup {
    let dir = Dir::new("snapshot");
    let root = vault(&dir);
    Setup { dir, root }
}

impl Setup {
    fn src(&self) -> std::path::PathBuf {
        self.root.join(FOLDER)
    }

    fn build(&self) -> std::path::PathBuf {
        self.root.join(".kasten/cache/latex/abc")
    }

    fn tree(&self) -> std::path::PathBuf {
        self.build().join("tree")
    }

    fn sync(&self, buffers: &[Buffer], bib: Option<&Path>) -> Result<Stats, Refused> {
        let (src, build, tree) = (self.src(), self.build(), self.tree());
        sync(
            &Places {
                root: &self.root,
                src: &src,
                build: &build,
                tree: &tree,
                folder: FOLDER,
            },
            buffers,
            bib,
        )
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.tree().join(rel)).unwrap()
    }

    fn exists(&self, rel: &str) -> bool {
        self.tree().join(rel).exists()
    }
}

fn buffer(rel: &str, text: &str) -> Buffer {
    Buffer {
        path: format!("{FOLDER}/{rel}"),
        text: text.to_owned(),
    }
}

#[test]
fn the_folder_is_mirrored_into_the_cache() {
    let s = setup();
    let stats = s.sync(&[], None).unwrap();
    assert_eq!(stats.copied, 2);
    assert_eq!(
        s.read("main.tex"),
        fs::read_to_string(s.src().join("main.tex")).unwrap()
    );
    assert_eq!(s.read("sections/intro.tex"), "Hello.\n");
    // Nothing of the vault outside the document is in the tree.
    assert!(!s.exists("../../../../notes/secret.md"));
    assert!(!s.tree().join("secret.md").exists());
}

#[test]
fn only_files_that_changed_are_copied_again() {
    let s = setup();
    s.sync(&[], None).unwrap();
    let again = s.sync(&[], None).unwrap();
    assert_eq!((again.copied, again.unchanged), (0, 2));

    put(&s.src(), "sections/intro.tex", "Hello, changed text.\n");
    let third = s.sync(&[], None).unwrap();
    assert_eq!((third.copied, third.unchanged), (1, 1));
    assert_eq!(s.read("sections/intro.tex"), "Hello, changed text.\n");

    put(&s.src(), "sections/new.tex", "A new file.\n");
    let fourth = s.sync(&[], None).unwrap();
    assert_eq!((fourth.copied, fourth.unchanged), (1, 2));
}

#[test]
fn a_file_that_went_from_the_folder_goes_from_the_tree() {
    let s = setup();
    put(&s.src(), "old.tex", "gone soon\n");
    s.sync(&[], None).unwrap();
    assert!(s.exists("old.tex"));
    fs::remove_file(s.src().join("old.tex")).unwrap();
    let stats = s.sync(&[], None).unwrap();
    assert_eq!(stats.removed, 1);
    assert!(!s.exists("old.tex"));
    // A file the engine itself left in the tree goes at the next build too.
    put(&s.tree(), "main.aux", "stale\n");
    assert_eq!(s.sync(&[], None).unwrap().removed, 1);
    assert!(!s.exists("main.aux"));
}

#[test]
fn unsaved_text_is_laid_over_the_files_and_the_folder_is_left_alone() {
    let s = setup();
    let on_disk = fs::read(s.src().join("sections/intro.tex")).unwrap();
    let stats = s
        .sync(
            &[buffer("sections/intro.tex", "Typed, not saved yet.\n")],
            None,
        )
        .unwrap();
    assert_eq!(stats.overlaid, 1);
    assert_eq!(s.read("sections/intro.tex"), "Typed, not saved yet.\n");
    assert_eq!(
        fs::read(s.src().join("sections/intro.tex")).unwrap(),
        on_disk
    );

    // The same buffer again changes nothing; without it the saved file is back.
    let same = s
        .sync(
            &[buffer("sections/intro.tex", "Typed, not saved yet.\n")],
            None,
        )
        .unwrap();
    assert_eq!(same.copied, 0);
    s.sync(&[], None).unwrap();
    assert_eq!(s.read("sections/intro.tex"), "Hello.\n");
}

#[test]
fn a_new_unsaved_file_in_a_new_folder_is_made_in_the_tree() {
    let s = setup();
    s.sync(&[buffer("chapters/two/part.tex", "\\section{New}\n")], None)
        .unwrap();
    assert_eq!(s.read("chapters/two/part.tex"), "\\section{New}\n");
    assert!(!s.src().join("chapters").exists());
}

#[test]
fn a_buffer_that_names_a_path_outside_the_folder_is_refused() {
    let s = setup();
    for path in [
        format!("{FOLDER}/../../../../notes/secret.md"),
        format!("{FOLDER}/../b/x.tex"),
        format!("{FOLDER}/sections/../../x.tex"),
        "projects/p/latex/other/x.tex".to_owned(),
        format!("{FOLDER}x/main.tex"),
        "/etc/passwd".to_owned(),
        "C:/Windows/x.tex".to_owned(),
        format!("{FOLDER}//x.tex"),
        format!("{FOLDER}/C:/x.tex"),
        format!("{FOLDER}/a\\b.tex"),
        format!("{FOLDER}/a\\..\\..\\x.tex"),
        format!("{FOLDER}/.hidden.tex"),
        format!("{FOLDER}/.git/hooks/x.tex"),
        format!("{FOLDER}/x.tex::$DATA"),
        format!("{FOLDER}/nul.tex"),
        format!("{FOLDER}/bad\0.tex"),
        format!("{FOLDER}/trailing.tex."),
        format!("{FOLDER}/"),
        FOLDER.to_owned(),
        String::new(),
    ] {
        let bad = Buffer {
            path: path.clone(),
            text: "x".to_owned(),
        };
        let result = s.sync(std::slice::from_ref(&bad), None);
        assert!(
            matches!(result, Err(Refused::Escape(_))),
            "{path:?} gave {result:?}"
        );
    }
    // Nothing was made for any of them.
    assert!(!s.build().exists());
}

#[test]
fn a_buffer_must_be_a_kind_of_file_a_document_holds_as_text() {
    let s = setup();
    for rel in [
        "run.exe",
        "image.png",
        "main.pdf",
        "script.sh",
        "kasten-latex.yaml",
        "noext",
    ] {
        let one = [buffer(rel, "x")];
        let result = check_buffers(FOLDER, &one);
        assert!(
            matches!(result, Err(Refused::NotSource(_))),
            "{rel}: {result:?}"
        );
    }
    for rel in ["a.tex", "a.sty", "a.cls", "a.bst", "a.bib", "A.TEX"] {
        assert!(check_buffers(FOLDER, &[buffer(rel, "x")]).is_ok(), "{rel}");
    }
    assert!(!s.build().exists());
}

#[test]
fn buffer_size_and_count_are_limited() {
    let big = buffer("big.tex", &"x".repeat(204_801));
    assert!(matches!(
        check_buffers(FOLDER, &[big]),
        Err(Refused::TooBig(_))
    ));
    let exact = buffer("exact.tex", &"x".repeat(204_800));
    assert!(check_buffers(FOLDER, &[exact]).is_ok());
    let many: Vec<Buffer> = (0..=MAX_BUFFERS)
        .map(|i| buffer(&format!("f{i}.tex"), "x"))
        .collect();
    assert_eq!(check_buffers(FOLDER, &many).err(), Some(Refused::TooMany));
}

#[test]
fn a_path_named_twice_keeps_the_last_buffer() {
    let s = setup();
    s.sync(&[buffer("a.tex", "first"), buffer("a.tex", "second")], None)
        .unwrap();
    assert_eq!(s.read("a.tex"), "second");
}

#[test]
fn hidden_files_programs_and_latexmk_settings_are_not_mirrored() {
    let s = setup();
    for rel in [
        ".git/config",
        ".hidden.tex",
        "pdflatex.exe",
        "tool.bat",
        "evil.DLL",
        "latexmkrc",
        "LatexmkRC",
        ".latexmkrc",
    ] {
        put(&s.src(), rel, "x");
    }
    put(&s.src(), "figures/plot.png", "png");
    let stats = s.sync(&[], None).unwrap();
    for rel in [
        ".git/config",
        ".hidden.tex",
        "pdflatex.exe",
        "tool.bat",
        "evil.DLL",
        "latexmkrc",
        "LatexmkRC",
        ".latexmkrc",
    ] {
        assert!(!s.exists(rel), "{rel}");
    }
    assert!(s.exists("figures/plot.png"));
    assert!(stats.skipped >= 6, "{stats:?}");
}

#[test]
fn links_are_never_followed_even_ones_that_leave_the_folder() {
    let s = setup();
    let outside = s.dir.join("outside");
    put(&outside, "secret.tex", "SECRET\n");
    put(&outside, "folder/inner.tex", "SECRET INNER\n");
    let made_file = link(
        &outside.join("secret.tex"),
        &s.src().join("stolen.tex"),
        false,
    );
    let made_dir = link(&outside.join("folder"), &s.src().join("stolen"), true);
    if !(made_file && made_dir) {
        // This machine does not let the test make links (Windows without the right).
        return;
    }
    // A link inside the folder to a file inside it is not followed either.
    assert!(link(
        &s.src().join("main.tex"),
        &s.src().join("alias.tex"),
        false
    ));
    let stats = s.sync(&[], None).unwrap();
    assert!(!s.exists("stolen.tex") && !s.exists("stolen") && !s.exists("alias.tex"));
    assert_eq!(stats.skipped, 3);
    assert!(s.exists("main.tex"));
}

#[test]
fn a_link_where_the_folder_should_be_is_refused() {
    let s = setup();
    let outside = s.dir.join("outside");
    put(&outside, "main.tex", "SECRET\n");
    fs::remove_dir_all(s.src()).unwrap();
    if !link(&outside, &s.src(), true) {
        return;
    }
    assert!(matches!(s.sync(&[], None), Err(Refused::Folder(_))));
    assert!(!s.exists("main.tex"));
}

#[test]
fn a_link_in_the_cache_path_is_refused_and_nothing_is_written_through_it() {
    let s = setup();
    let outside = s.dir.join("outside-cache");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(s.root.join(".kasten/cache")).unwrap();
    if !link(&outside, &s.root.join(".kasten/cache/latex"), true) {
        return;
    }
    assert!(matches!(s.sync(&[], None), Err(Refused::Io(_))));
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
}

#[test]
fn a_link_left_in_the_tree_is_removed_and_its_target_is_untouched() {
    let s = setup();
    s.sync(&[], None).unwrap();
    let outside = s.dir.join("outside");
    put(&outside, "keep.txt", "KEEP\n");
    if !link(&outside, &s.tree().join("trap"), true) {
        return;
    }
    s.sync(&[], None).unwrap();
    assert!(!s.tree().join("trap").exists());
    assert_eq!(
        fs::read_to_string(outside.join("keep.txt")).unwrap(),
        "KEEP\n"
    );
}

#[test]
fn a_file_in_the_tree_where_a_folder_is_needed_is_replaced() {
    let s = setup();
    s.sync(&[], None).unwrap();
    // The engine left a file called "sections"; the folder of that name is needed again.
    fs::remove_dir_all(s.tree().join("sections")).unwrap();
    put(&s.tree(), "sections", "in the way\n");
    s.sync(&[], None).unwrap();
    assert_eq!(s.read("sections/intro.tex"), "Hello.\n");
}

#[test]
fn the_vault_bibliography_is_copied_in_as_references_bib() {
    let s = setup();
    put(
        &s.root,
        "sources/references.bib",
        "@book{vault, title={From the vault}}\n",
    );
    put(&s.src(), VAULT_BIB, "@book{local, title={Local}}\n");
    let bib = s.root.join("sources/references.bib");
    s.sync(&[], Some(&bib)).unwrap();
    assert_eq!(s.read(VAULT_BIB), "@book{vault, title={From the vault}}\n");
    // The same again copies nothing; a buffer for the local one does not beat the vault's.
    let again = s
        .sync(
            &[buffer(VAULT_BIB, "@book{typed, title={Typed}}\n")],
            Some(&bib),
        )
        .unwrap();
    assert_eq!(again.copied, 0);
    assert_eq!(s.read(VAULT_BIB), "@book{vault, title={From the vault}}\n");
    // Without the vault option the local file is used.
    s.sync(&[], None).unwrap();
    assert_eq!(s.read(VAULT_BIB), "@book{local, title={Local}}\n");
    // A vault bibliography that is not there changes nothing.
    s.sync(&[], Some(&s.root.join("sources/nothing.bib")))
        .unwrap();
}

#[test]
fn a_folder_too_big_to_mirror_is_refused_with_a_sentence() {
    let s = setup();
    for i in 0..5_001 {
        put(&s.src(), &format!("many/f{i}.txt"), "x");
    }
    match s.sync(&[], None) {
        Err(Refused::Folder(why)) => assert!(why.contains("too big"), "{why}"),
        other => panic!("{other:?}"),
    }
}
