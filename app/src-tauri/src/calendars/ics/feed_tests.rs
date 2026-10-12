//! Whole feeds from `fixtures/ics/`, read and expanded as the calendar does:
//! a Google feed, an Outlook feed (Windows zone names), all-day events,
//! daylight-saving gaps and overlaps, and exceptions.

use super::events_between;
use super::expand::{Occurrence, Window, expand};
use super::parse::{Feed, parse};
use super::zones::{Zones, viewer_zone};

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/ics/",
            $name
        ))
    };
}

fn items(feed: &Feed, from: &str, to: &str, zone: &str) -> Vec<Occurrence> {
    let made = events_between(feed, from, to, Some(zone)).unwrap();
    assert!(!made.truncated);
    made.items
}

fn lines(feed: &Feed, from: &str, to: &str, zone: &str) -> Vec<String> {
    items(feed, from, to, zone)
        .into_iter()
        .map(|o| format!("{} {}", o.start, o.title))
        .collect()
}

#[test]
fn a_google_feed_shows_each_event_at_its_hour_across_the_autumn_clock_change() {
    let feed = parse(fixture!("google.ics")).unwrap();
    assert_eq!(feed.name.as_deref(), Some("Work (fixture)"));
    // Seen on a UTC clock the Monday stand-up moves from 13:00 to 14:00 when
    // New York turns its clocks back on 2026-11-01; the moved one is on the
    // 27th, the cancelled and excluded ones are gone.
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-11-30", "UTC"),
        [
            "2026-10-05T13:00 Team standup",
            "2026-10-12 Company holiday",
            "2026-10-12T13:00 Team standup",
            "2026-10-14T15:00 Design review",
            "2026-10-15T17:00 Pick up parcel",
            "2026-10-17 Sam's birthday",
            "2026-10-20 Offsite",
            "2026-10-27T14:30 Team standup (moved)",
            "2026-10-31T03:30 Late call",
            "2026-11-02T14:00 Team standup",
            "2026-11-16T14:00 Team standup",
            "2026-11-23T14:00 Team standup",
        ]
    );
    // On a New York clock the stand-up stays at 09:00 all through.
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-11-30", "America/New_York"),
        [
            "2026-10-05T09:00 Team standup",
            "2026-10-12 Company holiday",
            "2026-10-12T09:00 Team standup",
            "2026-10-14T11:00 Design review",
            // A time with no zone is the same wall-clock time anywhere.
            "2026-10-15T17:00 Pick up parcel",
            "2026-10-17 Sam's birthday",
            "2026-10-20 Offsite",
            "2026-10-27T10:30 Team standup (moved)",
            "2026-10-30T23:30 Late call",
            "2026-11-02T09:00 Team standup",
            "2026-11-16T09:00 Team standup",
            "2026-11-23T09:00 Team standup",
        ]
    );
}

#[test]
fn a_google_events_details_come_through() {
    let feed = parse(fixture!("google.ics")).unwrap();
    let day = items(&feed, "2026-10-05", "2026-10-05", "America/New_York");
    assert_eq!(day.len(), 1);
    let standup = &day[0];
    assert_eq!(standup.end, "2026-10-05T09:30");
    assert!(!standup.all_day && !standup.tentative && !standup.zone_guess);
    assert_eq!(standup.location.as_deref(), Some("Zoom room 4, 1 Main St"));
    assert_eq!(
        standup.description.as_deref(),
        Some(
            "Quick sync.\nJoin with Google Meet: https://meet.google.com/abc-defg-hij\n\nPlease add topics beforehand, thanks!"
        )
    );
    assert_eq!(
        standup.link.as_deref(),
        Some("https://meet.google.com/abc-defg-hij")
    );
    assert_eq!(standup.id, "standup@fixture.example|2026-10-05T09:00");
    let review = &items(&feed, "2026-10-14", "2026-10-14", "UTC")[0];
    assert!(review.tentative);
    assert_eq!(review.end, "2026-10-14T16:30");
    assert_eq!(
        review.link.as_deref(),
        Some("https://example.com/reviews/14")
    );
}

#[test]
fn an_event_that_spans_days_or_midnight_shows_on_each_day_it_touches() {
    let feed = parse(fixture!("google.ics")).unwrap();
    for day in ["2026-10-20", "2026-10-21", "2026-10-22"] {
        assert_eq!(
            lines(&feed, day, day, "UTC"),
            ["2026-10-20 Offsite"],
            "{day}"
        );
    }
    assert!(lines(&feed, "2026-10-23", "2026-10-23", "UTC").is_empty());
    assert_eq!(
        items(&feed, "2026-10-20", "2026-10-20", "UTC")[0].end,
        "2026-10-22"
    );
    // 23:30 to 00:30: on both days.
    for day in ["2026-10-30", "2026-10-31"] {
        let found = lines(&feed, day, day, "America/New_York");
        assert!(
            found.contains(&"2026-10-30T23:30 Late call".to_owned()),
            "{day}"
        );
    }
    assert!(
        !lines(&feed, "2026-11-01", "2026-11-01", "America/New_York")
            .iter()
            .any(|l| l.contains("Late call"))
    );
}

#[test]
fn a_yearly_event_from_years_ago_is_found_without_walking_every_day() {
    let feed = parse(fixture!("google.ics")).unwrap();
    assert_eq!(
        lines(&feed, "2026-10-17", "2026-10-17", "UTC"),
        ["2026-10-17 Sam's birthday"]
    );
    assert_eq!(
        lines(&feed, "2031-10-17", "2031-10-17", "UTC"),
        ["2031-10-17 Sam's birthday"]
    );
    assert!(lines(&feed, "2026-10-18", "2026-10-18", "UTC").is_empty());
}

#[test]
fn an_outlook_feed_with_windows_zone_names_shows_the_right_hours() {
    // Outlook writes CRLF line ends.
    let text = fixture!("outlook.ics")
        .replace("\r\n", "\n")
        .replace('\n', "\r\n");
    let feed = parse(&text).unwrap();
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-11-30", "UTC"),
        [
            // 10:00 Pacific, in summer time then (after 11-01) in winter time.
            "2026-10-12T17:00 Weekly planning",
            "2026-10-13T08:30 Custom zone call",
            "2026-10-14T10:00 Unknown zone call",
            "2026-10-16 Conference day",
            "2026-10-19T17:00 Weekly planning",
            "2026-10-21T12:00 Call in universal time",
            "2026-10-26T08:00 Berlin sync",
            "2026-10-26T17:00 Weekly planning",
            "2026-11-02T18:00 Weekly planning",
        ]
    );
    let home = lines(&feed, "2026-10-01", "2026-11-30", "America/Los_Angeles");
    assert!(home.contains(&"2026-10-12T10:00 Weekly planning".to_owned()));
    assert!(home.contains(&"2026-11-02T10:00 Weekly planning".to_owned()));
}

#[test]
fn a_zone_only_the_feed_knows_is_used_and_marked_as_a_guess() {
    let feed = parse(fixture!("outlook.ics")).unwrap();
    let all = items(&feed, "2026-10-01", "2026-11-30", "UTC");
    let flagged: Vec<&str> = all
        .iter()
        .filter(|o| o.zone_guess)
        .map(|o| o.title.as_str())
        .collect();
    // The feed's own rules (+05:30) for one, the viewer's clock for the zone
    // that is nowhere (an unknown name with no rules at all).
    assert_eq!(flagged, ["Custom zone call", "Unknown zone call"]);
    let planning = all.iter().find(|o| o.title == "Weekly planning").unwrap();
    assert_eq!(
        planning.link.as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc")
    );
}

#[test]
fn all_day_events_cover_the_days_they_say() {
    let feed = parse(fixture!("allday.ics")).unwrap();
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-12-31", "UTC"),
        [
            "2026-10-01 Weekly all day",
            "2026-10-08 Weekly all day",
            "2026-10-12 Single day",
            "2026-10-20 Three days",
            "2026-10-22 Weekly all day",
            "2026-10-29 Weekly all day",
            "2026-10-30 Over the month end",
            "2026-11-05 No end given",
            "2026-11-10 Two days by duration",
            "2026-11-15 Zero length",
            "2026-11-20T20:00 Dinner until midnight",
            "2026-12-01 Daily until a date",
            "2026-12-02 Daily until a date",
            "2026-12-03 Daily until a date",
        ]
    );
    let span = |from: &str, to: &str| lines(&feed, from, to, "UTC");
    // An exclusive end date is the day after the last day.
    assert_eq!(
        items(&feed, "2026-10-30", "2026-10-30", "UTC")[0].end,
        "2026-11-02"
    );
    assert_eq!(
        span("2026-11-01", "2026-11-03"),
        ["2026-10-30 Over the month end"]
    );
    assert_eq!(
        items(&feed, "2026-11-10", "2026-11-10", "UTC")[0].end,
        "2026-11-11"
    );
    assert_eq!(
        items(&feed, "2026-11-15", "2026-11-15", "UTC")[0].end,
        "2026-11-15"
    );
    // An event that ends at midnight does not touch the next day.
    assert!(span("2026-11-21", "2026-11-21").is_empty());
    assert_eq!(
        span("2026-11-20", "2026-11-20"),
        ["2026-11-20T20:00 Dinner until midnight"]
    );
    // A birthday every year, whatever the viewer's clock.
    assert_eq!(span("2026-03-01", "2026-03-01"), ["2026-03-01 Birthday"]);
    assert_eq!(
        lines(&feed, "2027-03-01", "2027-03-01", "Pacific/Auckland"),
        ["2027-03-01 Birthday"]
    );
}

#[test]
fn daylight_saving_gaps_and_overlaps_keep_every_event_once() {
    let feed = parse(fixture!("dst.ics")).unwrap();
    let only = |title: &str, from: &str, to: &str, zone: &str| -> Vec<String> {
        items(&feed, from, to, zone)
            .into_iter()
            .filter(|o| o.title.starts_with(title))
            .map(|o| o.start)
            .collect()
    };
    // 02:30 on 2026-03-08 does not exist in New York: it is read with the
    // offset before the gap, so it is 03:30 there.
    assert_eq!(
        only("Falls in the spring", "2026-03-01", "2026-03-31", "UTC"),
        [
            "2026-03-06T07:30",
            "2026-03-07T07:30",
            "2026-03-08T07:30",
            "2026-03-09T06:30",
            "2026-03-10T06:30"
        ]
    );
    assert_eq!(
        only(
            "Falls in the spring",
            "2026-03-01",
            "2026-03-31",
            "America/New_York"
        ),
        [
            "2026-03-06T02:30",
            "2026-03-07T02:30",
            "2026-03-08T03:30",
            "2026-03-09T02:30",
            "2026-03-10T02:30"
        ]
    );
    let gap_day = items(&feed, "2026-03-08", "2026-03-08", "America/New_York");
    let gap = gap_day.iter().find(|o| o.uid.starts_with("gap")).unwrap();
    assert_eq!(gap.end, "2026-03-08T04:00");
    // 01:30 on 2026-11-01 happens twice: the first counts.
    assert_eq!(
        only("Falls in the autumn", "2026-10-25", "2026-11-05", "UTC"),
        [
            "2026-10-30T05:30",
            "2026-10-31T05:30",
            "2026-11-01T05:30",
            "2026-11-02T06:30",
            "2026-11-03T06:30"
        ]
    );
    assert_eq!(
        only(
            "Falls in the autumn",
            "2026-10-25",
            "2026-11-05",
            "America/New_York"
        ),
        [
            "2026-10-30T01:30",
            "2026-10-31T01:30",
            "2026-11-01T01:30",
            "2026-11-02T01:30",
            "2026-11-03T01:30"
        ]
    );
    // The southern hemisphere changes in spring, the other way round.
    assert_eq!(
        only("Sydney", "2026-09-20", "2026-10-20", "UTC"),
        ["2026-09-25T23:00", "2026-10-02T23:00", "2026-10-09T22:00"]
    );
    assert_eq!(
        only("Sydney", "2026-09-20", "2026-10-20", "Australia/Sydney"),
        ["2026-09-26T09:00", "2026-10-03T09:00", "2026-10-10T09:00"]
    );
    // London turns its clocks back on 2026-10-25.
    assert_eq!(
        only("London", "2026-10-01", "2026-11-30", "UTC"),
        ["2026-10-19T08:00", "2026-10-26T09:00", "2026-11-02T09:00"]
    );
}

#[test]
fn moved_cancelled_and_excluded_occurrences_are_handled() {
    let feed = parse(fixture!("exceptions.ics")).unwrap();
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-10-31", "UTC"),
        [
            "2026-10-01T10:00 Daily check-in",
            "2026-10-05T10:00 Daily check-in",
            "2026-10-10T10:00 Daily check-in",
            "2026-10-12T15:00 One meeting of a series I was invited to",
            "2026-10-14T15:00 (No title)",
            "2026-10-20T12:00 Daily check-in (moved to the 20th)",
        ]
    );
    // The 3rd was moved to the 20th: not on the 3rd, there on the 20th, even
    // though the rest of the series is long past by then.
    assert_eq!(
        lines(&feed, "2026-10-03", "2026-10-04", "UTC"),
        Vec::<String>::new()
    );
    assert_eq!(
        lines(&feed, "2026-10-20", "2026-10-20", "UTC"),
        ["2026-10-20T12:00 Daily check-in (moved to the 20th)"]
    );
    assert_eq!(
        lines(&feed, "2026-10-01", "2026-10-05", "UTC"),
        [
            "2026-10-01T10:00 Daily check-in",
            "2026-10-05T10:00 Daily check-in"
        ]
    );
}

#[test]
fn asking_for_a_range_checks_the_days() {
    let feed = parse(fixture!("exceptions.ics")).unwrap();
    assert!(events_between(&feed, "soon", "2026-10-31", None).is_err());
    assert!(events_between(&feed, "2026-10-31", "2026-10-01", None).is_err());
    assert!(events_between(&feed, "2026-01-01", "2027-03-01", None).is_err());
    assert!(events_between(&feed, "2026-01-01", "2027-02-04", None).is_ok());
}

#[test]
fn a_series_that_would_never_end_is_cut_off_and_says_so() {
    let feed = parse(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:busy\nSUMMARY:Every minute\nDTSTART:20260101T000000Z\n\
RRULE:FREQ=MINUTELY\nEND:VEVENT\nEND:VCALENDAR\n",
    )
    .unwrap();
    let made = events_between(&feed, "2026-03-01", "2026-03-31", Some("UTC")).unwrap();
    assert!(made.truncated);
    assert!(made.items.len() <= 2_000);
    // The overall limit applies too.
    let zones = Zones::new(feed.zones.clone(), viewer_zone(Some("UTC")));
    let window = Window {
        from: super::civil::parse_iso_day("2026-03-01").unwrap(),
        to: super::civil::parse_iso_day("2026-03-02").unwrap(),
    };
    let few = expand(&feed, &zones, window, 10);
    assert_eq!(few.items.len(), 10);
    assert!(few.truncated);
}

#[test]
fn a_hostile_feed_is_read_without_a_panic_or_a_hang() {
    // Years nobody has, lengths that overflow, rules that never match, a zone
    // name that is a path, a repeat of a billion hours: whatever comes out, it
    // comes out, and the ordinary event beside them is still there.
    let feed = parse(
        "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nUID:a\nDTSTART:00010101T000000Z\nRRULE:FREQ=DAILY;COUNT=999999999\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:b\nDTSTART:99991231T235959Z\nDTEND:00010101T000000Z\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:c\nDTSTART:20260101T000000Z\nDURATION:P99999999D\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:d\nDTSTART:20260101T000000Z\nRRULE:FREQ=YEARLY;BYWEEKNO=53;BYDAY=1MO,53MO,-53SU;BYSETPOS=366\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:e\nDTSTART;TZID=../../etc/passwd:20260101T000000\nRRULE:FREQ=HOURLY;INTERVAL=1000000000\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:f\nSUMMARY:Ordinary\nDTSTART:20260601T090000Z\nEND:VEVENT\n\
END:VCALENDAR\n",
    )
    .unwrap();
    let made = events_between(&feed, "2026-01-01", "2027-02-04", Some("UTC")).unwrap();
    assert!(made.items.iter().any(|o| o.title == "Ordinary"));
}

#[test]
fn a_zone_rule_with_a_huge_count_does_not_make_every_lookup_walk_from_its_first_year() {
    let mut text = String::from(
        "BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nTZID:Odd\nBEGIN:STANDARD\nDTSTART:16010101T000000\n\
TZOFFSETFROM:+0100\nTZOFFSETTO:+0100\nRRULE:FREQ=YEARLY;COUNT=100000;BYMONTH=3;BYDAY=2SU\n\
END:STANDARD\nEND:VTIMEZONE\n",
    );
    for n in 0..2_000 {
        text.push_str(&format!(
            "BEGIN:VEVENT\nUID:z{n}\nSUMMARY:Odd {n}\nDTSTART;TZID=Odd:2026{:02}{:02}T100000\nEND:VEVENT\n",
            1 + n % 12,
            1 + n % 28
        ));
    }
    text.push_str("END:VCALENDAR\n");
    let feed = parse(&text).unwrap();
    let made = events_between(&feed, "2026-01-01", "2026-12-31", Some("UTC")).unwrap();
    assert_eq!(made.items.len(), 2_000);
    assert!(made.items.iter().all(|o| o.zone_guess));
}

#[test]
fn a_feed_of_thousands_of_events_is_read_whole() {
    let mut text = String::from("BEGIN:VCALENDAR\nVERSION:2.0\n");
    for n in 0..6_000 {
        let day = 1 + n % 28;
        text.push_str(&format!(
            "BEGIN:VEVENT\nUID:e{n}\nSUMMARY:Event {n}\nDTSTART:2026{:02}{day:02}T100000Z\nEND:VEVENT\n",
            1 + n % 12
        ));
    }
    text.push_str("END:VCALENDAR\n");
    let feed = parse(&text).unwrap();
    assert_eq!(feed.events.len(), 6_000);
    let june = items(&feed, "2026-06-01", "2026-06-30", "UTC");
    assert_eq!(june.len(), 6_000 / 12);
}
