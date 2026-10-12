//! The recurrence examples of RFC 5545 section 3.8.5.3, in
//! `fixtures/ics/rfc5545-examples.ics`, one event each, in New York time.
//! Each event carries what the RFC lists for it:
//!
//! - `X-EXPECT`: the full list;
//! - `X-EXPECT-HEAD`: the first moments of a series that has no end;
//! - `X-EXPECT-COUNT` and `X-EXPECT-LAST`: how many, and the last, of a long one;
//! - `X-TO`: the day the range being looked at ends (else the end of 2010).

use super::civil::parse_iso_day;
use super::expand::{Window, expand};
use super::parse::{Comp, Feed, components, parse};
use super::time::parse_date_time;
use super::zones::{Zones, viewer_zone};

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/ics/rfc5545-examples.ics"
));

/// `19970902T090000,...` as `1997-09-02T09:00`.
fn minutes(list: &str) -> Vec<String> {
    list.split(',')
        .map(|t| {
            parse_date_time(t)
                .expect("a time in the fixture")
                .0
                .iso_minute()
        })
        .collect()
}

fn expected<'a>(comp: &'a Comp, name: &str) -> Option<&'a str> {
    comp.prop(name).map(|p| p.value.trim())
}

#[test]
fn every_example_in_the_rfc_gives_what_the_rfc_lists() {
    let feed = parse(FIXTURE).unwrap();
    let calendar = components(FIXTURE).remove(0);
    let comps: Vec<&Comp> = calendar
        .kids
        .iter()
        .filter(|k| k.name == "VEVENT")
        .collect();
    assert_eq!(comps.len(), feed.events.len(), "every example is read");
    assert!(comps.len() >= 40);
    let zones = Zones::new(feed.zones.clone(), viewer_zone(Some("America/New_York")));
    for (event, comp) in feed.events.iter().zip(&comps) {
        let to = expected(comp, "X-TO")
            .map_or_else(|| parse_iso_day("2010-12-31"), parse_iso_day)
            .unwrap();
        let window = Window {
            from: parse_iso_day("1990-01-01").unwrap(),
            to,
        };
        let one = Feed {
            events: vec![event.clone()],
            ..Feed::default()
        };
        let made = expand(&one, &zones, window, 100_000);
        let got: Vec<&str> = made.items.iter().map(|o| o.start.as_str()).collect();
        let what = format!("{} ({})", event.title, event.uid);
        assert!(!got.is_empty(), "{what}: nothing came out");
        if let Some(all) = expected(comp, "X-EXPECT") {
            assert_eq!(got, minutes(all), "{what}");
        }
        if let Some(head) = expected(comp, "X-EXPECT-HEAD") {
            let head = minutes(head);
            assert_eq!(
                &got[..head.len().min(got.len())],
                head,
                "{what}: the first ones"
            );
        }
        if let Some(count) = expected(comp, "X-EXPECT-COUNT") {
            assert_eq!(
                got.len(),
                count.parse::<usize>().unwrap(),
                "{what}: how many"
            );
        }
        if let Some(last) = expected(comp, "X-EXPECT-LAST") {
            assert_eq!(
                got.last().copied(),
                Some(minutes(last)[0].as_str()),
                "{what}: the last"
            );
        }
    }
}
