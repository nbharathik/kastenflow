//! Time zones: what a feed's `TZID` means, and the viewer's own zone.
//!
//! A `TZID` is looked up as an IANA name (`jiff` carries the database, so no
//! computer needs one installed), then as a Windows name (Outlook), then by
//! the zone's `X-LIC-LOCATION` hint, and last by the rules in the feed's own
//! `VTIMEZONE`. When only those rules or nothing at all is left, the answer
//! is marked as a guess. A zone that cannot be found never stops an event
//! from showing: it is read in the viewer's zone and marked too.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use jiff::Timestamp;
use jiff::civil::DateTime;
use jiff::tz::TimeZone;

use super::civil::Local;
use super::recur;
use super::rule::Rule;
use super::time::{Frame, When};
use super::windows_zones;

/// One `STANDARD` or `DAYLIGHT` part of a feed's `VTIMEZONE`.
#[derive(Clone, Debug)]
pub struct Observance {
    pub offset_to: i32,
    pub start: Local,
    pub rule: Option<Rule>,
    pub rdates: Vec<Local>,
}

/// A time zone as the feed itself defines it.
#[derive(Clone, Debug, Default)]
pub struct CustomZone {
    /// An IANA name the feed gives for it (`X-LIC-LOCATION`).
    pub hint: Option<String>,
    pub observances: Vec<Observance>,
}

impl CustomZone {
    /// The offset from universal time, in seconds, at a wall-clock moment: the
    /// one the most recent change before it set.
    pub fn offset_at(&self, local: Local) -> Option<i32> {
        let mut best: Option<(Local, i32)> = None;
        for part in &self.observances {
            if let Some(onset) = part.latest_onset(local)
                && best.is_none_or(|(at, _)| onset > at)
            {
                best = Some((onset, part.offset_to));
            }
        }
        // Before any change, the offset the earliest one changed from is not
        // known here; the earliest part's own offset is the best answer.
        best.map(|(_, offset)| offset).or_else(|| {
            self.observances
                .iter()
                .min_by_key(|p| p.start)
                .map(|p| p.offset_to)
        })
    }
}

impl Observance {
    /// The last time this part came into force at or before `local`.
    fn latest_onset(&self, local: Local) -> Option<Local> {
        if self.start > local {
            return None;
        }
        let mut latest = self.start;
        for r in &self.rdates {
            if *r <= local && *r > latest {
                latest = *r;
            }
        }
        if let Some(rule) = &self.rule {
            // A zone's change repeats for ever; a `COUNT` on it (which no
            // real feed has) would only make every lookup walk from its first
            // year, so it is left out.
            let rule = Rule {
                count: None,
                ..rule.clone()
            };
            let rule = &rule;
            recur::each(rule, self.start, Some(local), |at| {
                if at > local {
                    return false;
                }
                if rule_over(rule, at) {
                    return false;
                }
                latest = latest.max(at);
                true
            });
        }
        Some(latest)
    }
}

fn rule_over(rule: &Rule, at: Local) -> bool {
    use super::rule::Until;
    match rule.until {
        Some(Until::Date(day)) => at.day > day,
        Some(Until::Local(until) | Until::Utc(until)) => at > until,
        None => false,
    }
}

/// A moment found in a zone: seconds since 1970 and whether the zone was a
/// guess.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Moment {
    pub epoch: i64,
    pub guessed: bool,
}

enum Found {
    Named(TimeZone),
    Feed(Arc<CustomZone>),
    Missing,
}

/// Resolves times to moments, for one feed and one viewer.
pub struct Zones {
    feed: HashMap<String, Arc<CustomZone>>,
    viewer: TimeZone,
    found: RefCell<HashMap<String, Rc<Found>>>,
}

/// Whether `name` can be a zone's name in the database: letters, digits and
/// `_ + - /` only, in parts that are not empty. A name comes from a feed, which
/// anyone may write, so it is never handed to the database as it is without
/// this: nothing that looks like a path gets further than here.
fn safe(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-' | '/'))
        && name.split('/').all(|part| !part.is_empty())
}

/// The database's zone of that name, if there is one.
fn zone_named(name: &str) -> Option<TimeZone> {
    if safe(name) {
        TimeZone::get(name).ok()
    } else {
        None
    }
}

/// The zone named `name`, as the viewer's (the system's when it is not one).
pub fn viewer_zone(name: Option<&str>) -> TimeZone {
    name.and_then(|n| zone_named(n.trim()))
        .unwrap_or_else(TimeZone::system)
}

fn civil(local: Local) -> Option<DateTime> {
    let (y, mo, d) = local.date();
    let (h, mi, s) = local.time();
    DateTime::new(
        i16::try_from(y).ok()?,
        i8::try_from(mo).ok()?,
        i8::try_from(d).ok()?,
        i8::try_from(h).ok()?,
        i8::try_from(mi).ok()?,
        i8::try_from(s).ok()?,
        0,
    )
    .ok()
}

/// The moment a wall-clock time is in a zone; a time that falls in a gap is
/// read with the offset before it, one that happens twice is the first.
fn epoch_in(zone: &TimeZone, local: Local) -> Option<i64> {
    let zoned = civil(local)?.to_zoned(zone.clone()).ok()?;
    Some(zoned.timestamp().as_second())
}

/// The names `tzid` might go by in the database: as written, and with a
/// prefix such as `/mozilla.org/20050126_1/` taken off.
fn candidates(tzid: &str) -> Vec<String> {
    let mut names = vec![tzid.to_owned()];
    if let Some(mapped) = windows_zones::iana(tzid) {
        names.push(mapped.to_owned());
    }
    if tzid.contains('/') {
        let parts: Vec<&str> = tzid.split('/').filter(|p| !p.is_empty()).collect();
        for take in [3usize, 2, 1] {
            if parts.len() >= take {
                names.push(parts[parts.len() - take..].join("/"));
            }
        }
    }
    names
}

impl Zones {
    pub fn new(feed: HashMap<String, Arc<CustomZone>>, viewer: TimeZone) -> Zones {
        Zones {
            feed,
            viewer,
            found: RefCell::new(HashMap::new()),
        }
    }

    fn find(&self, tzid: &str) -> Rc<Found> {
        if let Some(found) = self.found.borrow().get(tzid) {
            return Rc::clone(found);
        }
        let named = candidates(tzid)
            .into_iter()
            .find_map(|name| zone_named(&name));
        let found = if let Some(zone) = named {
            Found::Named(zone)
        } else if let Some(custom) = self.feed.get(tzid) {
            match custom.hint.as_deref().and_then(zone_named) {
                Some(zone) => Found::Named(zone),
                None if !custom.observances.is_empty() => Found::Feed(Arc::clone(custom)),
                None => Found::Missing,
            }
        } else {
            Found::Missing
        };
        let found = Rc::new(found);
        self.found
            .borrow_mut()
            .insert(tzid.to_owned(), Rc::clone(&found));
        found
    }

    /// The moment a time is, or None for a date outside what can be counted.
    pub fn moment(&self, when: &When) -> Option<Moment> {
        match &when.frame {
            Frame::Utc => Some(Moment {
                epoch: when.at.as_seconds(),
                guessed: false,
            }),
            Frame::Date | Frame::Floating => epoch_in(&self.viewer, when.at).map(|epoch| Moment {
                epoch,
                guessed: false,
            }),
            Frame::Zone(tzid) => match &*self.find(tzid) {
                Found::Named(zone) => epoch_in(zone, when.at).map(|epoch| Moment {
                    epoch,
                    guessed: false,
                }),
                Found::Feed(custom) => {
                    let offset = custom.offset_at(when.at)?;
                    Some(Moment {
                        epoch: when.at.as_seconds() - i64::from(offset),
                        guessed: true,
                    })
                }
                Found::Missing => epoch_in(&self.viewer, when.at).map(|epoch| Moment {
                    epoch,
                    guessed: true,
                }),
            },
        }
    }

    /// The wall-clock time in the viewer's zone at a moment.
    pub fn in_viewer(&self, epoch: i64) -> Option<Local> {
        let stamp = Timestamp::from_second(epoch).ok()?;
        let dt = self.viewer.to_datetime(stamp);
        Some(Local::new(
            i32::from(dt.year()),
            u8::try_from(dt.month()).ok()?,
            u8::try_from(dt.day()).ok()?,
            u32::try_from(dt.hour()).ok()?,
            u32::try_from(dt.minute()).ok()?,
            u32::try_from(dt.second()).ok()?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zones(viewer: &str) -> Zones {
        Zones::new(HashMap::new(), viewer_zone(Some(viewer)))
    }

    fn zoned(tzid: &str, at: Local) -> When {
        When {
            frame: Frame::Zone(tzid.into()),
            at,
        }
    }

    fn view(zones: &Zones, when: &When) -> String {
        let moment = zones.moment(when).unwrap();
        zones.in_viewer(moment.epoch).unwrap().iso_minute()
    }

    #[test]
    fn a_named_zone_shifts_with_daylight_saving() {
        let utc = zones("UTC");
        // New York is UTC-4 in summer, UTC-5 in winter.
        let summer = zoned("America/New_York", Local::new(2026, 7, 1, 9, 0, 0));
        let winter = zoned("America/New_York", Local::new(2026, 12, 1, 9, 0, 0));
        assert_eq!(view(&utc, &summer), "2026-07-01T13:00");
        assert_eq!(view(&utc, &winter), "2026-12-01T14:00");
        assert!(!utc.moment(&summer).unwrap().guessed);
        // Seen from New York itself the wall clock stays 09:00.
        let home = zones("America/New_York");
        assert_eq!(view(&home, &summer), "2026-07-01T09:00");
        assert_eq!(view(&home, &winter), "2026-12-01T09:00");
    }

    #[test]
    fn a_time_in_the_spring_gap_and_the_autumn_overlap_is_still_one_moment() {
        let utc = zones("UTC");
        // 2026-03-08 02:30 does not exist in New York: it is read with the
        // offset before the gap (UTC-5), which is 03:30 daylight time.
        let gap = zoned("America/New_York", Local::new(2026, 3, 8, 2, 30, 0));
        assert_eq!(view(&utc, &gap), "2026-03-08T07:30");
        assert_eq!(view(&zones("America/New_York"), &gap), "2026-03-08T03:30");
        // 2026-11-01 01:30 happens twice: the first (UTC-4) counts.
        let overlap = zoned("America/New_York", Local::new(2026, 11, 1, 1, 30, 0));
        assert_eq!(view(&utc, &overlap), "2026-11-01T05:30");
    }

    #[test]
    fn outlooks_windows_names_and_old_style_names_work() {
        let utc = zones("UTC");
        let pacific = zoned("Pacific Standard Time", Local::new(2026, 7, 1, 9, 0, 0));
        assert_eq!(view(&utc, &pacific), "2026-07-01T16:00");
        assert!(!utc.moment(&pacific).unwrap().guessed);
        let berlin = zoned("W. Europe Standard Time", Local::new(2026, 1, 15, 9, 0, 0));
        assert_eq!(view(&utc, &berlin), "2026-01-15T08:00");
        let prefixed = zoned(
            "/mozilla.org/20050126_1/Europe/Paris",
            Local::new(2026, 7, 1, 9, 0, 0),
        );
        assert_eq!(view(&utc, &prefixed), "2026-07-01T07:00");
    }

    #[test]
    fn utc_floating_and_dates_need_no_zone_name() {
        let tokyo = zones("Asia/Tokyo");
        let at = Local::new(2026, 10, 12, 9, 0, 0);
        assert_eq!(
            view(
                &tokyo,
                &When {
                    frame: Frame::Utc,
                    at
                }
            ),
            "2026-10-12T18:00"
        );
        // A floating time is the same wall-clock time for the viewer.
        assert_eq!(
            view(
                &tokyo,
                &When {
                    frame: Frame::Floating,
                    at
                }
            ),
            "2026-10-12T09:00"
        );
    }

    fn feed_zone(offset_standard: i32, offset_daylight: i32) -> Arc<CustomZone> {
        // Daylight time from the second Sunday in March to the first Sunday in November.
        Arc::new(CustomZone {
            hint: None,
            observances: vec![
                Observance {
                    offset_to: offset_daylight,
                    start: Local::new(1970, 3, 8, 2, 0, 0),
                    rule: Rule::parse("FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"),
                    rdates: vec![],
                },
                Observance {
                    offset_to: offset_standard,
                    start: Local::new(1970, 11, 1, 2, 0, 0),
                    rule: Rule::parse("FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"),
                    rdates: vec![],
                },
            ],
        })
    }

    #[test]
    fn an_unknown_zone_falls_back_to_the_feeds_own_rules_and_says_so() {
        let mut feed = HashMap::new();
        feed.insert(
            "Company HQ Time".to_owned(),
            feed_zone(-5 * 3600, -4 * 3600),
        );
        let utc = Zones::new(feed, viewer_zone(Some("UTC")));
        let summer = zoned("Company HQ Time", Local::new(2026, 7, 1, 9, 0, 0));
        let winter = zoned("Company HQ Time", Local::new(2026, 12, 1, 9, 0, 0));
        assert_eq!(view(&utc, &summer), "2026-07-01T13:00");
        assert_eq!(view(&utc, &winter), "2026-12-01T14:00");
        assert!(utc.moment(&summer).unwrap().guessed);
        // Just either side of the change.
        let before = zoned("Company HQ Time", Local::new(2026, 3, 8, 1, 59, 0));
        let after = zoned("Company HQ Time", Local::new(2026, 3, 8, 3, 0, 0));
        assert_eq!(view(&utc, &before), "2026-03-08T06:59");
        assert_eq!(view(&utc, &after), "2026-03-08T07:00");
    }

    #[test]
    fn a_hint_in_the_feed_names_the_real_zone() {
        let mut feed = HashMap::new();
        feed.insert(
            "Odd Name".to_owned(),
            Arc::new(CustomZone {
                hint: Some("Europe/London".into()),
                observances: vec![],
            }),
        );
        let utc = Zones::new(feed, viewer_zone(Some("UTC")));
        let summer = zoned("Odd Name", Local::new(2026, 7, 1, 9, 0, 0));
        assert_eq!(view(&utc, &summer), "2026-07-01T08:00");
        assert!(!utc.moment(&summer).unwrap().guessed);
    }

    #[test]
    fn a_zone_nobody_knows_is_read_in_the_viewers_zone_and_marked() {
        let tokyo = zones("Asia/Tokyo");
        let when = zoned("Nowhere Standard Time", Local::new(2026, 10, 12, 9, 0, 0));
        assert_eq!(view(&tokyo, &when), "2026-10-12T09:00");
        assert!(tokyo.moment(&when).unwrap().guessed);
    }

    #[test]
    fn a_zone_name_that_looks_like_a_path_never_reaches_the_database() {
        // Sloppy but harmless writings of a real name are not names to ask for
        // as they stand; the part that is a zone is still found.
        assert!(!safe("America//New_York") && !safe("America/New_York/"));
        for name in [
            "../../etc/passwd",
            "/etc/passwd",
            "America/../../x",
            "C:\\Windows\\win.ini",
            "A very long name that is not a time zone at all, repeated again and again and again",
        ] {
            assert!(!safe(name), "{name:?}");
            let tokyo = zones("Asia/Tokyo");
            let when = zoned(name, Local::new(2026, 10, 12, 9, 0, 0));
            // Read in the viewer's zone, and marked as a guess.
            assert_eq!(view(&tokyo, &when), "2026-10-12T09:00");
            assert!(tokyo.moment(&when).unwrap().guessed, "{name:?}");
        }
        assert!(safe("America/Argentina/Buenos_Aires") && safe("Etc/GMT+12") && safe("UTC"));
    }

    #[test]
    fn the_viewers_zone_falls_back_to_the_system_zone() {
        // Never fails, whatever it is called.
        let _ = viewer_zone(Some("Not/AZone"));
        let _ = viewer_zone(None);
    }
}
