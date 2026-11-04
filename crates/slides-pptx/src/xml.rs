//! A small streaming XML writer. Code that uses it reads in the order the XML
//! comes out, which matters: PowerPoint rejects children that are out of
//! their schema's order, so the order of the calls is the order of the file.

use std::borrow::Cow;

use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};

/// DrawingML.
pub const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
/// Relationship ids inside a part.
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/// PresentationML.
pub const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

/// Builds one XML document or fragment.
pub struct Xml {
    out: Writer<Vec<u8>>,
    /// A start tag whose attributes may still be added; it is written when the
    /// next thing arrives, as an empty tag if that thing is its end.
    pending: Option<BytesStart<'static>>,
    open: Vec<String>,
}

impl Xml {
    /// A whole part: the XML declaration first.
    pub fn document() -> Xml {
        let mut xml = Xml::fragment();
        xml.emit(Event::Decl(BytesDecl::new(
            "1.0",
            Some("UTF-8"),
            Some("yes"),
        )));
        xml.emit(Event::Text(BytesText::from_escaped("\n")));
        xml
    }

    /// Markup to go inside a part, or to be compared in a test.
    pub fn fragment() -> Xml {
        Xml {
            out: Writer::new(Vec::new()),
            pending: None,
            open: Vec::new(),
        }
    }

    fn emit(&mut self, event: Event<'_>) {
        // Writing to a Vec cannot fail.
        let _ = self.out.write_event(event);
    }

    fn flush(&mut self) {
        if let Some(start) = self.pending.take() {
            self.emit(Event::Start(start));
        }
    }

    /// Begins an element; add its attributes next, then children or `close`.
    pub fn open(&mut self, name: &str) -> &mut Xml {
        self.flush();
        self.pending = Some(BytesStart::new(name.to_owned()));
        self.open.push(name.to_owned());
        self
    }

    /// An attribute of the element just opened.
    pub fn attr(&mut self, name: &str, value: &str) -> &mut Xml {
        match self.pending.as_mut() {
            Some(start) => start.push_attribute((name, clean(value).as_ref())),
            None => debug_assert!(false, "attribute {name} has no element to belong to"),
        }
        self
    }

    /// A whole-number attribute.
    pub fn int(&mut self, name: &str, value: i64) -> &mut Xml {
        self.attr(name, &value.to_string())
    }

    /// An attribute that is written as `1` when set and left out when not.
    pub fn flag(&mut self, name: &str, on: bool) -> &mut Xml {
        if on {
            self.attr(name, "1");
        }
        self
    }

    /// Text inside the current element.
    pub fn text(&mut self, text: &str) -> &mut Xml {
        self.flush();
        self.emit(Event::Text(BytesText::new(clean(text).as_ref())));
        self
    }

    /// Markup that is already XML, such as an object kept from an imported file, written as it is.
    pub fn verbatim(&mut self, markup: &str) -> &mut Xml {
        self.flush();
        self.emit(Event::Text(BytesText::from_escaped(markup)));
        self
    }

    /// Ends the current element. One with no children becomes `<name/>`.
    pub fn close(&mut self) -> &mut Xml {
        let Some(name) = self.open.pop() else {
            debug_assert!(false, "close with nothing open");
            return self;
        };
        match self.pending.take() {
            Some(start) => self.emit(Event::Empty(start)),
            None => self.emit(Event::End(BytesEnd::new(name))),
        }
        self
    }

    /// `<name/>` with the attributes given.
    pub fn leaf(&mut self, name: &str, attrs: &[(&str, &str)]) -> &mut Xml {
        self.open(name);
        for (key, value) in attrs {
            self.attr(key, value);
        }
        self.close()
    }

    /// `<name>text</name>`.
    pub fn text_element(&mut self, name: &str, text: &str) -> &mut Xml {
        self.open(name).text(text).close()
    }

    /// The finished markup.
    pub fn finish(self) -> Vec<u8> {
        debug_assert!(self.open.is_empty(), "unclosed elements: {:?}", self.open);
        let mut xml = self;
        xml.flush();
        xml.out.into_inner()
    }

    /// The finished markup as text, for a fragment written inside another element's markup.
    pub fn into_string(self) -> String {
        String::from_utf8(self.finish()).unwrap_or_default()
    }
}

/// Whether XML 1.0 allows the character. PowerPoint treats a file with any
/// other as corrupt, so text from a deck is cleaned rather than trusted.
fn allowed(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r')
        || (c >= ' '
            && c != '\u{FFFE}'
            && c != '\u{FFFF}'
            && !('\u{FDD0}'..='\u{FDEF}').contains(&c))
}

/// The text without the characters XML cannot hold.
pub fn clean(text: &str) -> Cow<'_, str> {
    if text.chars().all(allowed) {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(text.chars().filter(|c| allowed(*c)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_element_without_children_is_written_empty() {
        let mut x = Xml::fragment();
        x.open("a:off").int("x", 5).int("y", -7).close();
        assert_eq!(x.into_string(), r#"<a:off x="5" y="-7"/>"#);
    }

    #[test]
    fn children_nest_in_the_order_they_are_written() {
        let mut x = Xml::fragment();
        x.open("a:xfrm").flag("flipH", true).flag("flipV", false);
        x.leaf("a:off", &[("x", "1"), ("y", "2")]);
        x.leaf("a:ext", &[("cx", "3"), ("cy", "4")]);
        x.close();
        assert_eq!(
            x.into_string(),
            r#"<a:xfrm flipH="1"><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>"#
        );
    }

    #[test]
    fn text_and_attributes_are_escaped() {
        let mut x = Xml::fragment();
        x.open("a:t")
            .attr("note", "\"a\" & <b>")
            .text("1 < 2 & 3 > 2");
        x.close();
        assert_eq!(
            x.into_string(),
            "<a:t note=\"&quot;a&quot; &amp; &lt;b&gt;\">1 &lt; 2 &amp; 3 &gt; 2</a:t>"
        );
    }

    #[test]
    fn characters_xml_cannot_hold_are_dropped() {
        let mut x = Xml::fragment();
        x.text_element("a:t", "a\u{1}b\u{0}c\u{FFFE}d\te\nf");
        assert_eq!(x.into_string(), "<a:t>abcd\te\nf</a:t>");
    }

    #[test]
    fn a_document_starts_with_the_declaration() {
        let mut x = Xml::document();
        x.open("p:sld").close();
        assert_eq!(
            x.into_string(),
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<p:sld/>"
        );
    }

    #[test]
    fn unicode_is_written_as_it_is() {
        let mut x = Xml::fragment();
        x.text_element("a:t", "Grüße – ‹#› 日本語");
        assert_eq!(x.into_string(), "<a:t>Grüße – ‹#› 日本語</a:t>");
    }
}
