//! The `backup` key of `.kasten/config.yaml`: how changes other computers
//! backed up are brought in. Keys this version does not know stay in the file
//! when it is written back.

use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::config_keys::Extra;

/// How often the backup is looked at for changes from other computers, in
/// minutes, when the setting is not made.
pub const DEFAULT_FETCH_MINUTES: u64 = 15;

/// What happens when the backup holds changes this computer lacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum GetLatest {
    /// Brought in by itself when that is safe: nothing here is waiting, no
    /// open page has unsaved edits, and no merge is needed.
    #[default]
    Auto,
    /// The person is told and decides.
    Ask,
    /// Only when asked for; the backup is not even looked at.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct BackupConfig {
    /// Minutes between looks at the backup; 0 turns the looking off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetch_interval: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub get_latest: Option<GetLatest>,
    /// How many of its own backup files each computer keeps (3 to 60).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_files: Option<u64>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Config {
    /// What to do with changes from other computers: automatically when
    /// safe, unless the vault says otherwise.
    pub fn get_latest_mode(&self) -> GetLatest {
        self.backup
            .as_ref()
            .and_then(|b| b.get_latest)
            .unwrap_or_default()
    }

    /// How many backup files this computer keeps: 7 unless the vault says
    /// otherwise, never fewer than 3 or more than 60.
    pub fn backup_files_kept(&self) -> usize {
        let wanted = self.backup.as_ref().and_then(|b| b.keep_files);
        wanted.map_or(7, |n| n.clamp(3, 60) as usize)
    }

    /// Minutes between looks at the backup; 0 means never.
    pub fn fetch_interval_minutes(&self) -> u64 {
        self.backup
            .as_ref()
            .and_then(|b| b.fetch_interval)
            .unwrap_or(DEFAULT_FETCH_MINUTES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const FULL: &str = "name: X\nbackup:\n  fetch_interval: 30\n  get_latest: ask\n  future: [1, 2]\n  later:\n    nested: true\n";

    fn parse(text: &str) -> Config {
        serde_saphyr::from_str(text).unwrap()
    }

    #[test]
    fn defaults_are_automatic_every_fifteen_minutes() {
        let config = parse("name: X\n");
        assert_eq!(config.get_latest_mode(), GetLatest::Auto);
        assert_eq!(config.fetch_interval_minutes(), 15);
        assert!(!serde_saphyr::to_string(&config).unwrap().contains("backup"));
        let partial = parse("backup:\n  get_latest: manual\n");
        assert_eq!(partial.get_latest_mode(), GetLatest::Manual);
        assert_eq!(partial.fetch_interval_minutes(), 15);
        assert_eq!(
            parse("backup:\n  fetch_interval: 0\n").fetch_interval_minutes(),
            0
        );
    }

    #[test]
    fn backup_files_kept_default_to_seven_and_stay_between_three_and_sixty() {
        assert_eq!(parse("name: X\n").backup_files_kept(), 7);
        let kept = |n: u64| parse(&format!("backup:\n  keep_files: {n}\n")).backup_files_kept();
        assert_eq!(
            (kept(1), kept(3), kept(30), kept(60), kept(500)),
            (3, 3, 30, 60, 60)
        );
    }

    #[test]
    fn reads_both_settings() {
        let config = parse(FULL);
        assert_eq!(config.get_latest_mode(), GetLatest::Ask);
        assert_eq!(config.fetch_interval_minutes(), 30);
    }

    #[test]
    fn unknown_keys_survive_a_round_trip_byte_stable() {
        let dir = std::env::temp_dir().join(format!("kasten-config-backup-{}", std::process::id()));
        let config = parse(FULL);
        config.save(&dir).unwrap();
        let first = fs::read(dir.join(".kasten/config.yaml")).unwrap();
        let text = String::from_utf8(first.clone()).unwrap();
        assert!(text.contains("future") && text.contains("later") && text.contains("nested"));
        let again = Config::load(&dir).unwrap();
        assert_eq!(again, config);
        again.save(&dir).unwrap();
        assert_eq!(fs::read(dir.join(".kasten/config.yaml")).unwrap(), first);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_setting_that_is_not_one_of_the_choices_is_an_error_not_a_panic() {
        let dir = std::env::temp_dir().join(format!("kasten-config-badget-{}", std::process::id()));
        fs::create_dir_all(dir.join(".kasten")).unwrap();
        fs::write(
            dir.join(".kasten/config.yaml"),
            "backup:\n  get_latest: sometimes\n",
        )
        .unwrap();
        let err = Config::load(&dir).unwrap_err();
        assert!(err.to_string().contains(".kasten/config.yaml"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }
}
