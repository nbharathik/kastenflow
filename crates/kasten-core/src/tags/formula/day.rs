//! Calendar days as a count since 1970-01-01, so the difference of two
//! days is a subtraction and nothing depends on the clock.

/// A calendar day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Day(pub i64);

fn leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn month_days(year: i64, month: i64) -> i64 {
    match month {
        2 if leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

impl std::fmt::Display for Day {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (y, m, d) = self.civil();
        write!(f, "{y:04}-{m:02}-{d:02}")
    }
}

impl Day {
    pub fn from_ymd(year: i64, month: i64, day: i64) -> Option<Day> {
        if !(1..=12).contains(&month) || !(1..=month_days(year, month)).contains(&day) {
            return None;
        }
        let y = if month <= 2 { year - 1 } else { year };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let shifted = if month > 2 { month - 3 } else { month + 9 };
        let doy = (153 * shifted + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Some(Day(era * 146_097 + doe - 719_468))
    }

    /// Year, month and day.
    pub fn civil(self) -> (i64, i64, i64) {
        let z = self.0 + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = yoe + era * 400 + i64::from(month <= 2);
        (year, month, day)
    }

    /// `YYYY-MM-DD`, alone or followed by a time (`T` or a space).
    pub fn parse(text: &str) -> Option<Day> {
        let text = text.trim();
        let b = text.as_bytes();
        if b.len() < 10 || (b.len() > 10 && !matches!(b[10], b'T' | b' ')) {
            return None;
        }
        let digits = |range: std::ops::Range<usize>| -> Option<i64> {
            let part = text.get(range)?;
            if !part.bytes().all(|c| c.is_ascii_digit()) {
                return None;
            }
            part.parse().ok()
        };
        if b[4] != b'-' || b[7] != b'-' {
            return None;
        }
        Day::from_ymd(digits(0..4)?, digits(5..7)?, digits(8..10)?)
    }
}
