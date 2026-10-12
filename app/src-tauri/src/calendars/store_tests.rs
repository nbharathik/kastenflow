//! The list, the keychain entry and the cached copy of each subscription, in
//! a scratch folder and an in-memory keychain.

use super::*;
use crate::secrets::MemoryKeys;

fn store(name: &str) -> Store {
    let root = std::env::temp_dir()
        .join(format!("kasten-calendars-{}", std::process::id()))
        .join(name);
    let _ = fs::remove_dir_all(&root);
    Store::new(
        root.join("config"),
        root.join("cache"),
        Arc::new(MemoryKeys::default()),
    )
}

fn entry(id: &str, name: &str) -> Entry {
    Entry {
        id: id.into(),
        name: name.into(),
        ..Entry::default()
    }
}

#[test]
fn the_list_is_kept_in_the_config_folder() {
    let store = store("list");
    assert!(store.list().unwrap().is_empty());
    store
        .update(|list| {
            list.push(entry("a1", "Work"));
            list.push(entry("b2", "Home"));
            Ok(())
        })
        .unwrap();
    let names: Vec<_> = store.list().unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["Work", "Home"]);
    assert!(store.config.join(LIST).exists());
    assert_eq!(store.entry("b2").unwrap().name, "Home");
    assert!(store.entry("zz").is_err());
    // A change that fails changes nothing.
    let failed: Result<(), String> = store.update(|list| {
        list.clear();
        Err("no".into())
    });
    assert!(failed.is_err());
    assert_eq!(store.list().unwrap().len(), 2);
}

#[test]
fn a_damaged_list_is_reported_and_left_alone() {
    let store = store("damaged");
    fs::create_dir_all(&store.config).unwrap();
    fs::write(store.config.join(LIST), "{ not json").unwrap();
    assert!(store.list().unwrap_err().contains("damaged"));
    assert!(
        store
            .update(|list| {
                list.push(entry("a", "x"));
                Ok(())
            })
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(store.config.join(LIST)).unwrap(),
        "{ not json"
    );
}

#[test]
fn changes_made_at_once_are_all_kept() {
    let store = store("together");
    let threads: Vec<_> = (0..8)
        .map(|n| {
            let store = store.clone();
            std::thread::spawn(move || {
                store
                    .update(|list| {
                        list.push(entry(&format!("c{n}"), "x"));
                        Ok(())
                    })
                    .unwrap();
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(store.list().unwrap().len(), 8);
}

#[test]
fn the_address_goes_in_the_keychain_and_nowhere_else() {
    let store = store("keys");
    let secret = "https://calendar.example.com/private-0123abcd/basic.ics";
    store.set_address("a1", secret).unwrap();
    assert_eq!(store.address("a1").unwrap(), secret);
    assert_eq!(
        store.keys().get("calendar @ a1").unwrap().as_deref(),
        Some(secret)
    );
    assert!(store.address("a2").is_err());
    store.forget_address("a1").unwrap();
    assert!(store.address("a1").is_err());
    // Nothing the store writes holds the address.
    store
        .update(|l| {
            l.push(entry("a1", "Work"));
            Ok(())
        })
        .unwrap();
    store
        .write_feed("a1", "BEGIN:VCALENDAR\nEND:VCALENDAR\n")
        .unwrap();
    for path in [store.config.join(LIST), store.feed_path("a1")] {
        assert!(!fs::read_to_string(path).unwrap().contains("0123abcd"));
    }
}

#[test]
fn the_copy_goes_in_the_cache_folder_and_is_dropped_with_it() {
    let store = store("cache");
    assert!(store.read_feed("a1").is_none());
    store
        .write_feed("a1", "BEGIN:VCALENDAR\nEND:VCALENDAR\n")
        .unwrap();
    let meta = Meta {
        validators: Validators {
            etag: Some("\"v1\"".into()),
            last_modified: None,
        },
        checked: Some(100),
        updated: Some(90),
        error: Some("offline".into()),
    };
    store.save_meta("a1", &meta).unwrap();
    assert_eq!(
        store.read_feed("a1").as_deref(),
        Some("BEGIN:VCALENDAR\nEND:VCALENDAR\n")
    );
    assert_eq!(store.meta("a1"), meta);
    assert!(store.cache_folder().join("a1.ics").exists());
    assert!(!store.cache_folder().starts_with(&store.config));
    store.drop_cache("a1");
    assert!(store.read_feed("a1").is_none());
    assert_eq!(store.meta("a1"), Meta::default());
    assert!(!store.cache_folder().join("a1.json").exists());
}

#[test]
fn an_id_from_outside_can_never_reach_another_file() {
    let store = store("ids");
    for bad in ["", "../x", "a/b", "a\\b", "a.b", &"a".repeat(33)] {
        assert!(!valid_id(bad), "{bad:?}");
        assert!(store.read_feed(bad).is_none());
        assert!(store.write_feed(bad, "x").is_err());
        assert!(store.address(bad).is_err());
    }
    assert!(valid_id("a1b2c3"));
    let id = store.new_id().unwrap();
    assert!(valid_id(&id) && id.len() == 12);
}
