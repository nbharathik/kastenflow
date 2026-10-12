//! Days and times as notes write them: a day on the calendar
//! (`2026-10-07`, not `2026-02-30`), and the due day of a to-do with the
//! clock time that may follow it (`[[2026-10-07]] 09:00`, `@2026-10-07 9:05`).

use crate::extract::wiki_refs;

/// Days in `month` (1 to 12) of `year`, leap years counted.
pub(crate) fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        _ => 28,
    }
}

/// `YYYY-MM-DD` naming a day that exists: ASCII digits, a month from 1 to
/// 12, and a day the month has (February 29 only in a leap year).
pub fn is_real_day(s: &str) -> bool {
    let b = s.as_bytes();
    let shaped = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !shaped {
        return false;
    }
    let number = |from: usize, to: usize| {
        b[from..to]
            .iter()
            .fold(0u32, |n, c| n * 10 + u32::from(c - b'0'))
    };
    let (year, month, day) = (number(0, 4), number(5, 7), number(8, 10));
    year >= 1 && (1..=12).contains(&month) && day >= 1 && day <= days_in_month(year, month)
}

/// The 24-hour time `H:MM` or `HH:MM` that directly follows `text`'s start,
/// after at least one space or tab, as `HH:MM`. Nothing may be glued to it:
/// `9:05pm`, `09:00:30` and `25:00` are not times.
pub fn time_after(text: &str) -> Option<String> {
    let rest = text.trim_start_matches([' ', '\t']);
    if rest.len() == text.len() {
        return None;
    }
    let b = rest.as_bytes();
    let hour_digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
    if !(1..=2).contains(&hour_digits) || b.get(hour_digits) != Some(&b':') {
        return None;
    }
    let minutes = b.get(hour_digits + 1..hour_digits + 3)?;
    if !minutes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    // Everything before is ASCII, so this is a character boundary.
    let glued = rest[hour_digits + 3..]
        .chars()
        .next()
        .is_some_and(|c| c.is_alphanumeric() || c == ':');
    let number = |digits: &[u8]| {
        digits
            .iter()
            .fold(0u32, |n, c| n * 10 + u32::from(c - b'0'))
    };
    let (hour, minute) = (number(&b[..hour_digits]), number(minutes));
    (!glued && hour <= 23 && minute <= 59).then(|| format!("{hour:02}:{minute:02}"))
}

/// The first day a to-do names, and its time when one directly follows.
/// A `[[YYYY-MM-DD]]` link comes first, then `@YYYY-MM-DD`, then
/// `📅 YYYY-MM-DD` (which has no time). A date that is not on the
/// calendar is only text.
pub fn due_at(text: &str) -> Option<(String, Option<String>)> {
    for link in wiki_refs(text) {
        if is_real_day(&link.target) {
            return Some((link.target, time_after(&text[link.end..])));
        }
    }
    let mut rest = text;
    while let Some(at) = rest.find('@') {
        let after = &rest[at + 1..];
        if let Some(day) = after.get(..10).filter(|d| is_real_day(d)) {
            return Some((day.to_owned(), time_after(&after[10..])));
        }
        rest = after;
    }
    for marker in ["📅 ", "📅"] {
        let mut rest = text;
        while let Some(at) = rest.find(marker) {
            let after = &rest[at + marker.len()..];
            if let Some(day) = after.get(..10).filter(|d| is_real_day(d)) {
                return Some((day.to_owned(), None));
            }
            rest = after;
        }
    }
    None
}

/// The first day a to-do names.
pub fn due_date(text: &str) -> Option<String> {
    due_at(text).map(|(day, _)| day)
}

#[cfg(test)]
#[path = "dates_tests.rs"]
mod tests;
