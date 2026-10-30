//! `backup-now` sends notes only to an address this person agreed to on this
//! computer: a vault received from someone could name their server.

use std::path::{Path, PathBuf};
use std::process::Command;

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp(name: &str) -> Dir {
    Dir(std::env::temp_dir().join(format!(
        "kasten-cli-{name}-{}",
        kasten_core::ulid_at(kasten_core::Instant::now().millis)
    )))
}

fn kasten(config: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_kasten"))
        .args(args)
        .env_remove("KASTEN_VAULT")
        .env("KASTEN_CONFIG_DIR", config)
        .output()
        .unwrap()
}

fn text(out: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

fn set_remote(vault: &Path, remote: &Path) {
    let k = kasten_core::Kasten::open(vault).unwrap();
    let mut config = k.config();
    config.git.remote = Some(remote.to_str().unwrap().to_owned());
    k.set_config(config).unwrap();
}

fn has_main(remote: &Path) -> bool {
    git2::Repository::open_bare(remote)
        .unwrap()
        .refname_to_id("refs/heads/main")
        .is_ok()
}

#[test]
fn an_address_the_vault_names_is_not_sent_to_until_the_person_says_so() {
    let dir = temp("yes-vault");
    let config = temp("yes-config");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault"),
        &dir.0,
    );
    let vault = dir.0.to_str().unwrap();
    let remote = Dir(dir.0.with_extension("remote.git"));
    let other = Dir(dir.0.with_extension("other.git"));
    git2::Repository::init_bare(&remote.0).unwrap();
    git2::Repository::init_bare(&other.0).unwrap();
    assert!(
        kasten(&config.0, &["start-history", "--vault", vault])
            .status
            .success()
    );
    set_remote(&dir.0, &remote.0);

    // Not agreed to: nothing is sent, and the answer names the address.
    let out = kasten(&config.0, &["backup-now", "--vault", vault]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("--yes"), "{}", text(&out));
    assert!(
        text(&out).contains(remote.0.to_str().unwrap()),
        "{}",
        text(&out)
    );
    assert!(!has_main(&remote.0), "nothing was pushed");

    // Said once: it goes, and later runs need no flag.
    let out = kasten(&config.0, &["backup-now", "--vault", vault, "--yes"]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    assert!(has_main(&remote.0));
    let out = kasten(&config.0, &["backup-now", "--vault", vault]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));

    // The vault's settings change to another address: asked again.
    set_remote(&dir.0, &other.0);
    let out = kasten(&config.0, &["backup-now", "--vault", vault]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(!has_main(&other.0), "nothing was pushed to the new address");

    // Another computer's folder knows nothing of the first agreement.
    let elsewhere = temp("yes-elsewhere");
    set_remote(&dir.0, &remote.0);
    let out = kasten(&elsewhere.0, &["backup-now", "--vault", vault]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
}
