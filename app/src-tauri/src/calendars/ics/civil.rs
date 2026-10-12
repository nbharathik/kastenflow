//! Calendar arithmetic on plain days and seconds. Recurrence is defined on
//! wall-clock dates and times, so it is done here, by counting, with no
//! library's edge cases in the way; time zones only come in at the edges
//! (`zones.rs`).

/// Whether `year` is a leap year.
pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// How many days `month` (1 to 12) of `year` has.
pub fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// How many days `year` has.
pub fn days_in_year(year: i32) -> i32 {
    if is_leap(year) { 366 } else { 365 }
}

/// Whether the year, month and day make a real date.
pub fn is_real(year: i32, month: u8, day: u8) -> bool {
    (1..=9999).contains(&year)
        && (1..=12).contains(&month)
        && day >= 1
        && day <= days_in_month(year, month)
}

/// Days since 1970-01-01 for a date (proleptic Gregorian).
pub fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The year, month and day of a day number (days since 1970-01-01).
pub fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year as i32, month as u8, day as u8)
}

/// The weekday of a day number, Monday 0 to Sunday 6.
pub fn weekday(days: i64) -> u8 {
    // 1970-01-01 was a Thursday.
    (days + 3).rem_euclid(7) as u8
}

/// The first day of the week (starting on `wkst`, Monday 0) that holds `days`.
pub fn week_start(days: i64, wkst: u8) -> i64 {
    days - i64::from((weekday(days) + 7 - wkst) % 7)
}

/// The first day of week 1 of `year`: weeks start on `wkst`, and week 1 is
/// the first with at least four days in the year, which is the one that
/// holds January 4.
pub fn first_week(year: i32, wkst: u8) -> i64 {
    week_start(days_from_civil(year, 1, 4), wkst)
}

/// The week-numbering year of a day and its week (1 or more) in it.
pub fn week_of(days: i64, wkst: u8) -> (i32, i32) {
    let (year, _, _) = civil_from_days(days);
    if days >= first_week(year + 1, wkst) {
        (
            year + 1,
            ((days - first_week(year + 1, wkst)) / 7) as i32 + 1,
        )
    } else if days < first_week(year, wkst) {
        (
            year - 1,
            ((days - first_week(year - 1, wkst)) / 7) as i32 + 1,
        )
    } else {
        (year, ((days - first_week(year, wkst)) / 7) as i32 + 1)
    }
}

/// How many weeks the week-numbering `year` has: 52 or 53.
pub fn weeks_in_year(year: i32, wkst: u8) -> i32 {
    ((first_week(year + 1, wkst) - first_week(year, wkst)) / 7) as i32
}

/// A wall-clock moment: a day and the seconds into it. It has no time zone;
/// what it means depends on the property it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Local {
    pub day: i64,
    pub sec: u32,
}

impl Local {
    pub fn new(year: i32, month: u8, day: u8, hour: u32, minute: u32, second: u32) -> Local {
        Local {
            day: days_from_civil(year, month, day),
            sec: hour * 3600 + minute * 60 + second,
        }
    }

    /// Midnight at the start of a day.
    pub fn midnight(day: i64) -> Local {
        Local { day, sec: 0 }
    }

    /// The seconds since 1970-01-01 00:00 if this were UTC.
    pub fn as_seconds(self) -> i64 {
        self.day * 86_400 + i64::from(self.sec)
    }

    pub fn from_seconds(seconds: i64) -> Local {
        Local {
            day: seconds.div_euclid(86_400),
            sec: seconds.rem_euclid(86_400) as u32,
        }
    }

    /// `(year, month, day)`.
    pub fn date(self) -> (i32, u8, u8) {
        civil_from_days(self.day)
    }

    /// `(hour, minute, second)`.
    pub fn time(self) -> (u32, u32, u32) {
        (self.sec / 3600, self.sec / 60 % 60, self.sec % 60)
    }

    /// `2026-10-12`.
    pub fn iso_day(self) -> String {
        iso_day(self.day)
    }

    /// `2026-10-12T14:30`.
    pub fn iso_minute(self) -> String {
        let (h, m, _) = self.time();
        format!("{}T{h:02}:{m:02}", self.iso_day())
    }

    /// `20261012T143000`, as a feed writes it.
    #[cfg(test)]
    pub fn compact(self) -> String {
        let (y, mo, d) = self.date();
        let (h, mi, s) = self.time();
        format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}")
    }
}

/// `2026-10-12` for a day number.
pub fn iso_day(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The day number of `2026-10-12` (or `20261012`), if it is a real day.
pub fn parse_iso_day(text: &str) -> Option<i64> {
    let digits: String = text.chars().filter(|c| *c != '-').collect();
    if digits.len() != 8 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year: i32 = digits[0..4].parse().ok()?;
    let month: u8 = digits[4..6].parse().ok()?;
    let day: u8 = digits[6..8].parse().ok()?;
    is_real(year, month, day).then(|| days_from_civil(year, month, day))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_and_dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        for day in (-700_000..2_900_000).step_by(997) {
            let (y, m, d) = civil_from_days(day);
            assert!(is_real(y, m, d), "{day}");
            assert_eq!(days_from_civil(y, m, d), day);
        }
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(days_in_month(1900, 2), 28);
        assert_eq!(days_in_month(2000, 2), 29);
    }

    #[test]
    fn weekdays_count_from_monday() {
        // 1997-09-02 was a Tuesday, 2026-10-12 a Monday, 1970-01-01 a Thursday.
        assert_eq!(weekday(days_from_civil(1997, 9, 2)), 1);
        assert_eq!(weekday(days_from_civil(2026, 10, 12)), 0);
        assert_eq!(weekday(0), 3);
        assert_eq!(weekday(days_from_civil(2026, 10, 18)), 6);
    }

    #[test]
    fn weeks_start_where_asked() {
        let tuesday = days_from_civil(1997, 8, 5);
        assert_eq!(week_start(tuesday, 0), days_from_civil(1997, 8, 4));
        assert_eq!(week_start(tuesday, 6), days_from_civil(1997, 8, 3));
        // A Monday starts its own week when weeks start on Monday.
        assert_eq!(
            week_start(days_from_civil(2026, 10, 12), 0),
            days_from_civil(2026, 10, 12)
        );
    }

    #[test]
    fn week_numbers_follow_the_four_day_rule() {
        // Monday weeks (ISO): 2024-12-30 is week 1 of 2025, 2021-01-03 is week 53 of 2020.
        assert_eq!(week_of(days_from_civil(2024, 12, 30), 0), (2025, 1));
        assert_eq!(week_of(days_from_civil(2021, 1, 3), 0), (2020, 53));
        assert_eq!(week_of(days_from_civil(1997, 5, 12), 0), (1997, 20));
        assert_eq!(weeks_in_year(2020, 0), 53);
        assert_eq!(weeks_in_year(2021, 0), 52);
    }

    #[test]
    fn wall_clock_moments_order_and_format() {
        let a = Local::new(2026, 10, 12, 9, 5, 0);
        let b = Local::new(2026, 10, 12, 14, 30, 59);
        assert!(a < b);
        assert_eq!(a.iso_minute(), "2026-10-12T09:05");
        assert_eq!(b.compact(), "20261012T143059");
        assert_eq!(Local::from_seconds(b.as_seconds()), b);
        assert_eq!(
            Local::from_seconds(-1),
            Local {
                day: -1,
                sec: 86_399
            }
        );
        assert_eq!(parse_iso_day("2026-10-12"), Some(a.day));
        assert_eq!(parse_iso_day("20261012"), Some(a.day));
        assert_eq!(parse_iso_day("2026-02-30"), None);
    }
}
