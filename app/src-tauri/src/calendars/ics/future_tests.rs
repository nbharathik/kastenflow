//! "This and all that follow": a change made to one occurrence of a series
//! that the feed says applies to every later one too (`RECURRENCE-ID` with
//! `RANGE=THISANDFUTURE`, RFC 5545 section 3.2.13). `fixtures/ics/thisandfuture.ics`
//! holds one series and its changes per case, with the list of starts and
//! titles a reader must show on each viewer's clock:
//!
//! - `X-EXPECT;VIEWER=<zone>`: the starts, `20261005T090000` (or a day for an all-day event);
//! - `X-TITLES`: the titles in the same order, apart by `|`.

use super::civil::{iso_day, parse_iso_day};
use super::events_between;
use super::expand::{Window, expand};
use super::parse::{Comp, Feed, components, parse};
use super::time::{parse_date, parse_date_time};
use super::zones::{Zones, viewer_zone};

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/ics/thisandfuture.ics"
));

/// `20261005T090000,20261012` as `2026-10-05T09:00`, `2026-10-12`.
fn starts(list: &str) -> Vec<String> {
    list.trim()
        .split(',')
        .map(|t| {
            if t.contains('T') {
                parse_date_time(t)
                    .expect("a time in the fixture")
                    .0
                    .iso_minute()
            } else {
                iso_day(parse_date(t).expect("a day in the fixture").day)
            }
        })
        .collect()
}

fn window(from: &str, to: &str) -> Window {
    Window {
        from: parse_iso_day(from).unwrap(),
        to: parse_iso_day(to).unwrap(),
    }
}

#[test]
fn every_case_shows_the_starts_and_titles_the_fixture_lists_on_every_clock() {
    let feed = parse(FIXTURE).unwrap();
    let calendar = components(FIXTURE).remove(0);
    let cases: Vec<&Comp> = calendar
        .kids
        .iter()
        .filter(|k| k.name == "VEVENT" && k.prop("X-EXPECT").is_some())
        .collect();
    assert!(cases.len() >= 10, "{} cases", cases.len());
    let mut checked = 0;
    for comp in cases {
        let uid = comp.prop("UID").expect("a uid").value.trim().to_owned();
        let case = comp.prop("X-CASE").map_or("", |p| p.value.as_str());
        let one = Feed {
            events: feed
                .events
                .iter()
                .filter(|e| e.uid == uid)
                .cloned()
                .collect(),
            zones: feed.zones.clone(),
            ..Feed::default()
        };
        for expect in comp.all("X-EXPECT") {
            let viewer = expect.param("VIEWER").expect("a viewer");
            let zones = Zones::new(feed.zones.clone(), viewer_zone(Some(viewer)));
            let made = expand(&one, &zones, window("2026-01-01", "2027-01-31"), 10_000);
            let got: Vec<&str> = made.items.iter().map(|o| o.start.as_str()).collect();
            assert_eq!(
                got,
                starts(&expect.value),
                "{case}: starts seen from {viewer}"
            );
            if let Some(titles) = comp.prop("X-TITLES") {
                let named: Vec<&str> = made.items.iter().map(|o| o.title.as_str()).collect();
                let wanted: Vec<&str> = titles.value.trim().split('|').collect();
                assert_eq!(named, wanted, "{case}: titles seen from {viewer}");
            }
            checked += 1;
        }
    }
    assert!(checked >= 14, "{checked} lists checked");
}

#[test]
fn the_range_of_a_recurrence_id_is_read() {
    let feed = parse(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:a\nDTSTART:20261012T090000Z\nRRULE:FREQ=DAILY\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:a\nDTSTART:20261014T100000Z\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261014T090000Z\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:a\nDTSTART:20261015T100000Z\nRECURRENCE-ID;range=thisandfuture;TZID=Europe/Paris:20261015T090000\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:a\nDTSTART:20261016T100000Z\nRECURRENCE-ID:20261016T090000Z\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:a\nDTSTART:20261017T100000Z\nRECURRENCE-ID;RANGE=THISPRIOR:20261017T090000Z\nEND:VEVENT\n\
END:VCALENDAR\n",
    )
    .unwrap();
    let flags: Vec<bool> = feed.events.iter().map(|e| e.this_and_future).collect();
    assert_eq!(flags, [false, true, true, false, false]);
}

#[test]
fn an_all_day_change_moves_the_days_and_the_length_of_every_later_one() {
    let feed = parse(FIXTURE).unwrap();
    let only: Feed = Feed {
        events: feed
            .events
            .iter()
            .filter(|e| e.uid == "tf-h@fixture.example")
            .cloned()
            .collect(),
        ..Feed::default()
    };
    let made = events_between(&only, "2026-10-01", "2026-11-30", Some("UTC")).unwrap();
    let spans: Vec<(&str, &str)> = made
        .items
        .iter()
        .map(|o| (o.start.as_str(), o.end.as_str()))
        .collect();
    assert_eq!(
        spans,
        [
            ("2026-10-05", "2026-10-05"),
            ("2026-10-12", "2026-10-12"),
            ("2026-10-20", "2026-10-21"),
            ("2026-10-27", "2026-10-28"),
            ("2026-11-03", "2026-11-04"),
        ]
    );
    // The second day of a two-day event is on the calendar too.
    let second = events_between(&only, "2026-10-21", "2026-10-21", Some("UTC")).unwrap();
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].start, "2026-10-20");
}

/// A series with no end, from January, whose Mondays become other days from March.
fn open_series(moved_to: &str) -> Feed {
    parse(&format!(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:open\nSUMMARY:Open\nDTSTART;TZID=America/New_York:20260105T090000\n\
DTEND;TZID=America/New_York:20260105T100000\nRRULE:FREQ=WEEKLY\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:open\nSUMMARY:Open (moved)\nRECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20260302T090000\n\
DTSTART;TZID=America/New_York:{moved_to}T090000\nDTEND;TZID=America/New_York:{moved_to}T100000\nEND:VEVENT\n\
END:VCALENDAR\n"
    ))
    .unwrap()
}

fn titles_on(feed: &Feed, from: &str, to: &str) -> Vec<String> {
    events_between(feed, from, to, Some("America/New_York"))
        .unwrap()
        .items
        .into_iter()
        .map(|o| format!("{} {}", o.start, o.title))
        .collect()
}

#[test]
fn a_series_with_no_end_is_found_where_a_change_moved_its_days_later() {
    // Mondays from 2 March become Thursdays: 2026-11-02 shows on the 5th.
    let feed = open_series("20260305");
    assert_eq!(
        titles_on(&feed, "2026-11-05", "2026-11-05"),
        ["2026-11-05T09:00 Open (moved)"]
    );
    // The Monday itself is gone, and the weeks before the change are as they were.
    assert!(titles_on(&feed, "2026-11-02", "2026-11-02").is_empty());
    assert_eq!(
        titles_on(&feed, "2026-02-23", "2026-02-23"),
        ["2026-02-23T09:00 Open"]
    );
    // A change that moves them ten days on is found ten days on.
    let far = open_series("20260312");
    assert_eq!(
        titles_on(&far, "2026-11-12", "2026-11-12"),
        ["2026-11-12T09:00 Open (moved)"]
    );
}

#[test]
fn a_series_with_no_end_is_found_where_a_change_moved_its_days_earlier() {
    // Mondays from 2 March become the Fridays before them: 2026-11-09 shows on the 6th.
    let feed = open_series("20260227");
    assert_eq!(
        titles_on(&feed, "2026-11-06", "2026-11-06"),
        ["2026-11-06T09:00 Open (moved)"]
    );
    assert!(titles_on(&feed, "2026-11-09", "2026-11-09").is_empty());
    // Seen across a week, each Friday once.
    assert_eq!(
        titles_on(&feed, "2026-11-02", "2026-11-08"),
        ["2026-11-06T09:00 Open (moved)"]
    );
}

#[test]
fn a_change_that_cannot_be_read_as_a_shift_stays_a_single_moved_occurrence() {
    // A day-long change to a series with times has no hour to carry forward.
    let feed = parse(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:odd\nSUMMARY:Timed\nDTSTART:20261012T090000Z\nDTEND:20261012T100000Z\nRRULE:FREQ=DAILY;COUNT=4\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:odd\nSUMMARY:Whole day\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261013T090000Z\nDTSTART;VALUE=DATE:20261013\nEND:VEVENT\n\
END:VCALENDAR\n",
    )
    .unwrap();
    let made = events_between(&feed, "2026-10-12", "2026-10-20", Some("UTC")).unwrap();
    let lines: Vec<String> = made
        .items
        .iter()
        .map(|o| format!("{} {}", o.start, o.title))
        .collect();
    // The 13th is the day-long one; the 14th and 15th stay as the series had them.
    assert_eq!(
        lines,
        [
            "2026-10-12T09:00 Timed",
            "2026-10-13 Whole day",
            "2026-10-14T09:00 Timed",
            "2026-10-15T09:00 Timed",
        ]
    );
}

#[test]
fn a_change_without_an_end_keeps_the_length_the_series_had() {
    let feed = parse(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:len\nSUMMARY:Call\nDTSTART:20261012T090000Z\nDTEND:20261012T094500Z\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:len\nSUMMARY:Call (later)\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261013T090000Z\nDTSTART:20261013T110000Z\nEND:VEVENT\n\
END:VCALENDAR\n",
    )
    .unwrap();
    let made = events_between(&feed, "2026-10-12", "2026-10-14", Some("UTC")).unwrap();
    let spans: Vec<(&str, &str)> = made
        .items
        .iter()
        .map(|o| (o.start.as_str(), o.end.as_str()))
        .collect();
    assert_eq!(
        spans,
        [
            ("2026-10-12T09:00", "2026-10-12T09:45"),
            ("2026-10-13T11:00", "2026-10-13T11:45"),
            ("2026-10-14T11:00", "2026-10-14T11:45"),
        ]
    );
}

#[test]
fn a_hostile_change_costs_nothing_and_breaks_nothing() {
    // A shift of centuries, a change with no series, a change on itself: whatever comes out comes out.
    let feed = parse(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:h\nSUMMARY:Daily\nDTSTART:20260101T090000Z\nRRULE:FREQ=DAILY\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:h\nSUMMARY:Far\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260201T090000Z\nDTSTART:99990101T090000Z\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:alone\nSUMMARY:No series\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260201T090000Z\nDTSTART:20260202T090000Z\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:ordinary\nSUMMARY:Ordinary\nDTSTART:20260601T090000Z\nEND:VEVENT\n\
END:VCALENDAR\n",
    )
    .unwrap();
    let made = events_between(&feed, "2026-05-01", "2026-06-30", Some("UTC")).unwrap();
    assert!(made.items.iter().any(|o| o.title == "Ordinary"));
    // The orphan change stands alone, where it says.
    let early = events_between(&feed, "2026-02-02", "2026-02-02", Some("UTC")).unwrap();
    assert!(early.items.iter().any(|o| o.title == "No series"));
}
