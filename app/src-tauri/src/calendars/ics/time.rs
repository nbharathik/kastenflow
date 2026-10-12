//! The dates, times and durations of an iCalendar feed (RFC 5545 §3.3):
//! what a property's text says, before any time zone is applied.

use super::civil::{Local, days_from_civil, is_real};

/// What a time is counted in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    /// A whole day, no time (`VALUE=DATE`).
    Date,
    /// A wall-clock time that means the same on any clock: the viewer's.
    Floating,
    /// Universal time (`...Z`).
    Utc,
    /// A time zone named by its `TZID`, as the feed wrote it.
    Zone(String),
}

/// A date or date-time property value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct When {
    pub frame: Frame,
    /// For a date, the start of the day.
    pub at: Local,
}

impl When {
    /// The same kind of time at another wall-clock moment.
    pub fn with_at(&self, at: Local) -> When {
        When {
            frame: self.frame.clone(),
            at,
        }
    }

    pub fn is_date(&self) -> bool {
        self.frame == Frame::Date
    }
}

/// A length of time: days (nominal) and seconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Duration {
    pub days: i64,
    pub seconds: i64,
}

impl Duration {
    pub fn total_seconds(self) -> i64 {
        self.days * 86_400 + self.seconds
    }
}

fn digits(text: &str) -> Option<u32> {
    (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

/// `20261012` (or `2026-10-12`), a real day.
pub fn parse_date(text: &str) -> Option<Local> {
    let text = text.trim();
    let compact: String = text.chars().filter(|c| *c != '-').collect();
    if compact.len() != 8 {
        return None;
    }
    let year = i32::try_from(digits(&compact[0..4])?).ok()?;
    let month = u8::try_from(digits(&compact[4..6])?).ok()?;
    let day = u8::try_from(digits(&compact[6..8])?).ok()?;
    is_real(year, month, day).then(|| Local::midnight(days_from_civil(year, month, day)))
}

/// `20261012T143000` or `20261012T143000Z`: the moment and whether it ends in
/// `Z`. The seconds may be left off; a leap second counts as 59.
pub fn parse_date_time(text: &str) -> Option<(Local, bool)> {
    let text = text.trim();
    let (body, utc) = match text.strip_suffix(['Z', 'z']) {
        Some(body) => (body, true),
        None => (text, false),
    };
    let (date, time) = body.split_once(['T', 't'])?;
    let day = parse_date(date)?;
    let time: String = time.chars().filter(|c| *c != ':').collect();
    if time.len() != 6 && time.len() != 4 {
        return None;
    }
    let hour = digits(&time[0..2])?;
    let minute = digits(&time[2..4])?;
    let second = if time.len() == 6 {
        digits(&time[4..6])?.min(59)
    } else {
        0
    };
    if hour > 23 || minute > 59 {
        return None;
    }
    Some((
        Local {
            day: day.day,
            sec: hour * 3600 + minute * 60 + second,
        },
        utc,
    ))
}

/// A property's time: a date (when `VALUE=DATE` or no time is given), a time
/// in universal time, in the zone `tzid` names, or floating.
pub fn parse_when(value: &str, tzid: Option<&str>, value_type: Option<&str>) -> Option<When> {
    let value = value.trim();
    let wants_date = value_type.is_some_and(|t| t.eq_ignore_ascii_case("DATE"));
    if wants_date || (!value.contains(['T', 't'])) {
        return parse_date(value).map(|at| When {
            frame: Frame::Date,
            at,
        });
    }
    let (at, utc) = parse_date_time(value)?;
    let frame = match tzid.map(|t| t.trim().trim_matches('"')) {
        _ if utc => Frame::Utc,
        Some(zone) if !zone.is_empty() => Frame::Zone(zone.to_owned()),
        _ => Frame::Floating,
    };
    Some(When { frame, at })
}

/// `PT1H30M`, `P1D`, `P2W`, `-PT15M`, `P1DT12H`.
pub fn parse_duration(text: &str) -> Option<Duration> {
    let text = text.trim();
    let (negative, rest) = match text.as_bytes().first()? {
        b'-' => (true, &text[1..]),
        b'+' => (false, &text[1..]),
        _ => (false, text),
    };
    let rest = rest.strip_prefix(['P', 'p'])?;
    let (mut days, mut seconds) = (0i64, 0i64);
    let mut number = String::new();
    let mut in_time = false;
    let mut any = false;
    for c in rest.chars() {
        match c.to_ascii_uppercase() {
            'T' => in_time = true,
            d if d.is_ascii_digit() => number.push(d),
            unit @ ('W' | 'D' | 'H' | 'M' | 'S') => {
                // A number no real event has: a feed may write any, and the
                // sums below must never overflow.
                let n: i64 = number.parse().ok().filter(|n| *n <= 1_000_000)?;
                number.clear();
                any = true;
                match (unit, in_time) {
                    ('W', false) => days += n * 7,
                    ('D', false) => days += n,
                    ('H', true) => seconds += n * 3600,
                    ('M', true) => seconds += n * 60,
                    ('S', true) => seconds += n,
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
    if !number.is_empty() || !any {
        return None;
    }
    let sign = if negative { -1 } else { 1 };
    Some(Duration {
        days: sign * days,
        seconds: sign * seconds,
    })
}

/// `+0100`, `-0800`, `+013000`: an offset from universal time, in seconds.
pub fn parse_offset(text: &str) -> Option<i32> {
    let text = text.trim();
    let sign = match text.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let rest = &text[1..];
    if rest.len() != 4 && rest.len() != 6 {
        return None;
    }
    let hours = i32::try_from(digits(&rest[0..2])?).ok()?;
    let minutes = i32::try_from(digits(&rest[2..4])?).ok()?;
    let seconds = if rest.len() == 6 {
        i32::try_from(digits(&rest[4..6])?).ok()?
    } else {
        0
    };
    Some(sign * (hours * 3600 + minutes * 60 + seconds))
}

/// A text value as the feed wrote it: `\n`, `\,`, `\;` and `\\` undone.
pub fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_dates_and_times() {
        assert_eq!(
            parse_date("20261012"),
            Some(Local::new(2026, 10, 12, 0, 0, 0))
        );
        assert_eq!(
            parse_date("2026-10-12"),
            Some(Local::new(2026, 10, 12, 0, 0, 0))
        );
        assert_eq!(parse_date("20260230"), None);
        assert_eq!(parse_date("2026101"), None);
        assert_eq!(
            parse_date_time("20261012T143000Z"),
            Some((Local::new(2026, 10, 12, 14, 30, 0), true))
        );
        assert_eq!(
            parse_date_time("20261012T1430"),
            Some((Local::new(2026, 10, 12, 14, 30, 0), false))
        );
        // A leap second is kept inside the minute; nonsense is refused.
        assert_eq!(
            parse_date_time("20161231T235960Z"),
            Some((Local::new(2016, 12, 31, 23, 59, 59), true))
        );
        assert_eq!(parse_date_time("20261012T250000"), None);
        assert_eq!(parse_date_time("20261012"), None);
    }

    #[test]
    fn a_property_value_is_a_date_utc_zoned_or_floating() {
        let day = Local::new(2026, 10, 12, 0, 0, 0);
        let at = Local::new(2026, 10, 12, 9, 0, 0);
        assert_eq!(
            parse_when("20261012", Some("Europe/Paris"), Some("DATE")),
            Some(When {
                frame: Frame::Date,
                at: day
            })
        );
        // No time given at all: still a date.
        assert_eq!(
            parse_when("20261012", None, None).map(|w| w.frame),
            Some(Frame::Date)
        );
        assert_eq!(
            parse_when("20261012T090000Z", Some("Europe/Paris"), None),
            Some(When {
                frame: Frame::Utc,
                at
            })
        );
        assert_eq!(
            parse_when("20261012T090000", Some("Europe/Paris"), None),
            Some(When {
                frame: Frame::Zone("Europe/Paris".into()),
                at
            })
        );
        assert_eq!(
            parse_when("20261012T090000", Some("\"Pacific Standard Time\""), None).map(|w| w.frame),
            Some(Frame::Zone("Pacific Standard Time".into()))
        );
        assert_eq!(
            parse_when("20261012T090000", None, None),
            Some(When {
                frame: Frame::Floating,
                at
            })
        );
        assert_eq!(parse_when("tomorrow", None, None), None);
    }

    #[test]
    fn reads_durations() {
        let d = |days, seconds| Some(Duration { days, seconds });
        assert_eq!(parse_duration("PT1H30M"), d(0, 5400));
        assert_eq!(parse_duration("P1D"), d(1, 0));
        assert_eq!(parse_duration("P2W"), d(14, 0));
        assert_eq!(parse_duration("P1DT12H"), d(1, 43_200));
        assert_eq!(parse_duration("-PT15M"), d(0, -900));
        assert_eq!(parse_duration("PT0S"), d(0, 0));
        // Numbers that would overflow a sum are refused, not wrapped.
        for huge in ["P9999999999999999D", "PT99999999999999S", "P1000001W"] {
            assert_eq!(parse_duration(huge), None, "{huge}");
        }
        assert!(parse_duration("P1000000W").is_some());
        for bad in ["", "P", "PT", "1H", "P1H", "PT1D", "P1", "PTxH"] {
            assert_eq!(parse_duration(bad), None, "{bad}");
        }
        assert_eq!(
            parse_duration("P1DT2H").map(Duration::total_seconds),
            Some(93_600)
        );
    }

    #[test]
    fn reads_offsets() {
        assert_eq!(parse_offset("+0100"), Some(3600));
        assert_eq!(parse_offset("-0800"), Some(-28_800));
        assert_eq!(parse_offset("+053000"), Some(19_800));
        assert_eq!(parse_offset("0100"), None);
        assert_eq!(parse_offset("+1"), None);
    }

    #[test]
    fn unescapes_text() {
        assert_eq!(
            unescape(r"a\, b\; c\\d\nline two\N"),
            "a, b; c\\d\nline two\n"
        );
        assert_eq!(unescape("trailing\\"), "trailing\\");
    }
}
