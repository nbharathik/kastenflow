//! The named views a page offers (`![[Page#deadlines]]`): the file a view is
//! drawn from comes out of a manifest the page's maker wrote, so the window
//! builds an address from it only when it is a page file inside the folder.

use crate::smart::commands::safe_entry;

#[test]
fn a_views_entry_is_an_html_file_inside_the_folder_or_it_is_dropped() {
    for good in ["deadlines.html", "views/map.html", "a/b/c.HTML"] {
        assert!(safe_entry(good), "{good}");
    }
    for bad in [
        "",
        "../index.html",
        "a/../../index.html",
        "..",
        "/index.html",
        "C:/x.html",
        "c:\\x.html",
        "a\\b.html",
        ".hidden.html",
        "a/.git/x.html",
        "kit/../x.html",
        "app.js",
        "x.exe",
        "x.html.exe",
        "x.html ",
        "x.html.",
        "smart://kit/1/kit.js",
        "http://evil.example/x.html",
        "//evil.example/x.html",
        "a\0b.html",
        "a\nb.html",
        "view.html?x=1",
        "view.html#frag",
    ] {
        assert!(!safe_entry(bad), "{bad:?}");
    }
}
