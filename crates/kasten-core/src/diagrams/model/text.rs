//! Text helpers for cells: XML attribute escaping, labels as plain text and
//! as draw.io's HTML, numbers as the editor writes them, and ids.

/// `s` as the inside of a double-quoted attribute.
pub fn esc_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + s.len() / 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#xa;"),
            '\r' => out.push_str("&#xd;"),
            '\t' => out.push_str("&#x9;"),
            c => out.push(c),
        }
    }
    out
}

/// Plain text as the HTML of a label: markup characters escaped and each new
/// line a `<br>`.
pub fn label_html(plain: &str) -> String {
    let mut out = String::with_capacity(plain.len() + 8);
    for c in plain.replace("\r\n", "\n").chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\n' => out.push_str("<br>"),
            c => out.push(c),
        }
    }
    out
}

fn entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ => {
            let digits = name.strip_prefix('#')?;
            let n = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => digits.parse().ok()?,
            };
            char::from_u32(n)
        }
    }
}

/// A label's HTML as the words a person reads: tags dropped, `<br>` and the
/// end of a block a new line, entities decoded.
pub fn plain_label(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find(['<', '&']) {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        if rest.starts_with('<') {
            let Some(end) = rest.find('>') else {
                out.push_str(rest);
                rest = "";
                break;
            };
            let tag = rest[1..end]
                .trim()
                .trim_end_matches('/')
                .trim()
                .to_lowercase();
            let name = tag.split_whitespace().next().unwrap_or("");
            let breaks = matches!(
                name,
                "br" | "div" | "p" | "li" | "tr" | "/div" | "/p" | "/li" | "/tr"
            );
            if breaks && !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            rest = &rest[end + 1..];
        } else {
            match rest[1..]
                .find(';')
                .filter(|n| *n <= 10)
                .and_then(|n| entity(&rest[1..1 + n]).map(|c| (c, n)))
            {
                Some((c, n)) => {
                    out.push(c);
                    rest = &rest[n + 2..];
                }
                None => {
                    out.push('&');
                    rest = &rest[1..];
                }
            }
        }
    }
    out.push_str(rest);
    out.trim_matches('\n').to_owned()
}

/// A number as the editor writes it: whole numbers plain, others to two places.
pub fn fmt_num(n: f64) -> String {
    let r = (n * 100.0).round() / 100.0;
    if r == r.trunc() {
        format!("{}", r as i64)
    } else {
        let s = format!("{r:.2}");
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    }
}

/// Whether `id` is one an agent may give a cell.
pub fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'.' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_survives_a_trip_through_a_label() {
        for plain in [
            "Web app",
            "A & B",
            "a < b > c",
            "two\nlines",
            "5 &amp; 6",
            "\"quoted\"",
        ] {
            let html = label_html(plain);
            assert_eq!(plain_label(&html), plain, "{html}");
            // And the attribute holds no raw markup.
            let attr = esc_attr(&html);
            assert!(!attr.contains('<') && !attr.contains('"'), "{attr}");
        }
    }

    #[test]
    fn a_label_from_the_editor_reads_as_words() {
        assert_eq!(plain_label("API<br>gateway"), "API\ngateway");
        assert_eq!(
            plain_label("<font style=\"font-size: 16px\"><b>Shop</b></font><div>[System]</div>"),
            "Shop\n[System]"
        );
        assert_eq!(
            plain_label("Orders &amp; users&nbsp;now"),
            "Orders & users now"
        );
        assert_eq!(plain_label("a &bogus; b"), "a &bogus; b");
    }

    #[test]
    fn numbers_and_ids_follow_the_editors_habits() {
        assert_eq!(fmt_num(40.0), "40");
        assert_eq!(fmt_num(40.5), "40.5");
        assert_eq!(fmt_num(1.0 / 3.0), "0.33");
        assert_eq!(fmt_num(-10.004), "-10");
        assert!(valid_id("web-1.a:b_c"));
        assert!(!valid_id("") && !valid_id("a b") && !valid_id(&"x".repeat(65)));
        assert!(!valid_id("a\"b") && !valid_id("a<b"));
    }
}
