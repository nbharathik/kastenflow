//! A vault inside a folder a sync app copies (OneDrive, Dropbox, Google
//! Drive, iCloud Drive and the like) is named, so Kasten warns before a
//! vault is made or opened there, and `verify` says so.

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::{Instant, Kasten, synced_by, ulid_at};

fn scratch() -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kasten-synced-{}", ulid_at(Instant::now().millis)));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn names_the_sync_app_by_the_folders_it_makes() {
    let cases = [
        ("/home/ada/OneDrive/Documents/Kasten", Some("OneDrive")),
        ("C:/Users/ada/OneDrive - Contoso/Kasten", Some("OneDrive")),
        (
            "/Users/ada/Library/CloudStorage/OneDrive-Personal/Kasten",
            Some("OneDrive"),
        ),
        ("/Users/ada/Dropbox/Kasten", Some("Dropbox")),
        (
            "/Users/ada/Dropbox (Personal)/Notes/Kasten",
            Some("Dropbox"),
        ),
        (
            "/Users/ada/Library/CloudStorage/Dropbox/Kasten",
            Some("Dropbox"),
        ),
        (
            "/Users/ada/Library/CloudStorage/GoogleDrive-ada@example.com/My Drive/Kasten",
            Some("Google Drive"),
        ),
        ("G:/My Drive/Kasten", Some("Google Drive")),
        ("/Users/ada/Google Drive/Kasten", Some("Google Drive")),
        (
            "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Kasten",
            Some("iCloud Drive"),
        ),
        ("C:/Users/ada/iCloudDrive/Kasten", Some("iCloud Drive")),
        (
            "/Users/ada/Library/CloudStorage/Box-Box/Kasten",
            Some("Box"),
        ),
        ("/home/ada/Nextcloud/Kasten", Some("Nextcloud")),
        (
            "/Users/ada/Library/CloudStorage/pCloudDrive/Kasten",
            Some("cloud storage"),
        ),
        // Names that only look alike are left alone.
        ("/home/ada/Documents/Kasten", None),
        ("/home/ada/notes/dropbox-export/Kasten", None),
        ("/home/ada/Notes about OneDrive/Kasten", None),
        ("/home/ada/Documents/my drive notes/Kasten", None),
        ("/home/ada/Library/Kasten", None),
    ];
    for (path, app) in cases {
        assert_eq!(synced_by(Path::new(path), None), app, "{path}");
    }
}

#[test]
fn a_mac_with_documents_in_icloud_syncs_the_documents_folder() {
    let home = scratch();
    let documents = home.join("Documents/Kasten");
    assert_eq!(synced_by(&documents, Some(&home)), None);
    // iCloud Drive keeps Desktop and Documents at their usual paths, and
    // holds them in its own folder.
    fs::create_dir_all(home.join("Library/Mobile Documents/com~apple~CloudDocs/Documents"))
        .unwrap();
    assert_eq!(synced_by(&documents, Some(&home)), Some("iCloud Drive"));
    assert_eq!(
        synced_by(&home.join("Documents"), Some(&home)),
        Some("iCloud Drive")
    );
    assert_eq!(synced_by(&home.join("Notes/Kasten"), Some(&home)), None);
    assert_eq!(synced_by(&home.join("Desktop/Kasten"), Some(&home)), None);
    let _ = fs::remove_dir_all(&home);
}

#[cfg(unix)]
#[test]
fn a_link_into_a_synced_folder_is_followed() {
    let dir = scratch();
    fs::create_dir_all(dir.join("Dropbox/Notes")).unwrap();
    std::os::unix::fs::symlink(dir.join("Dropbox/Notes"), dir.join("notes")).unwrap();
    // The vault's own folder need not exist yet.
    assert_eq!(synced_by(&dir.join("notes/Kasten"), None), Some("Dropbox"));
    assert_eq!(synced_by(&dir.join("elsewhere/Kasten"), None), None);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn verify_says_when_the_vault_is_in_a_synced_folder() {
    let dir = scratch();
    let inside = dir.join("Dropbox/Kasten");
    Kasten::init(&inside, "Kasten").unwrap();
    let report = Kasten::open(&inside).unwrap().verify().unwrap();
    let synced: Vec<_> = report
        .problems
        .iter()
        .filter(|p| p.kind == "synced")
        .collect();
    assert_eq!(synced.len(), 1, "{:?}", report.problems);
    assert!(synced[0].detail.contains("Dropbox"), "{}", synced[0].detail);
    assert!(synced[0].detail.contains("Backup"), "{}", synced[0].detail);
    assert!(
        synced[0]
            .detail
            .contains("which copies files while KastenFlow writes them"),
        "{}",
        synced[0].detail
    );

    let outside = dir.join("Notes/Kasten");
    Kasten::init(&outside, "Kasten").unwrap();
    let report = Kasten::open(&outside).unwrap().verify().unwrap();
    assert!(
        report.problems.iter().all(|p| p.kind != "synced"),
        "{:?}",
        report.problems
    );
    let _ = fs::remove_dir_all(&dir);
}
