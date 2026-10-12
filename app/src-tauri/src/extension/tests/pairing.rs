//! The pairing code: 8 characters, 2 minutes, 5 tries, used once.

use std::time::{Duration, Instant};

use super::super::pairing::{Pairing, Refused, TRIES, TTL, new_code};

fn pairing() -> Pairing {
    Pairing::new(TTL, TRIES)
}

#[test]
fn a_code_is_8_characters_that_are_hard_to_mistake() {
    for _ in 0..200 {
        let code = new_code().unwrap();
        assert_eq!(code.len(), 8);
        assert!(
            code.chars()
                .all(|c| c.is_ascii_uppercase() && !"IO".contains(c) || ('2'..='9').contains(&c)),
            "{code}"
        );
    }
    assert_ne!(new_code().unwrap(), new_code().unwrap());
    assert_eq!((TTL, TRIES), (Duration::from_secs(120), 5));
}

#[test]
fn a_right_code_works_once_and_not_again() {
    let now = Instant::now();
    let mut p = pairing();
    let offer = p.start("ABCD2345".to_owned(), now);
    assert_eq!((offer.seconds_left, offer.tries_left), (120, 5));
    assert!(p.attempt("ABCD2345", now).is_ok());
    assert_eq!(p.attempt("ABCD2345", now), Err(Refused::None), "a replay");
    assert!(p.offer(now).is_none());
}

#[test]
fn spaces_dashes_and_case_do_not_matter() {
    let now = Instant::now();
    for typed in ["abcd2345", "ABCD-2345", " abcd 2345 ", "Abcd-2345\n"] {
        let mut p = pairing();
        p.start("ABCD2345".to_owned(), now);
        assert!(p.attempt(typed, now).is_ok(), "{typed:?}");
    }
}

#[test]
fn five_wrong_tries_end_the_code_even_for_the_right_one() {
    let now = Instant::now();
    let mut p = pairing();
    p.start("ABCD2345".to_owned(), now);
    assert_eq!(p.attempt("AAAAAAAA", now), Err(Refused::Wrong { left: 4 }));
    assert_eq!(p.attempt("", now), Err(Refused::Wrong { left: 3 }));
    assert_eq!(p.attempt("ABCD234", now), Err(Refused::Wrong { left: 2 }));
    assert_eq!(p.attempt("ABCD23456", now), Err(Refused::Wrong { left: 1 }));
    assert_eq!(p.offer(now).unwrap().tries_left, 1);
    assert_eq!(p.attempt("ZZZZZZZZ", now), Err(Refused::Spent));
    assert_eq!(p.attempt("ABCD2345", now), Err(Refused::None));
}

#[test]
fn a_right_code_after_some_wrong_ones_still_works() {
    let now = Instant::now();
    let mut p = pairing();
    p.start("ABCD2345".to_owned(), now);
    assert!(p.attempt("WRONGONE", now).is_err());
    assert!(p.attempt("ABCD2345", now).is_ok());
}

#[test]
fn a_code_ends_after_two_minutes() {
    let now = Instant::now();
    let mut p = pairing();
    p.start("ABCD2345".to_owned(), now);
    let late = now + TTL - Duration::from_secs(1);
    assert_eq!(p.offer(late).unwrap().seconds_left, 2);
    let over = now + TTL;
    assert!(p.offer(over).is_none());
    assert_eq!(p.attempt("ABCD2345", over), Err(Refused::Expired));
    assert_eq!(p.attempt("ABCD2345", over), Err(Refused::None));
}

#[test]
fn a_new_code_takes_the_place_of_the_old_one_and_cancel_throws_it_away() {
    let now = Instant::now();
    let mut p = pairing();
    p.start("ABCD2345".to_owned(), now);
    p.attempt("WRONGONE", now).unwrap_err();
    p.start("WXYZ6789".to_owned(), now);
    assert_eq!(p.offer(now).unwrap().tries_left, 5, "fresh tries");
    assert!(p.attempt("ABCD2345", now).is_err());
    p.cancel();
    assert_eq!(p.attempt("WXYZ6789", now), Err(Refused::None));
}

#[test]
fn what_the_extension_is_told_does_not_depend_on_the_code() {
    for refused in [
        Refused::None,
        Refused::Expired,
        Refused::Wrong { left: 1 },
        Refused::Wrong { left: 4 },
        Refused::Spent,
    ] {
        let words = refused.words();
        assert!(!words.is_empty() && !words.contains("ABCD"));
    }
    assert!(Refused::Wrong { left: 4 }.words().contains("4 tries"));
}
