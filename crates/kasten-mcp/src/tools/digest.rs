//! `activity_digest`: what agents did lately, session by session, from the
//! history alone. It changes nothing.

use kasten_core::{Error, Instant, Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use crate::params_parity::ActivityDigestArgs;

const DAY_MS: u64 = 86_400_000;
const HOUR_MS: u64 = 3_600_000;

const SINCE_HELP: &str = "`since` is a span like 24h or 3d, `today`, a day like 2026-10-23, or a time like 2026-10-23T08:00:00Z (all UTC)";

pub(crate) fn activity_digest(k: &Kasten, a: ActivityDigestArgs) -> Result<Value> {
    let since = parse_since(a.since.as_deref(), Instant::now().millis)?;
    let digest = k.activity_digest(since)?;
    let mut out = as_json(&digest)?;
    out["sinceTime"] = json!(Instant { millis: since }.rfc3339());
    if digest.sessions.is_empty() {
        out["message"] = json!("No agent changes in this time.");
    }
    Ok(out)
}

/// The window's start in milliseconds since the Unix epoch: the last 24 hours
/// when none is given.
pub(crate) fn parse_since(text: Option<&str>, now: u64) -> Result<u64> {
    let Some(text) = text else {
        return Ok(now.saturating_sub(DAY_MS));
    };
    let text = text.trim();
    let bad = || {
        Error::Invalid(format!(
            "Not a time to look back to: “{text}”. {SINCE_HELP}."
        ))
    };
    if text == "today" {
        return Ok(now - now % DAY_MS);
    }
    if let Some((digits, unit)) = text
        .strip_suffix('h')
        .map(|d| (d, HOUR_MS))
        .or_else(|| text.strip_suffix('d').map(|d| (d, DAY_MS)))
    {
        if digits.is_empty() || digits.len() > 5 || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Err(bad());
        }
        let n: u64 = digits.parse().map_err(|_| bad())?;
        return Ok(now.saturating_sub(n * unit));
    }
    let (day, clock) = match text.len() {
        10 => (text, ""),
        20 if text.as_bytes()[10] == b'T' && text.ends_with('Z') => (&text[..10], &text[11..19]),
        _ => return Err(bad()),
    };
    let day_ms = day_start(day).ok_or_else(bad)?;
    Ok(day_ms + clock_ms(clock).ok_or_else(bad)?)
}

fn number(text: &str) -> Option<i64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// `YYYY-MM-DD` as the start of that UTC day.
fn day_start(day: &str) -> Option<u64> {
    let mut parts = day.split('-');
    let (y, m, d) = (
        number(parts.next()?)?,
        number(parts.next()?)?,
        number(parts.next()?)?,
    );
    if parts.next().is_some() || day.len() != 10 || !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let longest = match m {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if d > longest || y < 1 {
        return None;
    }
    // Howard Hinnant's civil-to-days algorithm.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(u64::try_from(days).unwrap_or(0) * DAY_MS)
}

/// `HH:MM:SS` as milliseconds into the day (nothing is no time).
fn clock_ms(clock: &str) -> Option<u64> {
    if clock.is_empty() {
        return Some(0);
    }
    let mut parts = clock.split(':');
    let (h, m, s) = (
        number(parts.next()?)?,
        number(parts.next()?)?,
        number(parts.next()?)?,
    );
    if parts.next().is_some() || h > 23 || m > 59 || s > 59 {
        return None;
    }
    Some(u64::try_from(h * 3600 + m * 60 + s).ok()? * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-10-23T10:30:00Z
    const NOW: u64 = 1_792_751_400_000;

    #[test]
    fn spans_days_and_times_are_read_as_utc() {
        assert_eq!(parse_since(None, NOW).unwrap(), NOW - DAY_MS);
        assert_eq!(parse_since(Some("3h"), NOW).unwrap(), NOW - 3 * HOUR_MS);
        assert_eq!(parse_since(Some("2d"), NOW).unwrap(), NOW - 2 * DAY_MS);
        assert_eq!(
            Instant {
                millis: parse_since(Some("today"), NOW).unwrap()
            }
            .rfc3339(),
            "2026-10-23T00:00:00Z"
        );
        assert_eq!(
            Instant {
                millis: parse_since(Some("2026-10-23"), NOW).unwrap()
            }
            .rfc3339(),
            "2026-10-23T00:00:00Z"
        );
        assert_eq!(
            Instant {
                millis: parse_since(Some("2000-02-29T08:15:30Z"), NOW).unwrap()
            }
            .rfc3339(),
            "2000-02-29T08:15:30Z"
        );
        assert_eq!(parse_since(Some("0h"), NOW).unwrap(), NOW);
        // A span longer than the vault is old gives the start of time.
        assert_eq!(parse_since(Some("99999d"), NOW).unwrap(), 0);
    }

    #[test]
    fn anything_else_is_refused_with_the_forms_that_work() {
        for bad in [
            "",
            " ",
            "12",
            "h",
            "-5h",
            "5 h",
            "yesterday",
            "2026-13-01",
            "2026-02-30",
            "2026-1-1",
            "2026-10-23T25:00:00Z",
            "2026-10-23 10:00:00Z",
            "2026-10-23T10:00:00",
            "1900-02-29",
            "0000-01-01",
            "2026-10-23x",
        ] {
            let err = parse_since(Some(bad), NOW).unwrap_err().to_string();
            assert!(err.contains("`since` is a span like 24h"), "{bad:?}: {err}");
        }
    }
}
