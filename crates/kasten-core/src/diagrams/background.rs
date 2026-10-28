//! The background a diagram says it has, for the picture made of it: its
//! `mxGraphModel` may carry `background="#rrggbb"` (the editor's page colour)
//! or `background="none"`. Anything else, and a model the page keeps
//! compressed, is white, which is what a figure in a document wants.

/// What a picture of a diagram is drawn on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Background {
    White,
    /// The diagram says it has none.
    Transparent,
    /// A colour as `#rrggbb`, lower case.
    Color(String),
}

impl Background {
    /// As a CSS colour.
    pub fn css(&self) -> &str {
        match self {
            Background::White => "#ffffff",
            Background::Transparent => "transparent",
            Background::Color(color) => color,
        }
    }
}

/// `#rgb` or `#rrggbb` as `#rrggbb`; none for anything else.
fn hex(value: &str) -> Option<String> {
    let digits = value.strip_prefix('#')?;
    if !digits.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match digits.len() {
        6 => Some(format!("#{}", digits.to_ascii_lowercase())),
        3 => Some(format!(
            "#{}",
            digits
                .chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase()
        )),
        _ => None,
    }
}

/// The background the source says its first page has.
pub fn background_of(xml: &str) -> Background {
    let Some(start) = xml.find("<mxGraphModel") else {
        return Background::White;
    };
    let rest = &xml[start..];
    let tag = &rest[..rest.find('>').unwrap_or(rest.len())];
    let Some(at) = tag.find(" background=\"") else {
        return Background::White;
    };
    let value = &tag[at + " background=\"".len()..];
    let value = value.split('"').next().unwrap_or("").trim();
    if value.eq_ignore_ascii_case("none") {
        Background::Transparent
    } else {
        hex(value).map_or(Background::White, Background::Color)
    }
}
