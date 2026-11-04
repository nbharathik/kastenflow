//! How a chart writes a number: a small subset of the patterns a spreadsheet takes, so a person or an
//! agent can say `#,##0`, `0.0`, `$#,##0.00`, `0%` or `0.0" kg"` and get the same numbers on the axis
//! and on the marks. A digit place is `0` (always written) or `#` (written only if needed after the
//! decimal point); a comma in the whole part groups the thousands; a `%` anywhere makes the number
//! a share (0.25 is written 25%); any other characters before and after the pattern are written as they are.

/// The longest pattern: a format is a few characters.
const LONGEST: usize = 32;
/// The most digits after the decimal point.
const MOST_DECIMALS: usize = 6;

/// A pattern for writing numbers, checked.
#[derive(Clone, Debug, PartialEq)]
pub struct NumberFormat {
    prefix: String,
    suffix: String,
    grouping: bool,
    least: usize,
    most: usize,
    percent: bool,
}

fn is_digit_place(c: char) -> bool {
    c == '#' || c == '0'
}

fn literal(text: &str) -> String {
    text.replace('"', "")
}

impl NumberFormat {
    /// Reads a pattern. The error finishes the sentence "`format` ...".
    pub fn parse(text: &str) -> Result<NumberFormat, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("is empty: write a pattern such as `#,##0` or `0.0%`".to_owned());
        }
        if text.chars().count() > LONGEST {
            return Err(format!("is longer than {LONGEST} characters"));
        }
        let start = text.find(is_digit_place).ok_or_else(|| {
            "needs a place for the digits, such as `0` or `#,##0` (`0.0` has one decimal)"
                .to_owned()
        })?;
        let rest = &text[start..];
        let length = rest
            .find(|c: char| !matches!(c, '#' | '0' | ',' | '.'))
            .unwrap_or(rest.len());
        let (pattern, after) = rest.split_at(length);
        if after.contains(is_digit_place) {
            return Err("has two number patterns: use one, such as `#,##0.0`".to_owned());
        }
        if pattern.matches('.').count() > 1 {
            return Err("has two decimal points".to_owned());
        }
        let (whole, fraction) = pattern.split_once('.').unwrap_or((pattern, ""));
        if fraction.contains(',') {
            return Err("has a comma after the decimal point".to_owned());
        }
        let most = fraction.chars().filter(|c| is_digit_place(*c)).count();
        if most > MOST_DECIMALS {
            return Err(format!("asks for more than {MOST_DECIMALS} decimals"));
        }
        let prefix = literal(&text[..start]);
        let suffix = literal(after);
        Ok(NumberFormat {
            percent: prefix.contains('%') || suffix.contains('%'),
            grouping: whole.contains(','),
            least: fraction.matches('0').count(),
            most,
            prefix,
            suffix,
        })
    }

    /// The number as the pattern writes it.
    pub fn apply(&self, value: f64) -> String {
        let mut v = if value.is_finite() { value } else { 0.0 };
        if self.percent {
            v *= 100.0;
        }
        let text = format!("{:.*}", self.most, v.abs());
        let (whole, fraction) = text.split_once('.').unwrap_or((text.as_str(), ""));
        let mut fraction = fraction.to_owned();
        while fraction.len() > self.least && fraction.ends_with('0') {
            fraction.pop();
        }
        let mut digits = String::new();
        for (i, c) in whole.chars().enumerate() {
            if self.grouping && i > 0 && (whole.len() - i) % 3 == 0 {
                digits.push(',');
            }
            digits.push(c);
        }
        let zero = text.chars().all(|c| c == '0' || c == '.');
        let sign = if v < 0.0 && !zero { "-" } else { "" };
        let point = if fraction.is_empty() { "" } else { "." };
        format!(
            "{sign}{}{digits}{point}{fraction}{}",
            self.prefix, self.suffix
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(pattern: &str, value: f64) -> String {
        NumberFormat::parse(pattern).unwrap().apply(value)
    }

    #[test]
    fn digits_decimals_and_thousands_are_written_as_the_pattern_says() {
        assert_eq!(write("#,##0", 1234.6), "1,235");
        assert_eq!(write("#,##0", 12.0), "12");
        assert_eq!(write("0", 1234.6), "1235");
        assert_eq!(write("0.0", 4.56789), "4.6");
        assert_eq!(write("0.00", 2.0), "2.00");
        assert_eq!(write("#,##0.00", 1234567.891), "1,234,567.89");
        // `#` after the point is only written when needed.
        assert_eq!(write("0.0#", 2.5), "2.5");
        assert_eq!(write("0.0#", 2.25), "2.25");
        assert_eq!(write("0.##", 4.0), "4");
    }

    #[test]
    fn a_share_a_prefix_and_a_suffix_are_kept_and_a_sign_goes_in_front() {
        assert_eq!(write("0%", 0.256), "26%");
        assert_eq!(write("0.0%", 0.256), "25.6%");
        assert_eq!(write("$#,##0", -1234.6), "-$1,235");
        assert_eq!(write("0.0\" kg\"", 3.0), "3.0 kg");
        assert_eq!(write("\u{20ac}0.00", 5.0), "\u{20ac}5.00");
        assert_eq!(write("0.0", -0.001), "0.0", "a rounded zero has no sign");
    }

    #[test]
    fn what_is_not_a_number_is_written_as_zero() {
        assert_eq!(write("0.0", f64::NAN), "0.0");
        assert_eq!(write("#,##0", f64::INFINITY), "0");
    }

    #[test]
    fn a_pattern_that_cannot_be_used_says_why() {
        for (bad, why) in [
            ("", "is empty"),
            ("abc", "needs a place for the digits"),
            ("0 0", "two number patterns"),
            ("0.0.0", "two decimal points"),
            ("0.0,0", "comma after the decimal point"),
            ("0.0000000", "more than 6 decimals"),
        ] {
            let error = NumberFormat::parse(bad).unwrap_err();
            assert!(error.contains(why), "{bad}: {error}");
        }
        let long = NumberFormat::parse(&"0".repeat(40)).unwrap_err();
        assert!(long.contains("longer than 32"), "{long}");
    }
}
