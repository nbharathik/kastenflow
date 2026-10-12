//! Expands a recurrence rule into the wall-clock moments it describes, in
//! order (RFC 5545 §3.3.10 and §3.8.5.3). Every `FREQ` period is expanded to
//! its candidate days and times by the `BY` parts, `BYSETPOS` then picks from
//! them, and the ones before the start are dropped. `COUNT` counts what this
//! produces; `UNTIL` is the caller's to check, since it may be in universal
//! time. A series that has to be iterated a very long way is cut off.

use super::civil::{
    Local, civil_from_days, days_from_civil, days_in_month, days_in_year, first_week, week_of,
    week_start, weekday, weeks_in_year,
};
use super::rule::{Freq, Rule};

/// The most periods one series is iterated through.
const MAX_PERIODS: u64 = 400_000;
/// The last year that is generated.
const LAST_YEAR: i32 = 9999;

/// The rule with the defaults the start time implies.
struct Plan<'a> {
    rule: &'a Rule,
    start: Local,
    interval: i64,
    months: Vec<u8>,
    month_days: Vec<i32>,
    weekdays: Vec<(i32, u8)>,
    /// Seconds of the day each period's days are combined with.
    times: Vec<u32>,
    hours: Vec<u32>,
    minutes: Vec<u32>,
    seconds: Vec<u32>,
    /// A weekday's ordinal counts within the month, not the year.
    ordinal_in_month: bool,
}

fn or_start(list: &[u32], start: u32) -> Vec<u32> {
    if list.is_empty() {
        vec![start]
    } else {
        list.to_vec()
    }
}

impl<'a> Plan<'a> {
    fn new(rule: &'a Rule, start: Local) -> Plan<'a> {
        let (_, start_month, start_day) = start.date();
        let (h, m, s) = start.time();
        let mut months = rule.by_month.clone();
        let mut month_days = rule.by_month_day.clone();
        let mut weekdays = rule.by_day.clone();
        if rule.by_week_no.is_empty()
            && rule.by_year_day.is_empty()
            && month_days.is_empty()
            && weekdays.is_empty()
        {
            match rule.freq {
                Freq::Yearly => {
                    if months.is_empty() {
                        months.push(start_month);
                    }
                    month_days.push(i32::from(start_day));
                }
                Freq::Monthly => month_days.push(i32::from(start_day)),
                Freq::Weekly => weekdays.push((0, weekday(start.day))),
                _ => {}
            }
        }
        let hours = or_start(&rule.by_hour, h);
        let minutes = or_start(&rule.by_minute, m);
        let seconds = or_start(&rule.by_second, s);
        let mut times = Vec::new();
        for h in &hours {
            for m in &minutes {
                for s in &seconds {
                    times.push(h * 3600 + m * 60 + s);
                }
            }
        }
        times.sort_unstable();
        times.dedup();
        Plan {
            rule,
            start,
            interval: i64::from(rule.interval),
            ordinal_in_month: matches!(rule.freq, Freq::Monthly)
                || (matches!(rule.freq, Freq::Yearly) && !months.is_empty()),
            months,
            month_days,
            weekdays,
            times,
            hours,
            minutes,
            seconds,
        }
    }

    /// Whether `day` passes every day filter of the rule.
    fn day_ok(&self, day: i64) -> bool {
        let (year, month, dom) = civil_from_days(day);
        if !self.months.is_empty() && !self.months.contains(&month) {
            return false;
        }
        let wkst = self.rule.wkst;
        if !self.rule.by_week_no.is_empty() {
            let (week_year, week) = week_of(day, wkst);
            let last = weeks_in_year(week_year, wkst);
            if !self
                .rule
                .by_week_no
                .iter()
                .any(|&n| n == week || (n < 0 && last + 1 + n == week))
            {
                return false;
            }
        }
        if !self.rule.by_year_day.is_empty() {
            let of_year = (day - days_from_civil(year, 1, 1)) as i32 + 1;
            let last = days_in_year(year);
            if !self
                .rule
                .by_year_day
                .iter()
                .any(|&n| n == of_year || (n < 0 && last + 1 + n == of_year))
            {
                return false;
            }
        }
        if !self.month_days.is_empty() {
            let last = i32::from(days_in_month(year, month));
            let dom = i32::from(dom);
            if !self
                .month_days
                .iter()
                .any(|&n| n == dom || (n < 0 && last + 1 + n == dom))
            {
                return false;
            }
        }
        if !self.weekdays.is_empty() {
            let wd = weekday(day);
            if !self
                .weekdays
                .iter()
                .any(|&(ordinal, w)| w == wd && self.ordinal_ok(ordinal, day, year, month, dom))
            {
                return false;
            }
        }
        true
    }

    /// Whether `day` is the `ordinal`th such weekday of its month or year.
    /// Only monthly and yearly rules count by ordinal.
    fn ordinal_ok(&self, ordinal: i32, day: i64, year: i32, month: u8, dom: u8) -> bool {
        if ordinal == 0 || !matches!(self.rule.freq, Freq::Monthly | Freq::Yearly) {
            return true;
        }
        let (index, from_end) = if self.ordinal_in_month {
            let last = i32::from(days_in_month(year, month));
            (
                (i32::from(dom) - 1) / 7 + 1,
                -((last - i32::from(dom)) / 7 + 1),
            )
        } else {
            let of_year = (day - days_from_civil(year, 1, 1)) as i32;
            (
                of_year / 7 + 1,
                -((days_in_year(year) - 1 - of_year) / 7 + 1),
            )
        };
        ordinal == index || ordinal == from_end
    }

    /// Every period of the rule after the first `skip`, as the days it spans.
    /// None after the last year there is.
    fn days_of(&self, period: i64) -> Option<(i64, i64)> {
        let (start_year, start_month, _) = self.start.date();
        let span = match self.rule.freq {
            Freq::Yearly => {
                let year = i64::from(start_year) + period * self.interval;
                if year > i64::from(LAST_YEAR) {
                    return None;
                }
                let year = year as i32;
                if self.rule.by_week_no.is_empty() {
                    Some((days_from_civil(year, 1, 1), days_from_civil(year + 1, 1, 1)))
                } else {
                    // Week numbers count within the week-numbering year, which
                    // may begin in the December before.
                    let wkst = self.rule.wkst;
                    Some((first_week(year, wkst), first_week(year + 1, wkst)))
                }
            }
            Freq::Monthly => {
                let months = i64::from(start_year) * 12
                    + i64::from(start_month - 1)
                    + period * self.interval;
                let (year, month) = (months.div_euclid(12), months.rem_euclid(12) as u8 + 1);
                if year > i64::from(LAST_YEAR) {
                    return None;
                }
                let first = days_from_civil(year as i32, month, 1);
                Some((first, first + i64::from(days_in_month(year as i32, month))))
            }
            Freq::Weekly => {
                let first = week_start(self.start.day, self.rule.wkst) + 7 * period * self.interval;
                Some((first, first + 7))
            }
            Freq::Daily => {
                let day = self.start.day + period * self.interval;
                Some((day, day + 1))
            }
            Freq::Hourly | Freq::Minutely => None,
        };
        span.filter(|(from, _)| civil_from_days(*from).0 <= LAST_YEAR)
    }

    /// The candidates of one period, in order, before `BYSETPOS`.
    fn period(&self, period: i64) -> Option<Vec<Local>> {
        let mut found = Vec::new();
        match self.rule.freq {
            Freq::Hourly => {
                let hours =
                    self.start.day * 24 + i64::from(self.start.sec / 3600) + period * self.interval;
                let (day, hour) = (hours.div_euclid(24), hours.rem_euclid(24) as u32);
                if civil_from_days(day).0 > LAST_YEAR {
                    return None;
                }
                if self.day_ok(day) && (self.rule.by_hour.is_empty() || self.hours.contains(&hour))
                {
                    for m in &self.minutes {
                        for s in &self.seconds {
                            found.push(Local {
                                day,
                                sec: hour * 3600 + m * 60 + s,
                            });
                        }
                    }
                }
            }
            Freq::Minutely => {
                let minutes =
                    self.start.day * 1440 + i64::from(self.start.sec / 60) + period * self.interval;
                let (day, of_day) = (minutes.div_euclid(1440), minutes.rem_euclid(1440) as u32);
                if civil_from_days(day).0 > LAST_YEAR {
                    return None;
                }
                let (hour, minute) = (of_day / 60, of_day % 60);
                if self.day_ok(day)
                    && (self.rule.by_hour.is_empty() || self.hours.contains(&hour))
                    && (self.rule.by_minute.is_empty() || self.minutes.contains(&minute))
                {
                    for s in &self.seconds {
                        found.push(Local {
                            day,
                            sec: of_day * 60 + s,
                        });
                    }
                }
            }
            _ => {
                let (from, to) = self.days_of(period)?;
                for day in from..to {
                    if self.day_ok(day) {
                        found.extend(self.times.iter().map(|&sec| Local { day, sec }));
                    }
                }
            }
        }
        Some(pick(found, &self.rule.by_set_pos))
    }

    /// How many periods can be skipped without missing anything at or after
    /// `floor`; a little short of the exact count, to be safe.
    fn skippable(&self, floor: Local) -> i64 {
        if floor <= self.start {
            return 0;
        }
        let (start_year, start_month, _) = self.start.date();
        let (floor_year, floor_month, _) = floor.date();
        let gone = match self.rule.freq {
            Freq::Yearly => i64::from(floor_year - start_year),
            Freq::Monthly => {
                i64::from(floor_year - start_year) * 12 + i64::from(floor_month)
                    - i64::from(start_month)
            }
            Freq::Weekly => {
                (week_start(floor.day, self.rule.wkst) - week_start(self.start.day, self.rule.wkst))
                    / 7
            }
            Freq::Daily => floor.day - self.start.day,
            Freq::Hourly => (floor.as_seconds() - self.start.as_seconds()) / 3600,
            Freq::Minutely => (floor.as_seconds() - self.start.as_seconds()) / 60,
        };
        (gone / self.interval - 2).max(0)
    }
}

/// The candidates at the `BYSETPOS` positions (1 is the first, -1 the last),
/// or all of them when there are none.
fn pick(list: Vec<Local>, positions: &[i32]) -> Vec<Local> {
    if positions.is_empty() {
        return list;
    }
    let len = list.len() as i32;
    let mut out: Vec<Local> = positions
        .iter()
        .filter_map(|&p| {
            let index = if p > 0 { p - 1 } else { len + p };
            (0..len).contains(&index).then(|| list[index as usize])
        })
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// Calls `visit` with each moment the rule gives from `start` on, in order,
/// until it returns false or the rule ends by `COUNT`. With a `floor`, a
/// series without `COUNT` may skip ahead, so moments well before it are not
/// visited.
pub fn each(rule: &Rule, start: Local, floor: Option<Local>, mut visit: impl FnMut(Local) -> bool) {
    if civil_from_days(start.day).0 > LAST_YEAR {
        return;
    }
    let plan = Plan::new(rule, start);
    let skip = match (rule.count, floor) {
        (None, Some(floor)) => plan.skippable(floor),
        _ => 0,
    };
    let mut produced = 0u32;
    for step in 0..MAX_PERIODS {
        let Some(candidates) = plan.period(skip + step as i64) else {
            return;
        };
        for moment in candidates {
            if moment < start {
                continue;
            }
            if rule.count.is_some_and(|count| produced >= count) {
                return;
            }
            produced += 1;
            if !visit(moment) {
                return;
            }
        }
        if rule.count.is_some_and(|count| produced >= count) {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(rule: &str, start: Local, limit: usize) -> Vec<String> {
        let rule = Rule::parse(rule).unwrap();
        let mut out = Vec::new();
        each(&rule, start, None, |m| {
            out.push(m.compact());
            out.len() < limit
        });
        out
    }

    fn at(y: i32, mo: u8, d: u8, h: u32) -> Local {
        Local::new(y, mo, d, h, 0, 0)
    }

    #[test]
    fn daily_weekly_and_monthly_basics() {
        let out = all("FREQ=DAILY;COUNT=3", at(1997, 9, 2, 9), 99);
        assert_eq!(
            out,
            ["19970902T090000", "19970903T090000", "19970904T090000"]
        );
        let out = all("FREQ=WEEKLY;COUNT=3", at(1997, 9, 2, 9), 99);
        assert_eq!(
            out,
            ["19970902T090000", "19970909T090000", "19970916T090000"]
        );
        let out = all("FREQ=MONTHLY;COUNT=3", at(2026, 1, 31, 9), 99);
        // Months without a 31st are skipped, not moved.
        assert_eq!(
            out,
            ["20260131T090000", "20260331T090000", "20260531T090000"]
        );
        let out = all("FREQ=YEARLY;COUNT=3", at(2024, 2, 29, 9), 99);
        assert_eq!(
            out,
            ["20240229T090000", "20280229T090000", "20320229T090000"]
        );
    }

    #[test]
    fn the_start_is_never_repeated_before_it() {
        // Weekly on Monday and Wednesday from a Tuesday: nothing before the start.
        let out = all("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3", at(2026, 10, 6, 9), 99);
        assert_eq!(
            out,
            ["20261007T090000", "20261012T090000", "20261014T090000"]
        );
    }

    #[test]
    fn count_ends_the_series_and_a_visitor_can_stop_early() {
        assert_eq!(all("FREQ=DAILY;COUNT=2", at(2026, 1, 1, 9), 99).len(), 2);
        assert_eq!(all("FREQ=DAILY", at(2026, 1, 1, 9), 5).len(), 5);
    }

    #[test]
    fn skipping_ahead_gives_the_same_moments() {
        let rule = Rule::parse("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH").unwrap();
        let start = at(2020, 1, 7, 9);
        let mut full = Vec::new();
        each(&rule, start, None, |m| {
            full.push(m);
            m.day < days_from_civil(2027, 1, 1)
        });
        let floor = at(2026, 6, 1, 0);
        let mut skipped = Vec::new();
        each(&rule, start, Some(floor), |m| {
            skipped.push(m);
            m.day < days_from_civil(2027, 1, 1)
        });
        assert!(skipped.len() < full.len());
        let wanted: Vec<_> = full.iter().filter(|m| **m >= floor).collect();
        let got: Vec<_> = skipped.iter().filter(|m| **m >= floor).collect();
        assert_eq!(wanted, got);
    }

    #[test]
    fn a_rule_that_never_matches_ends() {
        // There is no 30th of February.
        assert!(all("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", at(2026, 2, 1, 9), 5).is_empty());
    }

    #[test]
    fn the_last_year_stops_a_series_without_end() {
        let out = all("FREQ=YEARLY", at(9998, 1, 1, 9), 99);
        assert_eq!(out, ["99980101T090000", "99990101T090000"]);
    }
}
