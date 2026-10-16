//! Reading calendar feeds (iCalendar, RFC 5545), with no calendar library:
//! the parser, dates and durations, repeating events, and time zones
//! (through `jiff`, with Outlook's Windows names mapped to the IANA ones).

pub mod civil;
pub mod expand;
mod future;
pub mod parse;
pub mod recur;
pub mod rule;
pub mod time;
pub mod windows_zones;
pub mod zones;

#[cfg(test)]
mod feed_tests;
#[cfg(test)]
mod future_tests;
#[cfg(test)]
mod rfc_tests;

use expand::{Expanded, Window, expand};
use parse::Feed;
use zones::{Zones, viewer_zone};

/// The most days one request may cover.
pub const MAX_DAYS: i64 = 400;
/// The most occurrences one request returns.
pub const MAX_OCCURRENCES: usize = 5_000;

/// The occurrences on the days from `from` to `to` (`2026-10-12`, both
/// included), on the clock of the zone called `zone` (the system's when it is
/// not given or not known).
pub fn events_between(
    feed: &Feed,
    from: &str,
    to: &str,
    zone: Option<&str>,
) -> Result<Expanded, String> {
    let (Some(from), Some(to)) = (civil::parse_iso_day(from), civil::parse_iso_day(to)) else {
        return Err("Ask for days like 2026-10-12".into());
    };
    if to < from {
        return Err("The range ends before it starts".into());
    }
    if to - from + 1 > MAX_DAYS {
        return Err(format!("Ask for at most {MAX_DAYS} days at a time"));
    }
    let zones = Zones::new(feed.zones.clone(), viewer_zone(zone));
    Ok(expand(feed, &zones, Window { from, to }, MAX_OCCURRENCES))
}
