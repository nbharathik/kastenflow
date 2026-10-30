//! Looking for where an inline construct ends: a code span, a pair of
//! delimiters, a closing bracket, the target of a link. Every scan spends
//! from a shared budget, so a text full of unclosed openers is read in time
//! proportional to its length, not its square.

/// The longest link address read; a longer one is not a link.
const MAX_TARGET: usize = 1_000;

/// How many `ch` start at `i`.
pub(super) fn run_of(c: &[char], i: usize, ch: char) -> usize {
    c[i..].iter().take_while(|&&x| x == ch).count()
}

fn spend(budget: &mut usize) -> bool {
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    true
}

/// Just after the backticks that close the span of `k` backticks opened at
/// `i`, if some do (a run of exactly `k`).
pub(super) fn code_end(c: &[char], i: usize, k: usize, budget: &mut usize) -> Option<usize> {
    let mut j = i + k;
    while j < c.len() {
        if !spend(budget) {
            return None;
        }
        if c[j] == '`' {
            let run = run_of(c, j, '`');
            if run == k {
                return Some(j + run);
            }
            j += run;
        } else {
            j += 1;
        }
    }
    None
}

/// The first place from `from` where `ch` is written twice in a row, outside
/// a backslash escape.
pub(super) fn find_pair(c: &[char], from: usize, ch: char, budget: &mut usize) -> Option<usize> {
    let mut j = from;
    while j < c.len() {
        if !spend(budget) {
            return None;
        }
        if c[j] == '\\' {
            j += 2;
        } else if c[j] == ch && c.get(j + 1) == Some(&ch) && j > from {
            return Some(j);
        } else {
            j += 1;
        }
    }
    None
}

/// The run of `r` `ch` that closes the emphasis opened before `from`: not
/// preceded by a space, and for `_` not followed by a letter or digit.
/// Escapes and code spans are passed over.
pub(super) fn find_closer(
    c: &[char],
    from: usize,
    ch: char,
    r: usize,
    budget: &mut usize,
) -> Option<usize> {
    let mut j = from;
    while j < c.len() {
        if !spend(budget) {
            return None;
        }
        match c[j] {
            '\\' => j += 2,
            '`' => {
                let k = run_of(c, j, '`');
                j = code_end(c, j, k, budget).unwrap_or(j + k);
            }
            x if x == ch => {
                let run = run_of(c, j, ch);
                let next = c.get(j + run).copied();
                let closes = run == r
                    && j > from
                    && !c[j - 1].is_whitespace()
                    && (ch == '*' || !next.is_some_and(char::is_alphanumeric));
                if closes {
                    return Some(j);
                }
                j += run;
            }
            _ => j += 1,
        }
    }
    None
}

/// The `]` that closes the `[` at `open`, with the brackets inside balanced.
pub(super) fn close_bracket(c: &[char], open: usize, budget: &mut usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut j = open;
    while j < c.len() && j - open <= 2_000 {
        if !spend(budget) {
            return None;
        }
        match c[j] {
            '\\' => j += 1,
            '`' => {
                let k = run_of(c, j, '`');
                j = code_end(c, j, k, budget).unwrap_or(j + k) - 1;
            }
            '[' => depth += 1,
            ']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(j);
                }
            }
            _ => {}
        }
        j += 1;
    }
    None
}

/// The target of a link whose `(` is at `p`: the address (written without
/// its backslashes) and the place just after the `)`. A title after the
/// address is read and left out.
pub(super) fn parse_dest(c: &[char], p: usize) -> Option<(String, usize)> {
    let mut i = p + 1;
    let blank = |x: Option<&char>| x.is_some_and(|x| x.is_whitespace());
    while blank(c.get(i)) {
        i += 1;
    }
    let mut url = String::new();
    if c.get(i) == Some(&'<') {
        i += 1;
        while let Some(&x) = c.get(i) {
            if x == '>' {
                break;
            }
            if x == '\n' || x == '<' || url.len() > MAX_TARGET {
                return None;
            }
            url.push(x);
            i += 1;
        }
        c.get(i)?;
        i += 1;
    } else {
        let mut depth = 0usize;
        while let Some(&x) = c.get(i) {
            if x.is_whitespace() || x.is_control() {
                break;
            }
            if url.len() > MAX_TARGET {
                return None;
            }
            match x {
                '\\' if c.get(i + 1).is_some_and(char::is_ascii_punctuation) => {
                    url.push(c[i + 1]);
                    i += 2;
                    continue;
                }
                '(' => depth += 1,
                ')' => {
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
            url.push(x);
            i += 1;
        }
    }
    while blank(c.get(i)) {
        i += 1;
    }
    if let Some(&quote) = c.get(i)
        && matches!(quote, '"' | '\'' | '(')
    {
        let close = if quote == '(' { ')' } else { quote };
        let end = c[i + 1..].iter().take(500).position(|&x| x == close)?;
        i += end + 2;
        while blank(c.get(i)) {
            i += 1;
        }
    }
    (c.get(i) == Some(&')')).then_some((url, i + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn a_code_span_closes_on_a_run_of_the_same_length() {
        let c = chars("`a``b` c");
        assert_eq!(code_end(&c, 0, 1, &mut 100), Some(6));
        assert_eq!(code_end(&chars("``a`"), 0, 2, &mut 100), None);
    }

    #[test]
    fn emphasis_closes_on_a_run_of_its_own_length() {
        let c = chars("*a **b** c*");
        assert_eq!(find_closer(&c, 1, '*', 1, &mut 100), Some(10));
        assert_eq!(find_closer(&chars("*a *"), 1, '*', 1, &mut 100), None);
        assert_eq!(find_closer(&chars("_a_b"), 1, '_', 1, &mut 100), None);
    }

    #[test]
    fn brackets_balance() {
        let c = chars("[a [b] c](u)");
        assert_eq!(close_bracket(&c, 0, &mut 100), Some(8));
        assert_eq!(close_bracket(&chars("[a"), 0, &mut 100), None);
        assert_eq!(close_bracket(&chars("[a\\]"), 0, &mut 100), None);
    }

    #[test]
    fn link_targets() {
        let t = |s: &str| parse_dest(&chars(s), 0);
        assert_eq!(
            t("(http://x.org/a_(b))"),
            Some(("http://x.org/a_(b)".to_owned(), 20))
        );
        assert_eq!(t("(<a b>)"), Some(("a b".to_owned(), 7)));
        assert_eq!(t("(u \"Title\")"), Some(("u".to_owned(), 11)));
        assert_eq!(t("(u"), None);
        assert_eq!(t("(u \"x)"), None);
    }

    #[test]
    fn an_empty_budget_finds_nothing() {
        assert_eq!(find_closer(&chars("*a*"), 1, '*', 1, &mut 0), None);
        assert_eq!(find_pair(&chars("$$a$$"), 2, '$', &mut 0), None);
    }
}
