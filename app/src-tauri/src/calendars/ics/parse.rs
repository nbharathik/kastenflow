//! Reads an iCalendar feed (RFC 5545): the lines are unfolded, their names,
//! parameters and values split, nested into components, and the events and
//! time zones taken out. A broken line or event is left out; it never stops
//! the rest of a feed from being read.

use std::collections::HashMap;
use std::sync::Arc;

use super::civil::Local;
use super::rule::Rule;
use super::time::{
    Duration, When, parse_date_time, parse_duration, parse_offset, parse_when, unescape,
};
use super::zones::{CustomZone, Observance};

/// More events than this in one feed are not read.
const MAX_EVENTS: usize = 20_000;

/// One line of a component: `NAME;PARAM=value:value`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prop {
    pub name: String,
    pub params: Vec<(String, String)>,
    pub value: String,
}

impl Prop {
    pub fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// `BEGIN:NAME` to `END:NAME`, with what is inside.
#[derive(Clone, Debug, Default)]
pub struct Comp {
    pub name: String,
    pub props: Vec<Prop>,
    pub kids: Vec<Comp>,
}

impl Comp {
    pub fn prop(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }

    pub fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Prop> {
        self.props.iter().filter(move |p| p.name == name)
    }

    fn text(&self, name: &str) -> Option<String> {
        let value = unescape(self.prop(name)?.value.trim());
        (!value.is_empty()).then_some(value)
    }
}

/// An event of the feed, as written.
#[derive(Clone, Debug)]
pub struct Event {
    pub uid: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    pub conference: Option<String>,
    pub start: When,
    pub end: Option<When>,
    pub duration: Option<Duration>,
    pub rule: Option<Rule>,
    pub rdates: Vec<When>,
    pub exdates: Vec<When>,
    pub recurrence_id: Option<When>,
    /// The `RECURRENCE-ID` says `RANGE=THISANDFUTURE`: the change it makes
    /// holds for this occurrence and every later one of the series.
    pub this_and_future: bool,
    pub cancelled: bool,
    pub tentative: bool,
}

/// What was read from a feed.
#[derive(Clone, Debug, Default)]
pub struct Feed {
    /// The calendar's own name, if it has one.
    pub name: Option<String>,
    pub events: Vec<Event>,
    pub zones: HashMap<String, Arc<CustomZone>>,
}

fn unfolded(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if raw.starts_with([' ', '\t'])
            && let Some(last) = lines.last_mut()
        {
            last.push_str(&raw[1..]);
            continue;
        }
        if !raw.trim().is_empty() {
            lines.push(raw.to_owned());
        }
    }
    lines
}

/// Splits at `separator`, except inside double quotes.
fn split_unquoted(text: &str, separator: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut in_quotes = false;
    let mut from = 0;
    for (i, c) in text.char_indices() {
        if c == '"' {
            in_quotes = !in_quotes;
        } else if c == separator && !in_quotes {
            parts.push(&text[from..i]);
            from = i + c.len_utf8();
        }
    }
    parts.push(&text[from..]);
    parts
}

fn property(line: &str) -> Option<Prop> {
    let mut in_quotes = false;
    let colon = line.char_indices().find_map(|(i, c)| {
        if c == '"' {
            in_quotes = !in_quotes;
        }
        (c == ':' && !in_quotes).then_some(i)
    })?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = split_unquoted(head, ';').into_iter();
    let name = parts.next()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts
        .filter_map(|p| {
            let (key, value) = p.split_once('=')?;
            Some((
                key.trim().to_ascii_uppercase(),
                value.trim().trim_matches('"').to_owned(),
            ))
        })
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_owned(),
    })
}

fn close(comp: Comp, stack: &mut [Comp], done: &mut Vec<Comp>) {
    match stack.last_mut() {
        Some(parent) => parent.kids.push(comp),
        None => done.push(comp),
    }
}

/// The components of a feed text: normally one `VCALENDAR`.
pub fn components(text: &str) -> Vec<Comp> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut done = Vec::new();
    let mut stack: Vec<Comp> = Vec::new();
    for line in unfolded(text) {
        let Some(prop) = property(&line) else {
            continue;
        };
        match prop.name.as_str() {
            "BEGIN" => stack.push(Comp {
                name: prop.value.trim().to_ascii_uppercase(),
                ..Comp::default()
            }),
            "END" => {
                let name = prop.value.trim().to_ascii_uppercase();
                if let Some(at) = stack.iter().rposition(|c| c.name == name) {
                    while stack.len() > at {
                        if let Some(comp) = stack.pop() {
                            close(comp, &mut stack, &mut done);
                        }
                    }
                }
            }
            _ => {
                if let Some(top) = stack.last_mut() {
                    top.props.push(prop);
                }
            }
        }
    }
    while let Some(comp) = stack.pop() {
        close(comp, &mut stack, &mut done);
    }
    done
}

/// The times a property lists, a comma apart; a period counts by its start.
fn whens(prop: &Prop) -> Vec<When> {
    let tzid = prop.param("TZID");
    let kind = prop
        .param("VALUE")
        .filter(|k| !k.eq_ignore_ascii_case("PERIOD"));
    prop.value
        .split(',')
        .filter_map(|v| parse_when(v.split('/').next().unwrap_or(v), tzid, kind))
        .collect()
}

fn when(comp: &Comp, name: &str) -> Option<When> {
    let prop = comp.prop(name)?;
    parse_when(&prop.value, prop.param("TZID"), prop.param("VALUE"))
}

/// The first web address in a text.
pub fn first_url(text: &str) -> Option<String> {
    let at = text.find("https://").or_else(|| text.find("http://"))?;
    let url: String = text[at..]
        .chars()
        .take_while(|c| !c.is_whitespace() && !matches!(c, '<' | '>' | '"' | ')'))
        .collect();
    let url = url.trim_end_matches(['.', ',', ';']).to_owned();
    (url.len() > "https://".len()).then_some(url)
}

fn event_of(comp: &Comp, number: usize) -> Option<Event> {
    let start = when(comp, "DTSTART")?;
    let status = comp
        .prop("STATUS")
        .map(|p| p.value.trim().to_ascii_uppercase());
    let title = comp.text("SUMMARY").unwrap_or_default();
    Some(Event {
        uid: comp
            .text("UID")
            .unwrap_or_else(|| format!("no-uid-{number}")),
        title,
        description: comp.text("DESCRIPTION"),
        location: comp.text("LOCATION"),
        url: comp
            .prop("URL")
            .map(|p| p.value.trim().to_owned())
            .filter(|u| !u.is_empty()),
        conference: comp.text("X-GOOGLE-CONFERENCE"),
        end: when(comp, "DTEND"),
        duration: comp.prop("DURATION").and_then(|p| parse_duration(&p.value)),
        rule: comp.prop("RRULE").and_then(|p| Rule::parse(&p.value)),
        rdates: comp.all("RDATE").flat_map(whens).collect(),
        exdates: comp.all("EXDATE").flat_map(whens).collect(),
        recurrence_id: when(comp, "RECURRENCE-ID"),
        this_and_future: comp
            .prop("RECURRENCE-ID")
            .and_then(|p| p.param("RANGE"))
            .is_some_and(|range| range.eq_ignore_ascii_case("THISANDFUTURE")),
        cancelled: status.as_deref() == Some("CANCELLED"),
        tentative: status.as_deref() == Some("TENTATIVE"),
        start,
    })
}

fn observance(comp: &Comp) -> Option<Observance> {
    let (start, _) = parse_date_time(&comp.prop("DTSTART")?.value)?;
    let offset_to = parse_offset(&comp.prop("TZOFFSETTO")?.value)?;
    Some(Observance {
        offset_to,
        start,
        rule: comp.prop("RRULE").and_then(|p| Rule::parse(&p.value)),
        rdates: comp
            .all("RDATE")
            .flat_map(|p| p.value.split(','))
            .filter_map(|v| parse_date_time(v).map(|(at, _)| at))
            .collect::<Vec<Local>>(),
    })
}

fn zone_of(comp: &Comp) -> Option<(String, CustomZone)> {
    let tzid = comp.prop("TZID")?.value.trim().trim_matches('"').to_owned();
    let hint = comp
        .prop("X-LIC-LOCATION")
        .map(|p| p.value.trim().to_owned())
        .filter(|h| !h.is_empty());
    let observances = comp
        .kids
        .iter()
        .filter(|k| k.name == "STANDARD" || k.name == "DAYLIGHT")
        .filter_map(observance)
        .collect();
    Some((tzid, CustomZone { hint, observances }))
}

/// Reads a feed. An error only when the text is not a calendar at all.
pub fn parse(text: &str) -> Result<Feed, String> {
    let calendars: Vec<Comp> = components(text)
        .into_iter()
        .filter(|c| c.name == "VCALENDAR")
        .collect();
    if calendars.is_empty() {
        return Err("That address did not give a calendar".into());
    }
    let mut feed = Feed::default();
    let mut number = 0;
    for calendar in &calendars {
        feed.name = feed.name.take().or_else(|| {
            calendar
                .text("X-WR-CALNAME")
                .or_else(|| calendar.text("NAME"))
        });
        for kid in &calendar.kids {
            match kid.name.as_str() {
                "VTIMEZONE" => {
                    if let Some((tzid, zone)) = zone_of(kid) {
                        feed.zones.insert(tzid, Arc::new(zone));
                    }
                }
                "VEVENT" if feed.events.len() < MAX_EVENTS => {
                    number += 1;
                    feed.events.extend(event_of(kid, number));
                }
                _ => {}
            }
        }
    }
    Ok(feed)
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod tests;
