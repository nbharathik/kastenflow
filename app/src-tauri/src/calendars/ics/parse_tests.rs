//! The feed reader: lines, parameters, components, events and zones.

use super::*;
use crate::calendars::ics::time::Frame;

const SMALL: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Work\r\n\
BEGIN:VEVENT\r\nUID:a@x\r\nSUMMARY:Team sync\\, weekly\r\n\
DTSTART;TZID=Europe/Paris:20261012T090000\r\nDTEND;TZID=Europe/Paris:20261012T100000\r\n\
LOCATION:Room 1\r\nDESCRIPTION:Line one\\nLine \r\n two\r\nSTATUS:TENTATIVE\r\n\
BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

#[test]
fn lines_unfold_and_split_into_names_parameters_and_values() {
    // A line that starts with a space or a tab continues the one before it,
    // minus that one character.
    let lines = unfolded("A:1\r\nB:long\r\n  value\r\n\tmore\r\n\r\nC:3");
    assert_eq!(lines, ["A:1", "B:long valuemore", "C:3"]);
}

#[test]
fn a_quoted_parameter_may_hold_colons_and_semicolons() {
    let p =
        property("ATTENDEE;CN=\"Doe; Jane: Ph.D.\";ROLE=CHAIR:mailto:jane@example.com").unwrap();
    assert_eq!(p.name, "ATTENDEE");
    assert_eq!(p.param("CN"), Some("Doe; Jane: Ph.D."));
    assert_eq!(p.param("ROLE"), Some("CHAIR"));
    assert_eq!(p.value, "mailto:jane@example.com");
    assert!(property("no colon here").is_none());
    assert!(property(":value").is_none());
}

#[test]
fn reads_an_event_with_its_fields() {
    let feed = parse(SMALL).unwrap();
    assert_eq!(feed.name.as_deref(), Some("Work"));
    assert_eq!(feed.events.len(), 1);
    let e = &feed.events[0];
    assert_eq!(e.uid, "a@x");
    assert_eq!(e.title, "Team sync, weekly");
    assert_eq!(e.location.as_deref(), Some("Room 1"));
    assert_eq!(e.description.as_deref(), Some("Line one\nLine two"));
    assert_eq!(e.start.frame, Frame::Zone("Europe/Paris".into()));
    assert_eq!(e.start.at, Local::new(2026, 10, 12, 9, 0, 0));
    assert_eq!(
        e.end.as_ref().map(|w| w.at),
        Some(Local::new(2026, 10, 12, 10, 0, 0))
    );
    assert!(e.tentative && !e.cancelled);
}

#[test]
fn rules_exceptions_and_extra_dates_are_kept() {
    let feed = parse(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:r\nDTSTART:20261012T090000Z\nRRULE:FREQ=DAILY;COUNT=5\n\
EXDATE:20261013T090000Z,20261014T090000Z\nEXDATE:20261015T090000Z\n\
RDATE;VALUE=PERIOD:20261020T090000Z/20261020T100000Z\nRECURRENCE-ID:20261012T090000Z\nEND:VEVENT\nEND:VCALENDAR\n",
    )
    .unwrap();
    let e = &feed.events[0];
    assert!(e.rule.is_some());
    assert_eq!(e.exdates.len(), 3);
    assert_eq!(e.rdates.len(), 1);
    assert_eq!(e.rdates[0].at, Local::new(2026, 10, 20, 9, 0, 0));
    assert!(e.recurrence_id.is_some());
}

#[test]
fn a_time_zone_is_read_with_its_rules() {
    let feed = parse(
        "BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nTZID:Company HQ Time\nX-LIC-LOCATION:Europe/Rome\n\
BEGIN:STANDARD\nDTSTART:19701025T030000\nTZOFFSETFROM:+0200\nTZOFFSETTO:+0100\n\
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\nEND:STANDARD\n\
BEGIN:DAYLIGHT\nDTSTART:19700329T020000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0200\n\
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\nEND:DAYLIGHT\nEND:VTIMEZONE\nEND:VCALENDAR\n",
    )
    .unwrap();
    let zone = &feed.zones["Company HQ Time"];
    assert_eq!(zone.hint.as_deref(), Some("Europe/Rome"));
    assert_eq!(zone.observances.len(), 2);
    assert_eq!(zone.offset_at(Local::new(2026, 7, 1, 12, 0, 0)), Some(7200));
    assert_eq!(
        zone.offset_at(Local::new(2026, 12, 1, 12, 0, 0)),
        Some(3600)
    );
}

#[test]
fn a_broken_event_is_left_out_and_the_rest_is_kept() {
    let feed = parse(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:bad\nSUMMARY:no start\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:bad2\nDTSTART:soon\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:ok\nDTSTART;VALUE=DATE:20261012\nSUMMARY:Holiday\nEND:VEVENT\n\
BEGIN:VEVENT\nUID:cut\nDTSTART:20261013T090000Z\nSUMMARY:No end marker\n",
    )
    .unwrap();
    let uids: Vec<_> = feed.events.iter().map(|e| e.uid.as_str()).collect();
    // The last event had no END lines at all (a feed cut short): it is
    // read as far as it goes.
    assert_eq!(uids, ["ok", "cut"]);
}

#[test]
fn text_that_is_not_a_calendar_is_an_error() {
    assert!(parse("<html><body>Sign in</body></html>").is_err());
    assert!(parse("").is_err());
    assert!(parse("\u{feff}BEGIN:VCALENDAR\nEND:VCALENDAR").is_ok());
}

#[test]
fn finds_the_first_web_address_in_a_text() {
    assert_eq!(
        first_url("Join: https://meet.example.com/abc-def. Thanks").as_deref(),
        Some("https://meet.example.com/abc-def")
    );
    assert_eq!(
        first_url("see http://a.example/x)").as_deref(),
        Some("http://a.example/x")
    );
    assert_eq!(first_url("no link"), None);
    assert_eq!(first_url("https://"), None);
}
