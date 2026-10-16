use std::fs;

use super::*;

fn folder(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("kasten-learned-{name}-{}", std::process::id()))
}

#[test]
fn nothing_is_known_at_first_so_a_request_asks_for_everything() {
    let learned = Learned::default();
    assert_eq!(learned.shape_for("gpt-6.1-sol"), Shape::default());
    assert!(!learned.refused("gpt-6.1-sol", Feature::Effort));
    assert!(!learned.works("gpt-6.1-sol", Feature::Effort));
}

#[test]
fn what_is_found_is_about_one_model_and_one_part() {
    let learned = Learned::default();
    learned.tried("big", Feature::Effort, Tried::Refused);
    learned.tried("big", Feature::Flat, Tried::Refused);
    learned.tried("small", Feature::Include, Tried::Refused);
    learned.tried("small", Feature::Effort, Tried::Works);
    assert_eq!(
        learned.shape_for("big"),
        Shape {
            effort: false,
            reasoning: true,
            namespaced: true
        }
    );
    assert_eq!(
        learned.shape_for("small"),
        Shape {
            effort: true,
            reasoning: false,
            namespaced: false
        }
    );
    assert_eq!(learned.shape_for("another"), Shape::default());
    assert!(learned.works("small", Feature::Effort) && !learned.refused("small", Feature::Effort));
}

#[test]
fn a_refusal_is_believed_for_two_weeks_and_what_works_is_not_doubted() {
    let learned = Learned::default();
    let now = oauth::now();
    let day = 24 * 3600;
    learned.record("m", Feature::Effort, Tried::Refused, now - 13 * day);
    learned.record("m", Feature::Include, Tried::Refused, now - 15 * day);
    learned.record("m", Feature::Flat, Tried::Works, now - 400 * day);
    assert!(learned.refused("m", Feature::Effort));
    assert!(!learned.refused("m", Feature::Include), "asked again");
    assert!(learned.works("m", Feature::Flat));
}

#[test]
fn facts_are_kept_for_the_account_they_were_found_for() {
    let dir = folder("owner");
    let first = Learned::default();
    first.keep_in(dir.clone());
    first.for_owner(Some("aaaa".to_owned()));
    first.tried("m", Feature::Effort, Tried::Refused);

    // A start later: the same account believes it at once.
    let second = Learned::default();
    second.keep_in(dir.clone());
    second.for_owner(Some("aaaa".to_owned()));
    assert!(second.refused("m", Feature::Effort));

    // Another account does not, and does not inherit the file.
    let other = Learned::default();
    other.keep_in(dir.clone());
    other.for_owner(Some("bbbb".to_owned()));
    assert!(!other.refused("m", Feature::Effort));
    other.tried("m", Feature::Include, Tried::Refused);
    let again = Learned::default();
    again.keep_in(dir.clone());
    again.for_owner(Some("aaaa".to_owned()));
    assert!(
        !again.refused("m", Feature::Effort),
        "the other account's file replaced it"
    );
    // Signing out forgets what was in memory.
    second.for_owner(None);
    assert!(!second.refused("m", Feature::Effort));
    // Only this test's own folder under the system temp folder.
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn without_an_account_nothing_is_written() {
    let dir = folder("nobody");
    let learned = Learned::default();
    learned.keep_in(dir.clone());
    learned.tried("m", Feature::Effort, Tried::Refused);
    assert!(learned.refused("m", Feature::Effort), "known for this run");
    assert!(!dir.join(FILE).exists());
}

#[test]
fn a_damaged_file_is_ignored() {
    let dir = folder("damaged");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "{ nope").unwrap();
    let learned = Learned::default();
    learned.keep_in(dir.clone());
    learned.for_owner(Some("aaaa".to_owned()));
    assert_eq!(learned.shape_for("m"), Shape::default());
    let _ = fs::remove_dir_all(&dir);
}
