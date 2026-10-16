//! Turns a feed's events into the occurrences that fall on a range of days,
//! as the viewer's clock shows them: repeating events expanded, the
//! exceptions (`EXDATE`) and the moved or cancelled occurrences
//! (`RECURRENCE-ID`) applied, and every time placed in the viewer's zone.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::civil::{Local, iso_day};
use super::future::{Changes, key};
use super::parse::{Event, Feed, first_url};
use super::recur;
use super::rule::{Rule, Until};
use super::time::{Frame, When};
use super::zones::{Moment, Zones};

/// The most occurrences one repeating event gives in one range.
const MAX_PER_EVENT: usize = 2_000;
/// The longest description kept, in characters.
const MAX_DESCRIPTION: usize = 1_500;

/// One event on one stretch of the calendar.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    /// Tells this occurrence from the others of its event.
    pub id: String,
    pub uid: String,
    pub title: String,
    pub all_day: bool,
    /// `2026-10-12` for an all-day event, else `2026-10-12T14:30`, as the
    /// viewer's clock shows it.
    pub start: String,
    /// The same, where the event ends. For an all-day event this is its last
    /// day, not the day after.
    pub end: String,
    pub location: Option<String>,
    pub description: Option<String>,
    /// A web address for the event: its own link, or a meeting link in it.
    pub link: Option<String>,
    pub tentative: bool,
    /// The time zone could not be found, so the time is a guess.
    pub zone_guess: bool,
}

/// What a range of days holds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Expanded {
    pub items: Vec<Occurrence>,
    /// There were more than the limit, so some are missing.
    pub truncated: bool,
}

/// A range of days, both ends included, as day numbers.
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub from: i64,
    pub to: i64,
}

/// How long one occurrence of an event lasts.
#[derive(Clone, Copy)]
pub(super) struct Shape {
    pub(super) all_day: bool,
    /// Seconds, for an event with a time.
    pub(super) seconds: i64,
    /// Days, at least one, for an all-day event.
    pub(super) days: i64,
}

/// The occurrences an event has had cut out of its series: moved ones by
/// the time they were meant for, cancelled ones, and exceptions.
#[derive(Default)]
struct Taken {
    exact: HashSet<i64>,
    dates: HashSet<i64>,
}

impl Taken {
    fn add(&mut self, when: &When, all_day: bool, zones: &Zones) {
        if when.is_date() || all_day {
            self.dates.insert(when.at.day);
        } else if let Some(moment) = zones.moment(when) {
            self.exact.insert(moment.epoch);
        }
    }

    fn has(&self, when: &When, epoch: Option<i64>, all_day: bool) -> bool {
        if all_day {
            return self.dates.contains(&when.at.day);
        }
        epoch.is_some_and(|e| self.exact.contains(&e)) || self.dates.contains(&when.at.day)
    }
}

pub(super) fn shape_of(event: &Event, zones: &Zones) -> Option<Shape> {
    let days_of = |seconds: i64| (seconds + 86_399) / 86_400;
    if event.start.is_date() {
        let days = match (&event.end, event.duration) {
            (Some(end), _) => end.at.day - event.start.at.day,
            (None, Some(d)) => days_of(d.total_seconds()),
            (None, None) => 1,
        };
        return Some(Shape {
            all_day: true,
            seconds: 0,
            days: days.max(1),
        });
    }
    let seconds = match (&event.end, event.duration) {
        (Some(end), _) if end.is_date() => (end.at.day - event.start.at.day) * 86_400,
        (Some(end), _) => zones.moment(end)?.epoch - zones.moment(&event.start)?.epoch,
        (None, Some(d)) => d.total_seconds(),
        (None, None) => 0,
    };
    Some(Shape {
        all_day: false,
        seconds: seconds.max(0),
        days: 1,
    })
}

/// The link a person would follow for an event.
fn link_of(event: &Event) -> Option<String> {
    let web = |u: &str| u.starts_with("https://") || u.starts_with("http://");
    event
        .url
        .clone()
        .filter(|u| web(u))
        .or_else(|| event.conference.clone().filter(|u| web(u)))
        .or_else(|| event.location.as_deref().and_then(first_url))
        .or_else(|| event.description.as_deref().and_then(first_url))
}

fn shorten(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        text.to_owned()
    } else {
        let mut cut: String = text.chars().take(limit).collect();
        cut.push('…');
        cut
    }
}

fn past_until(rule: &Rule, when: &When, zones: &Zones) -> bool {
    match rule.until {
        None => false,
        Some(Until::Date(day)) => when.at.day > day,
        Some(Until::Local(until)) => when.at > until,
        Some(Until::Utc(until)) => match when.frame {
            Frame::Date | Frame::Floating => when.at > until,
            _ => zones
                .moment(when)
                .is_some_and(|m| m.epoch > until.as_seconds()),
        },
    }
}

/// Collects the occurrences, up to a limit.
struct Collector<'a> {
    zones: &'a Zones,
    window: Window,
    items: Vec<Occurrence>,
    cap: usize,
    truncated: bool,
}

impl Collector<'_> {
    fn full(&self) -> bool {
        self.items.len() >= self.cap
    }

    /// Places one occurrence of `event` at `when`; true when it was in range.
    fn place(&mut self, event: &Event, shape: &Shape, when: &When, moment: Option<Moment>) -> bool {
        let (all_day, start, end, guessed) = if shape.all_day {
            let last = when.at.day + shape.days - 1;
            if when.at.day > self.window.to || last < self.window.from {
                return false;
            }
            (true, iso_day(when.at.day), iso_day(last), false)
        } else {
            let Some(Moment { epoch, guessed }) = moment else {
                return false;
            };
            let (Some(s), Some(e)) = (
                self.zones.in_viewer(epoch),
                self.zones.in_viewer(epoch + shape.seconds),
            ) else {
                return false;
            };
            // An event that ends at midnight does not touch the next day.
            let last = if e > s && e.sec == 0 {
                e.day - 1
            } else {
                e.day
            };
            if s.day > self.window.to || last < self.window.from {
                return false;
            }
            (false, s.iso_minute(), e.max(s).iso_minute(), guessed)
        };
        if self.full() {
            self.truncated = true;
            return true;
        }
        self.items.push(Occurrence {
            id: format!("{}|{start}", event.uid),
            uid: event.uid.clone(),
            title: if event.title.is_empty() {
                "(No title)".to_owned()
            } else {
                event.title.clone()
            },
            all_day,
            start,
            end,
            location: event.location.clone(),
            description: event
                .description
                .as_deref()
                .map(|d| shorten(d.trim(), MAX_DESCRIPTION))
                .filter(|d| !d.is_empty()),
            link: link_of(event),
            tentative: event.tentative,
            zone_guess: guessed,
        });
        true
    }

    /// Places a moment of a series, unless it was cut out of it. What was
    /// cut out is matched against the series' own times; a change that holds
    /// from some occurrence on then moves and renames what is left.
    fn instance(
        &mut self,
        event: &Event,
        shape: &Shape,
        when: &When,
        taken: &Taken,
        changes: &Changes,
        seen: &mut HashSet<i64>,
    ) -> bool {
        let mut moment = None;
        if !shape.all_day {
            moment = self.zones.moment(when);
            if moment.is_none() {
                return false;
            }
        }
        if taken.has(when, moment.map(|m| m.epoch), shape.all_day) {
            return false;
        }
        if !seen.insert(moment.map_or(when.at.day, |m| m.epoch)) {
            return false;
        }
        if let Some(change) = changes.at(key(when, moment)) {
            if change.event.cancelled {
                return false;
            }
            return match change.apply(when, moment, self.zones) {
                Some((moved, found)) => self.place(change.event, &change.shape, &moved, found),
                None => false,
            };
        }
        self.place(event, shape, when, moment)
    }

    fn single(&mut self, event: &Event) {
        let Some(shape) = shape_of(event, self.zones) else {
            return;
        };
        let moment = self.zones.moment(&event.start);
        self.place(event, &shape, &event.start, moment);
    }

    fn series(&mut self, master: &Event, overrides: &[&Event]) {
        let Some(shape) = shape_of(master, self.zones) else {
            return;
        };
        // A change that holds "from here on" rewrites the occurrences after
        // it; the rest of the overrides are single moved or cancelled ones.
        let (later, mut single): (Vec<&Event>, Vec<&Event>) =
            overrides.iter().copied().partition(|e| e.this_and_future);
        let changes = Changes::new(master, &shape, &later, self.zones);
        single.extend(&changes.single);
        let mut taken = Taken::default();
        for when in &master.exdates {
            taken.add(when, shape.all_day, self.zones);
        }
        for moved in &single {
            if let Some(original) = &moved.recurrence_id {
                taken.add(original, shape.all_day, self.zones);
            }
        }
        let mut seen = HashSet::new();
        let mut made = 0;
        if let Some(rule) = &master.rule {
            let span = if shape.all_day {
                shape.days * 86_400
            } else {
                shape.seconds
            };
            // Far enough back that no occurrence that reaches the range is
            // missed, and far enough on that none is: a change may move
            // later occurrences either way.
            let pad = changes.pad();
            let floor = Local::from_seconds(self.window.from * 86_400 - span - pad - 2 * 86_400);
            let last = self.window.to + 2 + (pad + 86_399) / 86_400;
            recur::each(rule, master.start.at, Some(floor), |moment| {
                if made >= MAX_PER_EVENT {
                    self.truncated = true;
                    return false;
                }
                if moment.day > last {
                    return false;
                }
                // A series with a `COUNT` is counted from its start: the
                // ones long before the range are passed over, not placed.
                if moment < floor {
                    return true;
                }
                let when = master.start.with_at(moment);
                if past_until(rule, &when, self.zones) {
                    return false;
                }
                if self.instance(master, &shape, &when, &taken, &changes, &mut seen) {
                    made += 1;
                }
                true
            });
        }
        // The start is always the first occurrence, and `RDATE`s are extra ones.
        let extra = std::iter::once(&master.start).chain(&master.rdates);
        for when in extra {
            self.instance(master, &shape, when, &taken, &changes, &mut seen);
        }
        for moved in single.iter().filter(|e| !e.cancelled) {
            self.single(moved);
        }
    }
}

/// The occurrences on the days of `window`, in order, at most `cap`.
pub fn expand(feed: &Feed, zones: &Zones, window: Window, cap: usize) -> Expanded {
    let mut collector = Collector {
        zones,
        window,
        items: Vec::new(),
        cap,
        truncated: false,
    };
    let mut moved: HashMap<&str, Vec<&Event>> = HashMap::new();
    for event in feed.events.iter().filter(|e| e.recurrence_id.is_some()) {
        moved.entry(event.uid.as_str()).or_default().push(event);
    }
    let mut with_master = HashSet::new();
    for master in feed.events.iter().filter(|e| e.recurrence_id.is_none()) {
        with_master.insert(master.uid.as_str());
        if master.cancelled {
            continue;
        }
        let overrides = moved
            .get(master.uid.as_str())
            .map_or(&[][..], Vec::as_slice);
        if master.rule.is_none() && master.rdates.is_empty() && overrides.is_empty() {
            collector.single(master);
        } else {
            collector.series(master, overrides);
        }
    }
    // A moved occurrence whose series is not in the feed (an invitation to
    // one meeting of a series) stands on its own.
    for (uid, list) in &moved {
        if !with_master.contains(uid) {
            for event in list.iter().filter(|e| !e.cancelled) {
                collector.single(event);
            }
        }
    }
    let mut items = collector.items;
    items.sort_by(|a, b| {
        a.start
            .cmp(&b.start)
            .then(b.all_day.cmp(&a.all_day))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.id.cmp(&b.id))
    });
    Expanded {
        items,
        truncated: collector.truncated,
    }
}
