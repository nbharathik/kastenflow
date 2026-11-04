//! Journal days start from `templates/journal.md`, except the template
//! vaults were given until new days started blank.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::{frontmatter, journal_day};

#[test]
fn untouched_daily_planner_starts_blank_but_preserves_written_content() {
    let t = dev_vault();
    let template = t.vault.root().join("templates/journal.md");
    let old = include_str!("../../defaults/legacy/daily-journal.md");
    fs::write(&template, old).unwrap();
    let day = journal_day(&t.vault, None, "2026-10-08", NOW).unwrap();
    assert!(frontmatter::split(&day.text).body.trim().is_empty());
    let own = format!("{old}\nMy plans.\n");
    fs::write(&template, &own).unwrap();
    let written = journal_day(&t.vault, None, "2026-10-09", NOW).unwrap();
    assert!(written.text.contains("My plans."));
    fs::write(&template, old).unwrap();
    assert_eq!(
        journal_day(&t.vault, None, "2026-10-09", NOW).unwrap().text,
        written.text
    );
}

#[test]
fn a_journal_template_left_as_the_old_default_starts_days_blank() {
    let t = dev_vault();
    let template = t.vault.root().join("templates/journal.md");
    // Vaults made before new days started blank kept this template.
    let old = "---\ntitle: \"{{date}}\"\ntype: journal\n---\n## Morning\n\n## Notes\n";
    fs::write(&template, old).unwrap();
    let day = journal_day(&t.vault, None, "2026-09-24", NOW).unwrap();
    assert_eq!(
        frontmatter::split(&day.text).body.trim(),
        "",
        "{}",
        day.text
    );
    // The same, checked out with Windows line endings.
    fs::write(&template, old.replace('\n', "\r\n")).unwrap();
    let windows = journal_day(&t.vault, None, "2026-09-25", NOW).unwrap();
    assert_eq!(
        frontmatter::split(&windows.text).body.trim(),
        "",
        "{}",
        windows.text
    );
    // A template someone wrote is theirs, and is kept.
    fs::write(&template, old.replace("## Notes", "## Grateful for")).unwrap();
    let own = journal_day(&t.vault, None, "2026-09-26", NOW).unwrap();
    assert!(
        own.text.contains("## Morning\n\n## Grateful for"),
        "{}",
        own.text
    );
}

#[test]
fn any_old_journal_template_with_only_its_two_headings_starts_days_blank() {
    let t = dev_vault();
    let template = t.vault.root().join("templates/journal.md");
    let front = "---\ntitle: \"{{date}}\"\ntype: journal\n---\n";
    let blank = |text: &str, day: &str| {
        fs::write(&template, text).unwrap();
        let made = journal_day(&t.vault, None, day, NOW).unwrap();
        frontmatter::split(&made.text).body.trim().is_empty()
    };
    // Other blank lines, heading levels, a byte order mark: still the old default.
    assert!(blank(
        &format!("{front}## Morning\n## Notes\n\n\n"),
        "2026-10-01"
    ));
    assert!(blank(
        &format!("{front}\n# Morning\n\n### notes\n"),
        "2026-10-02"
    ));
    assert!(blank(
        &format!("\u{feff}{front}## Morning  \n\n## Notes"),
        "2026-10-03"
    ));
    // Anything written under them, or more frontmatter, is someone's own.
    assert!(!blank(
        &format!("{front}## Morning\n- tea\n\n## Notes\n"),
        "2026-10-04"
    ));
    assert!(!blank(
        "---\ntitle: \"{{date}}\"\ntype: journal\ntags: [daily]\n---\n## Morning\n\n## Notes\n",
        "2026-10-05"
    ));
    assert!(!blank(&format!("{front}## Today\n"), "2026-10-06"));
}

/// A fresh vault with history, removed when dropped.
struct Fresh {
    dir: std::path::PathBuf,
    k: kasten_core::Kasten,
}

impl Drop for Fresh {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn fresh() -> Fresh {
    let dir = std::env::temp_dir().join(format!(
        "kasten-journal-choice-{}",
        kasten_core::ulid_at(kasten_core::Instant::now().millis)
    ));
    let k = kasten_core::Kasten::init(&dir, "Journal choice").unwrap();
    Fresh { dir, k }
}

#[test]
fn the_journal_can_start_days_from_another_template() {
    use kasten_core::history::Actor;
    let f = fresh();
    let mut config = f.k.config();
    assert_eq!(config.journal_template, None);
    config.journal_template = Some("daily-planner".into());
    f.k.set_config(config).unwrap();
    // Kept in the vault's config as written.
    let kept = kasten_core::config::Config::load(&f.dir).unwrap();
    assert_eq!(kept.journal_template.as_deref(), Some("daily-planner"));

    let planner = fs::read_to_string(f.dir.join("templates/daily-planner.md")).unwrap();
    let first_heading = frontmatter::split(&planner)
        .body
        .lines()
        .find(|l| l.starts_with('#'))
        .unwrap()
        .to_owned();
    let day = f.k.journal(&Actor::Human, None, "2026-10-05", NOW).unwrap();
    assert!(day.text.contains(&first_heading), "{}", day.text);
    assert_eq!(day.meta.path, "journal/2026/2026-10-05.md");
    assert!(day.text.contains("type: journal"), "{}", day.text);
}

#[test]
fn a_missing_or_unsafe_journal_template_falls_back_to_the_usual_one() {
    use kasten_core::history::Actor;
    let f = fresh();
    let usual = frontmatter::split(
        &f.k.journal(&Actor::Human, None, "2026-10-01", NOW)
            .unwrap()
            .text,
    )
    .body
    .to_owned();
    for name in ["gone", "../templates/journal", "templates/journal", ""] {
        let mut config = f.k.config();
        config.journal_template = Some(name.into());
        f.k.set_config(config).unwrap();
        let date = format!("2026-10-{:02}", 10 + name.len() % 20);
        let day = f.k.journal(&Actor::Human, None, &date, NOW).unwrap();
        assert_eq!(
            frontmatter::split(&day.text).body,
            usual,
            "{name}: {}",
            day.text
        );
    }
}
