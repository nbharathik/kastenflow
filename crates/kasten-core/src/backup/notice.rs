//! When the person should hear that the backup is not working: after 6 hours
//! of failing, or when a push was refused three times. Judged from the
//! record of the tries and a clock that is passed in.

use serde::Serialize;

/// How long the backup must keep failing before the person is told.
pub const FAILING_FOR_MS: u64 = 6 * 60 * 60 * 1000;

/// How many refused pushes in a row are told.
pub const REFUSED_TIMES: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BackupNotice {
    /// Every try since `since` (milliseconds since the Unix epoch) failed.
    Failing { since: u64 },
    /// The backup refused the last `times` pushes because it has changes
    /// this computer lacks: get the latest.
    Refused { times: u32 },
}

impl BackupNotice {
    /// What to tell, if anything: `failing_since` is when the current run of
    /// failures began, `refused` how many pushes in a row were refused.
    pub fn judge(
        failing_since: Option<u64>,
        failures: u32,
        refused: u32,
        now: u64,
    ) -> Option<BackupNotice> {
        if refused >= REFUSED_TIMES {
            return Some(BackupNotice::Refused { times: refused });
        }
        let since = failing_since.filter(|_| failures > 0)?;
        (now.saturating_sub(since) >= FAILING_FOR_MS).then_some(BackupNotice::Failing { since })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: u64 = 60 * 60 * 1000;

    #[test]
    fn six_hours_of_failing_is_told() {
        let judge = |since, failures, now| BackupNotice::judge(since, failures, 0, now);
        assert_eq!(judge(Some(0), 3, 6 * HOUR - 1), None);
        assert_eq!(
            judge(Some(0), 3, 6 * HOUR),
            Some(BackupNotice::Failing { since: 0 })
        );
        // No failures now, or no start recorded: nothing to tell.
        assert_eq!(judge(Some(0), 0, 9 * HOUR), None);
        assert_eq!(judge(None, 4, 9 * HOUR), None);
        // A clock that went back does not tell.
        assert_eq!(judge(Some(10 * HOUR), 2, HOUR), None);
    }

    #[test]
    fn three_refusals_are_told_whatever_the_clock_says() {
        assert_eq!(BackupNotice::judge(Some(0), 2, 2, 0), None);
        assert_eq!(
            BackupNotice::judge(Some(0), 3, 3, 0),
            Some(BackupNotice::Refused { times: 3 })
        );
        assert_eq!(
            BackupNotice::judge(Some(0), 9, 5, 7 * HOUR),
            Some(BackupNotice::Refused { times: 5 })
        );
    }
}
