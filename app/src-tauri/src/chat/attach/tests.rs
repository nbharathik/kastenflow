//! The attachment store: what it keeps, what it refuses, and that it never
//! removes anything on its own.

use std::collections::HashSet;

use super::sniff::fixtures::{gif, jpeg, png, webp_lossy};
use super::*;
use crate::chat::model::Message;
use crate::chat::tests::Scratch;

fn store() -> (Scratch, Attachments) {
    let dir = Scratch::new();
    let files = Attachments::open(&dir.0, "/vaults/one");
    (dir, files)
}

fn none() -> HashSet<String> {
    HashSet::new()
}

fn put_text(files: &Attachments, name: &str, text: &str) -> Result<AttachmentInfo, String> {
    files.put(name, AttachKind::Text, text.as_bytes())
}

fn data_files(files: &Attachments) -> usize {
    files.stored().len()
}

#[test]
fn text_is_kept_by_its_content_and_the_same_text_twice_is_one_file() {
    let (_dir, files) = store();
    let first = put_text(&files, "notes.md", "Some pasted text.\nWith two lines.").unwrap();
    assert_eq!((first.kind, first.chars), (AttachKind::Text, Some(33)));
    assert_eq!(first.id.len(), 64);
    assert_eq!(first.mime, "text/plain; charset=utf-8");
    let again = put_text(
        &files,
        "copy of notes.md",
        "Some pasted text.\nWith two lines.",
    )
    .unwrap();
    assert_eq!(again.id, first.id);
    assert_eq!(
        again.name, "copy of notes.md",
        "the name is the one it came with"
    );
    assert_eq!(data_files(&files), 1);
    assert_eq!(
        files.bytes(&first.id).unwrap(),
        b"Some pasted text.\nWith two lines."
    );
    let other = put_text(&files, "other.md", "Different.").unwrap();
    assert_ne!(other.id, first.id);
    assert_eq!(data_files(&files), 2);
}

#[test]
fn a_name_is_only_a_name() {
    let (_dir, files) = store();
    let info = put_text(&files, "..\\..\\evil/../paper.txt", "x").unwrap();
    assert_eq!(info.name, "paper.txt");
    assert_eq!(put_text(&files, "  ", "y").unwrap().name, "attachment");
}

#[test]
fn long_text_is_cut_with_a_marker_that_says_how_much_went() {
    let (_dir, files) = store();
    let text = format!("{}\n", "word ".repeat(10)).repeat(5_000);
    let total = text.chars().count();
    assert!(total > MAX_TEXT_CHARS);
    let info = put_text(&files, "long.txt", &text).unwrap();
    let stored = String::from_utf8(files.bytes(&info.id).unwrap()).unwrap();
    let marker = stored
        .rsplit_once("\n[Cut: ")
        .map(|(_, rest)| rest)
        .unwrap();
    assert!(
        marker.starts_with(&format!("the attachment had {total} characters; the last ")),
        "{marker}"
    );
    assert!(marker.ends_with(" are left out.]"), "{marker}");
    assert_eq!(info.chars, Some(stored.chars().count()));
    assert!(stored.chars().count() <= MAX_TEXT_CHARS + 120);
    // Short text is whole, and a byte order mark is not text.
    let whole = files
        .put("bom.txt", AttachKind::Text, b"\xEF\xBB\xBFhello")
        .unwrap();
    assert_eq!(files.bytes(&whole.id).unwrap(), b"hello");
}

#[test]
fn what_is_not_text_is_refused_in_a_sentence_naming_the_file() {
    let (_dir, files) = store();
    let refused = |bytes: &[u8]| files.put("thing.bin", AttachKind::Text, bytes).unwrap_err();
    assert!(refused(b"has\0a nul").contains("“thing.bin” is not text"));
    assert!(refused(&[0xC3, 0x28, 0xFF]).contains("must be UTF-8"));
    assert!(refused(&png(2, 2)).contains("is a picture; attach it as a picture"));
    assert!(
        put_text(&files, "empty.txt", "")
            .unwrap_err()
            .contains("is empty")
    );
    let big = vec![b'a'; MAX_FILE + 1];
    let err = files.put("big.txt", AttachKind::Text, &big).unwrap_err();
    assert!(
        err.contains("“big.txt” is 25.0 MB") && err.contains("the most is 25.0 MB"),
        "{err}"
    );
    assert_eq!(data_files(&files), 0, "nothing was kept");
}

#[test]
fn pictures_are_known_by_their_first_bytes_not_their_names() {
    let (_dir, files) = store();
    for (bytes, mime, size) in [
        (png(640, 480), "image/png", (640, 480)),
        (jpeg(1200, 800), "image/jpeg", (1200, 800)),
        (gif(32, 16), "image/gif", (32, 16)),
        (webp_lossy(300, 200), "image/webp", (300, 200)),
    ] {
        let info = files
            .put("whatever.txt", AttachKind::Image, &bytes)
            .unwrap();
        assert_eq!((info.kind, info.mime.as_str()), (AttachKind::Image, mime));
        assert_eq!((info.width, info.height), (Some(size.0), Some(size.1)));
        assert_eq!(info.chars, None);
        assert_eq!(files.bytes(&info.id).unwrap(), bytes);
    }
}

#[test]
fn an_svg_other_bytes_and_a_picture_too_large_are_refused() {
    let (_dir, files) = store();
    let put = |name: &str, bytes: &[u8]| files.put(name, AttachKind::Image, bytes).unwrap_err();
    let svg = put("logo.svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    assert!(
        svg.contains("“logo.svg” is an SVG") && svg.contains("attach it as text"),
        "{svg}"
    );
    assert!(put("p.pdf", b"%PDF-1.7 ...").contains("is not a PNG, JPEG, GIF or WebP picture"));
    assert!(put("words.png", b"just words").contains("“words.png” is not a PNG"));
    let mut heavy = png(100, 100);
    heavy.resize(MAX_IMAGE + 1, 0);
    let err = put("heavy.png", &heavy);
    assert!(
        err.contains("The picture “heavy.png” is 5.0 MB; the most is 5.0 MB"),
        "{err}"
    );
    let wide = put("wide.png", &png(MAX_SIDE + 1, 10));
    assert!(
        wide.contains("8001 by 10 pixels") && wide.contains("8000 on a side"),
        "{wide}"
    );
    assert!(
        files
            .put("ok.png", AttachKind::Image, &png(MAX_SIDE, MAX_SIDE))
            .is_ok()
    );
}

#[test]
fn a_full_store_refuses_the_new_one_in_words_and_removes_nothing_to_make_room() {
    let dir = Scratch::new();
    let files = Attachments::open(&dir.0, "/vaults/one").capped(100);
    let a = put_text(&files, "a", &"a".repeat(30)).unwrap();
    let b = put_text(&files, "b", &"b".repeat(30)).unwrap();
    let c = put_text(&files, "c", &"c".repeat(30)).unwrap();
    assert_eq!(files.total(), 90);
    // The same thing again takes no room, so it is not refused.
    assert!(put_text(&files, "a again", &"a".repeat(30)).is_ok());
    // Something new does not fit: no chat uses any of these, and still none goes.
    let err = put_text(&files, "d", &"d".repeat(30)).unwrap_err();
    assert!(
        err.contains("of the 0.0 MB they may") && err.contains("Delete old chats to make room"),
        "{err}"
    );
    assert_eq!(data_files(&files), 3);
    for info in [&a, &b, &c] {
        assert!(files.bytes(&info.id).is_ok());
    }
    assert_eq!(files.total(), 90, "the report follows what is kept");
}

#[test]
fn an_unused_attachment_can_be_dropped_and_a_used_one_cannot() {
    let (_dir, files) = store();
    let info = put_text(&files, "x", "kept").unwrap();
    let used: HashSet<String> = [info.id.clone()].into();
    assert!(!files.drop_unused(&info.id, &used));
    assert!(files.bytes(&info.id).is_ok());
    assert!(files.drop_unused(&info.id, &none()));
    assert!(files.bytes(&info.id).is_err());
    assert!(
        !files.drop_unused("../escape", &none()),
        "only ids are names"
    );
    assert!(
        !files.meta_path(&info.id).exists(),
        "its record goes with it"
    );
}

#[test]
fn an_attachment_nobody_uses_stays_however_old_it_is() {
    let (dir, files) = store();
    let lonely = put_text(&files, "lonely", "attached and never sent").unwrap();
    // Years pass, the app starts again: nothing is swept, nothing is evicted.
    let again = Attachments::open(&dir.0, "/vaults/one");
    assert_eq!(again.bytes(&lonely.id).unwrap(), b"attached and never sent");
    // Only the person's own removal of it takes it away.
    assert!(again.drop_unused(&lonely.id, &none()));
    assert_eq!(again.total(), 0);
}

#[test]
fn a_message_resolves_to_text_and_pictures_and_a_lost_one_is_a_sentence() {
    let (_dir, files) = store();
    let text = put_text(&files, "plan.md", "# Plan").unwrap();
    let image = files
        .put("shot.png", AttachKind::Image, &png(4, 4))
        .unwrap();
    let refs = |list: &[(&AttachmentInfo, &str)]| -> Vec<AttachmentRef> {
        list.iter()
            .map(|(info, name)| AttachmentRef {
                id: info.id.clone(),
                name: (*name).to_owned(),
                kind: info.kind,
            })
            .collect()
    };
    let resolved = files.resolve(&refs(&[
        (&text, "plan.md"),
        (&image, "shot.png"),
        (&text, "plan again"),
    ]));
    assert_eq!(resolved.texts.len(), 1, "the same attachment once");
    assert_eq!(resolved.texts[0].name, "plan.md");
    assert_eq!(resolved.texts[0].text, "# Plan");
    assert_eq!(resolved.images.len(), 1);
    assert_eq!(resolved.images[0].mime, "image/png");
    assert!(!resolved.images[0].data.is_empty());

    let gone = AttachmentRef {
        id: "0".repeat(64),
        name: "lost.pdf".to_owned(),
        kind: AttachKind::Text,
    };
    let lost = files.resolve(&[gone]);
    assert!(lost.images.is_empty());
    assert_eq!(lost.texts[0].name, "lost.pdf");
    assert!(
        lost.texts[0]
            .text
            .starts_with("(This attachment could not be read: it is no longer stored."),
        "{}",
        lost.texts[0].text
    );
}

#[test]
fn pictures_are_read_again_into_a_thread_that_lost_their_bytes() {
    let (_dir, files) = store();
    let info = files
        .put("shot.png", AttachKind::Image, &png(4, 4))
        .unwrap();
    let image = Image {
        id: info.id.clone(),
        name: "shot.png".into(),
        mime: "image/png".into(),
        data: String::new(),
    };
    let mut thread = vec![Message::UserImages {
        text: "Look".into(),
        images: vec![image],
    }];
    files.restore_pictures(&mut thread);
    let Message::UserImages { images, .. } = &thread[0] else {
        panic!("{thread:?}");
    };
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(&images[0].data)
            .unwrap(),
        png(4, 4)
    );
}
