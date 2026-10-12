use super::*;

#[test]
fn knows_the_days_on_the_calendar() {
    for day in [
        "2026-10-06",
        "2026-12-31",
        "2024-02-29",
        "2000-02-29",
        "0001-01-01",
        "9999-12-31",
        "2026-04-30",
    ] {
        assert!(is_real_day(day), "{day}");
    }
}

#[test]
fn refuses_days_that_only_look_like_days() {
    for day in [
        "2026-02-30",
        "2026-13-45",
        "2026-00-10",
        "2026-10-00",
        "2026-04-31",
        "2025-02-29",
        "1900-02-29",
        "2100-02-29",
        "0000-01-01",
        "2026-1-05",
        "2026-10-6",
        "2026-10-066",
        "2026/10/06",
        "2026-10-06 ",
        " 2026-10-06",
        "",
        "today",
        // Only ASCII digits are digits: no panic on a cut inside a letter.
        "٢٠٢٦-١٠-٠٦",
        "2026-10-0é",
        "é026-10-06",
    ] {
        assert!(!is_real_day(day), "{day:?}");
    }
}

#[test]
fn reads_a_24_hour_time_that_follows_after_a_space() {
    let at = |s: &str| time_after(s);
    assert_eq!(at(" 09:00"), Some("09:00".into()));
    assert_eq!(at(" 9:05"), Some("09:05".into()));
    assert_eq!(at("  23:59 then"), Some("23:59".into()));
    assert_eq!(at("\t0:00."), Some("00:00".into()));
    assert_eq!(at(" 14:30, with Sam"), Some("14:30".into()));
    assert_eq!(at(" 09:00-10:00"), Some("09:00".into()));
    // Only a time, whole: nothing else glued to it.
    for text in [
        "",
        " ",
        "09:00",
        " 24:00",
        " 25:00",
        " 9:60",
        " 09:0",
        " 09:005",
        " 123:00",
        " 9:5",
        " 09:00pm",
        " 9:05am",
        " 09:00:30",
        " x09:00",
        " :30",
        " 09-00",
    ] {
        assert_eq!(at(text), None, "{text:?}");
    }
}

#[test]
fn a_day_link_gives_its_time() {
    assert_eq!(
        due_at("Call Sam [[2026-10-07]] 09:00 about it"),
        Some(("2026-10-07".into(), Some("09:00".into())))
    );
    assert_eq!(
        due_at("[[2026-10-07|tomorrow]] 14:30"),
        Some(("2026-10-07".into(), Some("14:30".into())))
    );
    assert_eq!(
        due_at("Dentist [[2026-10-07]]"),
        Some(("2026-10-07".into(), None))
    );
    assert_eq!(
        due_at("[[2026-10-07]]09:00"),
        Some(("2026-10-07".into(), None))
    );
    assert_eq!(
        due_at("[[2026-10-07]] 25:00"),
        Some(("2026-10-07".into(), None))
    );
    // The first day link, with its own time.
    assert_eq!(
        due_at("[[2026-10-07]] 09:00 and [[2026-10-08]] 10:00"),
        Some(("2026-10-07".into(), Some("09:00".into())))
    );
}

#[test]
fn an_at_date_gives_its_time() {
    assert_eq!(
        due_at("Book room @2026-10-07 9:05"),
        Some(("2026-10-07".into(), Some("09:05".into())))
    );
    assert_eq!(
        due_at("Book room @2026-10-07 25:00"),
        Some(("2026-10-07".into(), None))
    );
    assert_eq!(due_at("@2026-10-07"), Some(("2026-10-07".into(), None)));
}

#[test]
fn keeps_the_order_links_then_at_then_calendar_sign() {
    assert_eq!(
        due_at("@2026-01-01 [[2026-02-02]] 10:00"),
        Some(("2026-02-02".into(), Some("10:00".into())))
    );
    assert_eq!(
        due_at("📅 2026-03-03 @2026-01-01 08:15"),
        Some(("2026-01-01".into(), Some("08:15".into())))
    );
    // The sign gives a day only.
    assert_eq!(
        due_at("call 📅 2026-12-24 10:00 now"),
        Some(("2026-12-24".into(), None))
    );
    assert_eq!(
        due_at("call 📅2026-12-24"),
        Some(("2026-12-24".into(), None))
    );
}

#[test]
fn a_date_that_is_not_on_the_calendar_is_plain_text() {
    assert_eq!(due_at("[[2026-02-30]] 09:00"), None);
    assert_eq!(due_at("[[2026-13-45]]"), None);
    assert_eq!(due_at("@2026-13-45 09:00"), None);
    assert_eq!(due_at("📅 2026-02-30"), None);
    assert_eq!(due_at("no date 2026-12-24"), None);
    // The next real day is taken instead.
    assert_eq!(
        due_at("[[2026-02-30]] @2026-03-01 08:00"),
        Some(("2026-03-01".into(), Some("08:00".into())))
    );
    assert_eq!(
        due_at("[[2026-02-30]] then [[2026-03-02]] 07:30"),
        Some(("2026-03-02".into(), Some("07:30".into())))
    );
    assert_eq!(due_date("[[2026-02-30]]"), None);
    assert_eq!(due_date("[[2026-10-07]] 09:00"), Some("2026-10-07".into()));
}
