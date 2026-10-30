//! latexmk needs the tree's folders below its output folder for `\include`.

use std::fs;

use super::support::{Dir, link, put};
use crate::plugins::latex::out_dirs::mirror_folders;

#[test]
fn the_folders_of_the_tree_are_made_in_the_output() {
    let dir = Dir::new("outdirs");
    let (tree, out) = (dir.join("tree"), dir.join("out"));
    put(&tree, "main.tex", "x");
    put(&tree, "chapters/one.tex", "x");
    put(&tree, "chapters/deep/two.tex", "x");
    fs::create_dir_all(&out).unwrap();
    let seen = mirror_folders(&tree, &out);
    assert_eq!(seen, 2);
    assert!(out.join("chapters").is_dir());
    assert!(out.join("chapters/deep").is_dir());
    // Files are not copied, and a second run changes nothing.
    assert!(!out.join("main.tex").exists());
    assert_eq!(mirror_folders(&tree, &out), 2);
}

#[test]
fn hidden_and_odd_folder_names_are_left_out() {
    let dir = Dir::new("outdirs-odd");
    let (tree, out) = (dir.join("tree"), dir.join("out"));
    fs::create_dir_all(tree.join(".git")).unwrap();
    fs::create_dir_all(tree.join("fine")).unwrap();
    fs::create_dir_all(&out).unwrap();
    mirror_folders(&tree, &out);
    assert!(out.join("fine").is_dir());
    assert!(!out.join(".git").exists());
}

#[test]
fn a_link_in_the_output_is_not_followed() {
    let dir = Dir::new("outdirs-link");
    let (tree, out, elsewhere) = (dir.join("tree"), dir.join("out"), dir.join("elsewhere"));
    fs::create_dir_all(tree.join("chapters/deep")).unwrap();
    fs::create_dir_all(&out).unwrap();
    fs::create_dir_all(&elsewhere).unwrap();
    if !link(&elsewhere, &out.join("chapters"), true) {
        return;
    }
    mirror_folders(&tree, &out);
    assert!(!elsewhere.join("deep").exists());
}
