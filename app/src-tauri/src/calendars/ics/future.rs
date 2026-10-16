//! A change that holds "for this and all that follow": a `RECURRENCE-ID`
//! with `RANGE=THISANDFUTURE` (RFC 5545 section 3.2.13). The change names an
//! occurrence of the series and gives it a new start; every occurrence from
//! that one on is moved by the same amount and takes the change's title,
//! place and length, until a later change of the same kind takes over.
//!
//! - **How far each moves** is the difference between the change's start and
//!   the occurrence it names. Where both are on the series' own kind of clock
//!   that is a difference on the wall, so "09:00 becomes 10:30" stays 10:30 on
//!   the far side of a daylight-saving change, and a Saturday series moved to
//!   Sunday is on Sundays all year. The moved time is read on the clock the
//!   change names, so a change to a London hour follows London's clock changes.
//!   Where the two are on clocks that cannot be compared on the wall (the
//!   occurrence in universal time, the change in a zone), the instant moves.
//! - **What is not moved**: `EXDATE`s and single moved or cancelled
//!   occurrences are matched against the times the series itself makes, before
//!   anything is moved, so they keep cutting out the same occurrences.
//! - A change that cannot be read as a shift (a day-long change to a series
//!   with times, a time that cannot be placed) is left to stand as a single
//!   moved occurrence, as before.

use super::civil::Local;
use super::expand::{Shape, shape_of};
use super::parse::Event;
use super::time::{Frame, When};
use super::zones::{Moment, Zones};

/// The most a change may move an occurrence by for the stretch of a series
/// that is looked through to allow for it. Occurrences moved from further
/// away than this are not looked for.
const MAX_REACH: i64 = 400 * 86_400;

/// How a change moves the occurrences it reaches.
enum Shift {
    /// Whole days: an all-day series.
    Days(i64),
    /// The wall-clock time moves by this many seconds and is then read on the
    /// clock `frame` names.
    Wall { seconds: i64, frame: Frame },
    /// The instant moves by this many seconds.
    Instant(i64),
}

/// One change, and where in the series it starts.
pub(super) struct Change<'a> {
    /// The change as the feed wrote it: its title, place and so on.
    pub event: &'a Event,
    /// How long each occurrence it makes lasts.
    pub shape: Shape,
    from: i64,
    shift: Shift,
}

/// Where a series stands in a number: an all-day moment by its day, any
/// other by its instant. Changes and occurrences are compared by this.
pub(super) fn key(when: &When, moment: Option<Moment>) -> i64 {
    if when.is_date() {
        when.at.day.saturating_mul(86_400)
    } else {
        moment.map_or(when.at.as_seconds(), |m| m.epoch)
    }
}

impl<'a> Change<'a> {
    fn read(master: &Event, own: &Shape, event: &'a Event, zones: &Zones) -> Option<Change<'a>> {
        let rid = event.recurrence_id.as_ref()?;
        let all_day = master.start.is_date();
        if rid.is_date() != all_day || event.start.is_date() != all_day {
            return None;
        }
        let (shift, from) = if all_day {
            (
                Shift::Days(event.start.at.day - rid.at.day),
                rid.at.day.saturating_mul(86_400),
            )
        } else {
            let from = zones.moment(rid)?.epoch;
            let shift = if rid.frame == master.start.frame {
                Shift::Wall {
                    seconds: event.start.at.as_seconds() - rid.at.as_seconds(),
                    frame: event.start.frame.clone(),
                }
            } else {
                Shift::Instant(zones.moment(&event.start)?.epoch - from)
            };
            (shift, from)
        };
        // A change that gives no end keeps the length the series had.
        let shape = if event.end.is_some() || event.duration.is_some() {
            shape_of(event, zones)?
        } else {
            *own
        };
        Some(Change {
            event,
            shape,
            from,
            shift,
        })
    }

    /// How far, either way, this change can put an occurrence from where the
    /// series made it, with how long the occurrence lasts.
    fn reach(&self) -> i64 {
        let moved = match &self.shift {
            Shift::Days(days) => days.saturating_abs().saturating_mul(86_400),
            Shift::Wall { seconds, .. } | Shift::Instant(seconds) => seconds.saturating_abs(),
        };
        let span = if self.shape.all_day {
            self.shape.days.saturating_mul(86_400)
        } else {
            self.shape.seconds
        };
        moved.saturating_add(span)
    }

    /// Where the occurrence made at `when` (`moment`, for one with a time)
    /// goes; None when the new time cannot be placed.
    pub fn apply(
        &self,
        when: &When,
        moment: Option<Moment>,
        zones: &Zones,
    ) -> Option<(When, Option<Moment>)> {
        match &self.shift {
            Shift::Days(days) => Some((when.with_at(Local::midnight(when.at.day + days)), None)),
            Shift::Wall { seconds, frame } => {
                let moved = When {
                    frame: frame.clone(),
                    at: Local::from_seconds(when.at.as_seconds() + seconds),
                };
                let found = zones.moment(&moved)?;
                Some((moved, Some(found)))
            }
            Shift::Instant(seconds) => {
                let was = moment?;
                Some((
                    when.clone(),
                    Some(Moment {
                        epoch: was.epoch + seconds,
                        guessed: was.guessed,
                    }),
                ))
            }
        }
    }
}

/// The changes of one series that reach the occurrences after them, in order.
pub(super) struct Changes<'a> {
    list: Vec<Change<'a>>,
    /// Changes that could not be read as a shift: they stand alone.
    pub single: Vec<&'a Event>,
    reach: i64,
}

impl<'a> Changes<'a> {
    pub fn new(master: &Event, own: &Shape, later: &[&'a Event], zones: &Zones) -> Changes<'a> {
        let mut changes = Changes {
            list: Vec::new(),
            single: Vec::new(),
            reach: 0,
        };
        for &event in later {
            match Change::read(master, own, event, zones) {
                Some(change) => {
                    changes.reach = changes.reach.max(change.reach());
                    changes.list.push(change);
                }
                None => changes.single.push(event),
            }
        }
        // The sort is stable: of two changes at one moment, the one the feed
        // wrote last is the one in force.
        changes.list.sort_by_key(|c| c.from);
        changes.reach = changes.reach.min(MAX_REACH);
        changes
    }

    /// The seconds to widen the stretch of a series looked through by, so an
    /// occurrence moved into the range from outside it is still found.
    pub fn pad(&self) -> i64 {
        self.reach
    }

    /// The change in force at `key` (see `key`): the latest that starts at
    /// or before it.
    pub fn at(&self, key: i64) -> Option<&Change<'a>> {
        self.list.iter().rev().find(|c| c.from <= key)
    }
}
