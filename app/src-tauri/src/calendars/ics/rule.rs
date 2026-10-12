//! A recurrence rule (`RRULE`, RFC 5545 §3.3.10) read from its text.

use super::civil::Local;
use super::time::{parse_date, parse_date_time};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Freq {
    Minutely,
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Where a series ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Until {
    /// A day, the whole of which still counts.
    Date(i64),
    /// A wall-clock time.
    Local(Local),
    /// A time in universal time.
    Utc(Local),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub freq: Freq,
    pub interval: u32,
    pub count: Option<u32>,
    pub until: Option<Until>,
    pub by_second: Vec<u32>,
    pub by_minute: Vec<u32>,
    pub by_hour: Vec<u32>,
    /// `(ordinal, weekday)`: the ordinal is 0 when every such weekday counts,
    /// weekdays count from Monday 0.
    pub by_day: Vec<(i32, u8)>,
    pub by_month_day: Vec<i32>,
    pub by_year_day: Vec<i32>,
    pub by_week_no: Vec<i32>,
    pub by_month: Vec<u8>,
    pub by_set_pos: Vec<i32>,
    /// The day weeks start on, Monday 0.
    pub wkst: u8,
}

const DAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

fn weekday(name: &str) -> Option<u8> {
    DAYS.iter()
        .position(|d| d.eq_ignore_ascii_case(name))
        .map(|i| i as u8)
}

/// Numbers separated by commas, each a whole number within `range` (and not 0
/// unless `zero` allows it).
fn numbers(text: &str, range: std::ops::RangeInclusive<i32>, zero: bool) -> Option<Vec<i32>> {
    text.split(',')
        .map(|n| {
            let n: i32 = n.trim().parse().ok()?;
            (range.contains(&n) && (zero || n != 0)).then_some(n)
        })
        .collect()
}

fn unsigned(text: &str, max: i32) -> Option<Vec<u32>> {
    let mut list = numbers(text, 0..=max, true)?;
    list.sort_unstable();
    list.dedup();
    Some(list.into_iter().map(|n| n as u32).collect())
}

fn by_day(text: &str) -> Option<Vec<(i32, u8)>> {
    text.split(',')
        .map(|part| {
            let part = part.trim();
            let split = part.len().checked_sub(2)?;
            if !part.is_char_boundary(split) {
                return None;
            }
            let (ordinal, name) = part.split_at(split);
            let day = weekday(name)?;
            let ordinal: i32 = if ordinal.is_empty() {
                0
            } else {
                ordinal.parse().ok()?
            };
            ((-53..=53).contains(&ordinal)).then_some((ordinal, day))
        })
        .collect()
}

fn until(text: &str) -> Option<Until> {
    let text = text.trim();
    if !text.contains(['T', 't']) {
        return parse_date(text).map(|d| Until::Date(d.day));
    }
    let (at, utc) = parse_date_time(text)?;
    Some(if utc {
        Until::Utc(at)
    } else {
        Until::Local(at)
    })
}

impl Rule {
    /// The rule `text` writes, or None when it is malformed or asks for
    /// something this calendar does not do (a rule that repeats every second).
    pub fn parse(text: &str) -> Option<Rule> {
        let mut rule = Rule {
            freq: Freq::Daily,
            interval: 1,
            count: None,
            until: None,
            by_second: Vec::new(),
            by_minute: Vec::new(),
            by_hour: Vec::new(),
            by_day: Vec::new(),
            by_month_day: Vec::new(),
            by_year_day: Vec::new(),
            by_week_no: Vec::new(),
            by_month: Vec::new(),
            by_set_pos: Vec::new(),
            wkst: 0,
        };
        let mut freq = None;
        for part in text.trim().trim_start_matches("RRULE:").split(';') {
            if part.trim().is_empty() {
                continue;
            }
            let (key, value) = part.split_once('=')?;
            let value = value.trim();
            match key.trim().to_ascii_uppercase().as_str() {
                "FREQ" => {
                    freq = Some(match value.to_ascii_uppercase().as_str() {
                        "MINUTELY" => Freq::Minutely,
                        "HOURLY" => Freq::Hourly,
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        _ => return None,
                    })
                }
                "INTERVAL" => rule.interval = value.parse().ok().filter(|n| *n >= 1)?,
                "COUNT" => rule.count = Some(value.parse().ok().filter(|n| *n >= 1)?),
                "UNTIL" => rule.until = Some(until(value)?),
                "BYSECOND" => {
                    rule.by_second = unsigned(value, 60)?
                        .into_iter()
                        .map(|s| s.min(59))
                        .collect()
                }
                "BYMINUTE" => rule.by_minute = unsigned(value, 59)?,
                "BYHOUR" => rule.by_hour = unsigned(value, 23)?,
                "BYDAY" => rule.by_day = by_day(value)?,
                "BYMONTHDAY" => rule.by_month_day = numbers(value, -31..=31, false)?,
                "BYYEARDAY" => rule.by_year_day = numbers(value, -366..=366, false)?,
                "BYWEEKNO" => rule.by_week_no = numbers(value, -53..=53, false)?,
                "BYMONTH" => {
                    rule.by_month = numbers(value, 1..=12, false)?
                        .into_iter()
                        .map(|m| m as u8)
                        .collect()
                }
                "BYSETPOS" => rule.by_set_pos = numbers(value, -366..=366, false)?,
                "WKST" => rule.wkst = weekday(value)?,
                // Other parts (such as X- extensions) change nothing here.
                _ => {}
            }
        }
        rule.freq = freq?;
        Some(rule)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_google_style_rule() {
        let rule = Rule::parse("FREQ=WEEKLY;WKST=SU;UNTIL=20261231T000000Z;BYDAY=MO,WE").unwrap();
        assert_eq!(rule.freq, Freq::Weekly);
        assert_eq!(rule.wkst, 6);
        assert_eq!(rule.by_day, [(0, 0), (0, 2)]);
        assert_eq!(
            rule.until,
            Some(Until::Utc(Local::new(2026, 12, 31, 0, 0, 0)))
        );
        assert_eq!(rule.interval, 1);
        assert_eq!(rule.count, None);
    }

    #[test]
    fn reads_ordinals_positions_and_lists() {
        let rule = Rule::parse(
            "freq=monthly;interval=2;count=10;byday=1SU,-1SU,+2MO;bymonthday=1,-1;bysetpos=-2;bymonth=1,12",
        )
        .unwrap();
        assert_eq!((rule.interval, rule.count), (2, Some(10)));
        assert_eq!(rule.by_day, [(1, 6), (-1, 6), (2, 0)]);
        assert_eq!(rule.by_month_day, [1, -1]);
        assert_eq!(rule.by_set_pos, [-2]);
        assert_eq!(rule.by_month, [1, 12]);
    }

    #[test]
    fn a_date_until_covers_that_whole_day() {
        let rule = Rule::parse("FREQ=DAILY;UNTIL=20261012").unwrap();
        assert_eq!(
            rule.until,
            Some(Until::Date(Local::new(2026, 10, 12, 0, 0, 0).day))
        );
        let rule = Rule::parse("FREQ=DAILY;UNTIL=20261012T090000").unwrap();
        assert_eq!(
            rule.until,
            Some(Until::Local(Local::new(2026, 10, 12, 9, 0, 0)))
        );
    }

    #[test]
    fn refuses_what_it_cannot_do_instead_of_guessing() {
        for bad in [
            "",
            "INTERVAL=2",
            "FREQ=SECONDLY",
            "FREQ=FORTNIGHTLY",
            "FREQ=DAILY;INTERVAL=0",
            "FREQ=DAILY;COUNT=x",
            "FREQ=WEEKLY;BYDAY=XX",
            "FREQ=MONTHLY;BYMONTHDAY=32",
            "FREQ=MONTHLY;BYMONTHDAY=0",
            "FREQ=YEARLY;BYMONTH=13",
            "FREQ=DAILY;UNTIL=soon",
            "FREQ=DAILY;BYHOUR=24",
            "garbage",
        ] {
            assert_eq!(Rule::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn extra_parts_are_ignored() {
        assert!(Rule::parse("FREQ=DAILY;X-FOO=bar;").is_some());
        assert!(Rule::parse("RRULE:FREQ=DAILY").is_some());
    }
}
