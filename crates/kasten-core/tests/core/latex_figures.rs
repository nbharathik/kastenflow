//! Agents putting a picture into a LaTeX document: a PNG, JPEG or PDF kept as
//! it is in the document's figures folder, an SVG kept and flagged, what is
//! not a picture (or runs) refused, the same bytes kept once, links never
//! followed, a locked document refused in every mode, and the limits on an
//! agent's pictures.

use crate::latex_more_common::*;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;

const FIGURES: &str = "projects/photo-organiser/latex/article/figures";

#[test]
fn a_png_a_jpeg_and_a_pdf_are_kept_as_they_are_in_the_figures_folder() {
    let (t, k, s) = open();
    for (name, bytes, kind) in [
        ("chart.png", PNG, "png"),
        ("photo.JPG", JPG, "jpg"),
        ("plot.pdf", PDF, "pdf"),
    ] {
        let told = done(
            k.agent_run(&s, &picture(ARTICLE, name, bytes), NOW)
                .unwrap(),
        );
        let file = name.to_lowercase();
        assert_eq!(told["status"], "added", "{told}");
        assert_eq!(told["path"], format!("{FIGURES}/{file}"));
        assert_eq!(told["figure"], format!("figures/{file}"));
        assert_eq!(told["kind"], kind);
        assert_eq!(
            told["include"],
            format!("\\includegraphics[width=\\linewidth]{{figures/{file}}}")
        );
        assert!(told.get("note").is_none(), "{told}");
        assert_eq!(bytes_of(&t, &format!("{FIGURES}/{file}")), bytes);
    }
    // No sidecar litters the document's folder.
    let files = snapshot(t.vault.root());
    assert!(
        files.keys().filter(|f| f.starts_with(FIGURES)).count() == 3,
        "{:?}",
        files.keys().collect::<Vec<_>>()
    );
}

#[test]
fn an_svg_is_cleaned_kept_and_flagged() {
    let (t, k, s) = open();
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><script>alert(1)</script><rect width=\"10\" height=\"10\"/></svg>";
    let told = done(
        k.agent_run(&s, &picture(ARTICLE, "drawing.svg", svg.as_bytes()), NOW)
            .unwrap(),
    );
    assert_eq!(told["status"], "added", "{told}");
    assert_eq!(told["kind"], "svg");
    let note = told["note"].as_str().unwrap();
    assert!(
        note.contains("svg package") && note.contains("PNG"),
        "{note}"
    );
    let kept = text_of(&t, &format!("{FIGURES}/drawing.svg"));
    assert!(kept.contains("<rect") && !kept.contains("script"), "{kept}");
    // Not an SVG at all.
    let before = snapshot(t.vault.root());
    let said = why(k.agent_run(&s, &picture(ARTICLE, "fake.svg", b"<html>hi</html>"), NOW));
    assert!(said.contains("not a PNG, JPEG, PDF or SVG"), "{said}");
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_program_an_unknown_kind_and_a_wrong_name_are_refused_and_nothing_is_written() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    for (name, bytes, wanted) in [
        ("tool.exe", &b"MZ\x90\0\x03"[..], "never keeps a program"),
        ("chart.png", b"MZ\x90\0\x03", "never keeps a program"),
        ("run.sh", PNG, "never keeps a program"),
        ("anim.gif", b"GIF89a\x01\0\x01\0", "PNG, JPEG or PDF"),
        ("notes.txt", b"hello", "PNG, JPEG or PDF"),
        ("chart.png", b"just words", "not a PNG, JPEG, PDF or SVG"),
        ("photo.jpg", PNG, "holds a PNG"),
        ("", PNG, "needs a name"),
        ("empty.png", b"", "is empty"),
    ] {
        let said = why(k.agent_run(&s, &picture(ARTICLE, name, bytes), NOW));
        assert!(said.contains(wanted), "{name}: {said}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn the_same_bytes_are_the_same_file_and_a_taken_name_gets_a_number() {
    let (t, k, s) = open();
    let first = done(
        k.agent_run(&s, &picture(ARTICLE, "chart.png", PNG), NOW)
            .unwrap(),
    );
    assert_eq!(first["status"], "added");
    let commits = k.log(None, 200).unwrap().len();
    // The same bytes, whatever the name: its path comes back and nothing is written.
    for name in ["chart.png", "another-name.png"] {
        let again = done(k.agent_run(&s, &picture(ARTICLE, name, PNG), NOW).unwrap());
        assert_eq!(again["status"], "existing", "{again}");
        assert_eq!(again["path"], first["path"]);
        assert!(again["note"].as_str().unwrap().contains("already"));
    }
    assert_eq!(k.log(None, 200).unwrap().len(), commits);
    assert!(!exists(&t, &format!("{FIGURES}/another-name.png")));
    // Other bytes under a taken name.
    let mut other = PNG.to_vec();
    other.extend_from_slice(b"more");
    let second = done(
        k.agent_run(&s, &picture(ARTICLE, "chart.png", &other), NOW)
            .unwrap(),
    );
    assert_eq!(second["path"], format!("{FIGURES}/chart-2.png"));
    assert_eq!(bytes_of(&t, &format!("{FIGURES}/chart.png")), PNG);
}

#[test]
fn the_picture_can_come_from_the_vault_or_as_base64_but_not_both_or_neither() {
    let (t, k, s) = open();
    put(&t, "assets/made.png", PNG);
    let from_vault = AgentOp::AddLatexAsset {
        doc: ARTICLE.into(),
        name: "from-vault.png".into(),
        base64: None,
        vault_path: Some("assets/made.png".into()),
        reason: None,
    };
    let told = done(k.agent_run(&s, &from_vault, NOW).unwrap());
    assert_eq!(told["path"], format!("{FIGURES}/from-vault.png"));
    assert_eq!(bytes_of(&t, &format!("{FIGURES}/from-vault.png")), PNG);
    let both = AgentOp::AddLatexAsset {
        doc: ARTICLE.into(),
        name: "x.png".into(),
        base64: Some(b64(PNG)),
        vault_path: Some("assets/made.png".into()),
        reason: None,
    };
    let neither = AgentOp::AddLatexAsset {
        doc: ARTICLE.into(),
        name: "x.png".into(),
        base64: None,
        vault_path: None,
        reason: None,
    };
    for op in [both, neither] {
        let said = why(k.agent_run(&s, &op, NOW));
        assert!(said.contains("either as base64"), "{said}");
    }
    for bad in ["not base64 !", "Zm9vY", "====", "data:image/png;base64,!!"] {
        let op = picture(ARTICLE, "x.png", PNG);
        let AgentOp::AddLatexAsset { doc, name, .. } = op else {
            unreachable!()
        };
        let op = AgentOp::AddLatexAsset {
            doc,
            name,
            base64: Some(bad.into()),
            vault_path: None,
            reason: None,
        };
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{bad}");
    }
}

#[test]
fn a_vault_path_outside_the_vault_hidden_missing_or_not_a_file_is_refused() {
    let (t, k, s) = open();
    let outside = t.vault.root().parent().unwrap().join("kasten-outside.png");
    std::fs::write(&outside, PNG).unwrap();
    put(&t, ".kasten/cache/secret.png", PNG);
    let before = snapshot(t.vault.root());
    let from = |path: &str| AgentOp::AddLatexAsset {
        doc: ARTICLE.into(),
        name: "x.png".into(),
        base64: None,
        vault_path: Some(path.into()),
        reason: None,
    };
    for path in [
        "../kasten-outside.png",
        "assets/../../kasten-outside.png",
        "/etc/passwd",
        "C:/Windows/win.png",
        "C:\\x.png",
        ".kasten/cache/secret.png",
        "assets/nope.png",
        "assets",
        "",
    ] {
        assert!(k.agent_run(&s, &from(path), NOW).is_err(), "{path}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
    let _ = std::fs::remove_file(outside);
}

#[test]
fn a_link_is_never_followed_for_the_picture_or_the_folder() {
    let (t, k, s) = open();
    let outside = t.vault.root().parent().unwrap().join("kasten-outside-dir");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.png"), PNG).unwrap();
    let link_dir = t.vault.root().join(ARTICLE).join("figures");
    let link_file = t.vault.root().join("assets/linked.png");
    std::fs::create_dir_all(link_file.parent().unwrap()).unwrap();
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&outside, &link_dir).is_ok()
        && std::os::unix::fs::symlink(outside.join("secret.png"), &link_file).is_ok();
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&outside, &link_dir).is_ok()
        && std::os::windows::fs::symlink_file(outside.join("secret.png"), &link_file).is_ok();
    if !made {
        // Links need a privilege some machines do not give.
        let _ = std::fs::remove_dir_all(&outside);
        return;
    }
    // A figures folder that is a link: nothing is put through it.
    let said = why(k.agent_run(&s, &picture(ARTICLE, "chart.png", PNG), NOW));
    assert!(said.contains("is a link"), "{said}");
    assert!(!outside.join("chart.png").exists());
    // A picture that is a link is not read.
    let from = AgentOp::AddLatexAsset {
        doc: ARTICLE.into(),
        name: "x.png".into(),
        base64: None,
        vault_path: Some("assets/linked.png".into()),
        reason: None,
    };
    assert!(k.agent_run(&s, &from, NOW).is_err());
    // A link among the figures is not read for the same bytes, nor written over.
    #[cfg(unix)]
    std::fs::remove_file(&link_dir).unwrap();
    #[cfg(windows)]
    std::fs::remove_dir(&link_dir).unwrap();
    std::fs::create_dir_all(&link_dir).unwrap();
    #[cfg(unix)]
    let inner = std::os::unix::fs::symlink(outside.join("secret.png"), link_dir.join("chart.png"));
    #[cfg(windows)]
    let inner =
        std::os::windows::fs::symlink_file(outside.join("secret.png"), link_dir.join("chart.png"));
    if inner.is_ok() {
        let told = done(
            k.agent_run(&s, &picture(ARTICLE, "chart.png", PNG), NOW)
                .unwrap(),
        );
        assert_eq!(told["status"], "added", "{told}");
        assert_eq!(told["path"], format!("{FIGURES}/chart-2.png"));
        assert_eq!(std::fs::read(outside.join("secret.png")).unwrap(), PNG);
    }
    let _ = std::fs::remove_dir_all(&outside);
}

#[test]
fn a_locked_document_is_refused_in_every_mode() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = open();
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        let said = why(k.agent_run(&s, &picture(LOCKED, "chart.png", PNG), NOW));
        assert!(said.contains("locked"), "{mode:?}: {said}");
        assert_eq!(snapshot(t.vault.root()), before, "{mode:?}");
        assert!(k.proposals().unwrap().is_empty());
    }
}

#[test]
fn a_folder_that_is_no_document_is_refused() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    for doc in ["library", "projects/photo-organiser", "nope", ""] {
        let said = why(k.agent_run(&s, &picture(doc, "chart.png", PNG), NOW));
        assert!(
            said.contains("not a LaTeX document folder"),
            "{doc}: {said}"
        );
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_picture_waits_in_no_mode() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = open();
        set_mode(&k, mode);
        let told = done(
            k.agent_run(&s, &picture(ARTICLE, "chart.png", PNG), NOW)
                .unwrap(),
        );
        assert_eq!(told["status"], "added", "{mode:?}");
        assert_eq!(bytes_of(&t, &format!("{FIGURES}/chart.png")), PNG);
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
}

#[test]
fn a_picture_over_the_limits_on_an_agents_pictures_is_refused() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_asset_bytes = 40;
    config.guardrails.max_assets_per_session_10min = 2;
    k.set_config(config).unwrap();
    let mut big = PNG.to_vec();
    big.extend_from_slice(&[0; 20]);
    let before = snapshot(t.vault.root());
    let said = why(k.agent_run(&s, &picture(ARTICLE, "big.png", &big), NOW));
    assert!(said.contains("at most"), "{said}");
    assert_eq!(snapshot(t.vault.root()), before);
    // Two pictures in ten minutes, a third is over the count; the same bytes again are free.
    for (name, extra) in [("a.png", 1u8), ("b.png", 2)] {
        let mut bytes = PNG.to_vec();
        bytes.push(extra);
        done(
            k.agent_run(&s, &picture(ARTICLE, name, &bytes), NOW)
                .unwrap(),
        );
    }
    let mut third = PNG.to_vec();
    third.push(3);
    let said = why(k.agent_run(&s, &picture(ARTICLE, "c.png", &third), NOW));
    assert!(said.contains("pictures in the last 10 minutes"), "{said}");
    let mut again = PNG.to_vec();
    again.push(1);
    let told = done(
        k.agent_run(&s, &picture(ARTICLE, "z.png", &again), NOW)
            .unwrap(),
    );
    assert_eq!(told["status"], "existing");
    assert!(!exists(&t, &format!("{FIGURES}/c.png")));
}

#[test]
fn a_session_of_pictures_is_taken_back_by_one_undo() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    done(
        k.agent_run(&s, &picture(ARTICLE, "one.png", PNG), NOW)
            .unwrap(),
    );
    done(
        k.agent_run(&s, &picture(ARTICLE, "two.pdf", PDF), NOW)
            .unwrap(),
    );
    assert!(exists(&t, &format!("{FIGURES}/two.pdf")));
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn the_picture_op_is_not_held_with_a_chats_other_changes() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let said = k
        .stage(&mut set, &s, &picture(ARTICLE, "chart.png", PNG), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        said.contains("cannot be held with the other changes"),
        "{said}"
    );
    assert!(k.proposals().unwrap().is_empty());
}
