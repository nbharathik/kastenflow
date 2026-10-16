//! A cell's style: draw.io's `key=value;key=value;` text as an ordered list.
//! Order and unknown keys are kept; a bare word (`ellipse`, `swimlane`,
//! `text`) is an item without a value.

/// An ordered style.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Style {
    items: Vec<(String, Option<String>)>,
}

impl Style {
    pub fn parse(text: &str) -> Style {
        let items = text
            .split(';')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(|t| match t.split_once('=') {
                Some((k, v)) => (k.trim().to_owned(), Some(v.to_owned())),
                None => (t.to_owned(), None),
            })
            .collect();
        Style { items }
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The value of `key` (a bare word of the same name, as `image;image=…`
    /// has, is not a value).
    pub fn get(&self, key: &str) -> Option<&str> {
        self.items
            .iter()
            .find(|(k, v)| k == key && v.is_some())
            .and_then(|(_, v)| v.as_deref())
    }

    /// Whether the key is there, with a value or as a bare word.
    pub fn has(&self, key: &str) -> bool {
        self.items.iter().any(|(k, _)| k == key)
    }

    /// The first word when it has no value: the shape name in `ellipse;…`.
    pub fn bare(&self) -> Option<&str> {
        match self.items.first() {
            Some((k, None)) => Some(k),
            _ => None,
        }
    }

    /// Whether the style says `key=1`.
    pub fn flag(&self, key: &str) -> bool {
        self.get(key) == Some("1")
    }

    /// Sets `key` where it is, or at the end.
    pub fn set(&mut self, key: &str, value: &str) {
        match self.items.iter_mut().find(|(k, v)| k == key && v.is_some()) {
            Some(item) => item.1 = Some(value.to_owned()),
            None => self.items.push((key.to_owned(), Some(value.to_owned()))),
        }
    }

    /// Sets `key` only when the style has no word for it.
    pub fn set_default(&mut self, key: &str, value: &str) {
        if !self.has(key) {
            self.set(key, value);
        }
    }

    pub fn remove(&mut self, key: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|(k, _)| k != key);
        self.items.len() != before
    }

    /// `other`'s items over this style: its keys replace or are added.
    pub fn overlay(&mut self, other: &Style) {
        for (k, v) in &other.items {
            match v {
                Some(v) => self.set(k, v),
                None => {
                    if !self.has(k) {
                        self.items.push((k.clone(), None));
                    }
                }
            }
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.items.iter().map(|(k, v)| (k.as_str(), v.as_deref()))
    }

    /// The numeric value of `key`.
    pub fn number(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(|v| v.trim().parse().ok())
    }
}

impl std::fmt::Display for Style {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (k, v) in &self.items {
            match v {
                Some(v) => write!(f, "{k}={v};")?,
                None => write!(f, "{k};")?,
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_style_keeps_its_order_and_its_bare_words() {
        let mut s = Style::parse("swimlane;whiteSpace=wrap;html=1;startSize=30;");
        assert_eq!(s.bare(), Some("swimlane"));
        assert_eq!(s.get("startSize"), Some("30"));
        assert!(s.flag("html"));
        s.set("whiteSpace", "nowrap");
        s.set("fillColor", "#fff");
        s.remove("html");
        assert_eq!(
            s.to_string(),
            "swimlane;whiteSpace=nowrap;startSize=30;fillColor=#fff;"
        );
    }

    #[test]
    fn an_overlay_replaces_and_adds_without_touching_the_rest() {
        let mut s = Style::parse("rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;");
        s.overlay(&Style::parse("fillColor=#d5e8d4;dashed=1;"));
        assert_eq!(
            s.to_string(),
            "rounded=1;fillColor=#d5e8d4;strokeColor=#6c8ebf;dashed=1;"
        );
        assert_eq!(Style::parse("").to_string(), "");
    }
}
