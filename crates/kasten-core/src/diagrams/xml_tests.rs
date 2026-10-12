use super::xml::{escape, scan, unescape};

const MXFILE: &str = r#"<mxfile host="Kasten"><diagram name="A"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram><diagram name="B"/></mxfile>"#;

#[test]
fn reads_the_root_and_counts_the_elements_asked_for() {
    let scan = scan(MXFILE, "diagram").unwrap();
    assert_eq!(scan.root, "mxfile");
    assert_eq!(scan.count, 2);
    assert!(!scan.script);
    assert_eq!(scan.root_attrs, [("host".to_owned(), "Kasten".to_owned())]);
}

#[test]
fn accepts_what_a_drawing_tool_writes() {
    for text in [
        // A declaration, comments around the root, single quotes, CDATA,
        // character and predefined references, a byte order mark.
        "\u{feff}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- made by hand -->\n<a b='1' c=\"x &amp; y &lt; &#x41; &#66;\"><![CDATA[ <not> a tag ]]> text &quot;q&quot; &apos;</a>\n<!-- kasten:source:abc -->\n",
        "<a/>",
        "<a>\n  <b:c xmlns:b=\"urn:b\" b:d=\"1\"/>\n</a>",
        "<a>é ü 日本 &#x1F600;</a>",
    ] {
        assert!(scan(text, "a").is_ok(), "{text}: {:?}", scan(text, "a"));
    }
}

#[test]
fn refuses_what_is_not_well_formed() {
    for (text, why) in [
        ("", "no root"),
        ("   \n", "no root"),
        ("just words", "outside"),
        ("<a>", "never closed"),
        ("<a></b>", "closing </b>"),
        ("<a><b></a></b>", "closing </a>"),
        ("</a>", "closing"),
        ("<a/><b/>", "more than one"),
        ("<a/>words", "outside"),
        ("<a b=1/>", "quote"),
        ("<a b=\"1/>", "attribute"),
        ("<a b=\"1\" b=\"2\"/>", "twice"),
        ("<a b=\"<\"/>", "<"),
        ("<a>&nope;</a>", "reference"),
        ("<a>&amp</a>", "reference"),
        ("<a>&#0;</a>", "reference"),
        ("<a>&#xD800;</a>", "reference"),
        ("<a>a < b</a>", "name"),
        ("<a><!-- open </a>", "comment"),
        ("<a><![CDATA[ open </a>", "CDATA"),
        ("<a><?pi </a>", "instruction"),
        ("<1a/>", "name"),
        ("<a b/>", "="),
        ("<a \u{0}/>", "control"),
        ("<a>\u{1}</a>", "control"),
    ] {
        let err = scan(text, "a").unwrap_err();
        assert!(err.contains(why), "{text:?}: {err}");
    }
}

#[test]
fn refuses_declarations_that_could_expand() {
    for text in [
        "<!DOCTYPE a [<!ENTITY x \"y\">]><a>&x;</a>",
        "<!DOCTYPE a><a/>",
        "<a><!ENTITY x \"y\"></a>",
    ] {
        let err = scan(text, "a").unwrap_err();
        assert!(err.contains("declaration"), "{text}: {err}");
    }
}

#[test]
fn tells_the_line_of_a_problem() {
    let err = scan("<a>\n  <b>\n  </c>\n</a>", "a").unwrap_err();
    assert!(err.starts_with("Line 3"), "{err}");
}

#[test]
fn finds_a_script_element_in_any_case() {
    assert!(
        scan("<svg><g><script>x()</script></g></svg>", "x")
            .unwrap()
            .script
    );
    assert!(scan("<svg><SCRIPT/></svg>", "x").unwrap().script);
    assert!(!scan("<svg><scripture/></svg>", "x").unwrap().script);
}

#[test]
fn nesting_is_limited_and_never_recurses() {
    let deep = "<a>".repeat(2000) + &"</a>".repeat(2000);
    assert!(scan(&deep, "a").unwrap_err().contains("deeply"));
    let fine = "<a>".repeat(200) + &"</a>".repeat(200);
    assert_eq!(scan(&fine, "a").unwrap().count, 200);
}

#[test]
fn unescapes_what_an_attribute_holds() {
    assert_eq!(
        unescape("&lt;a b=&quot;1&quot;&gt;&#xa;&amp;&#10;&apos;&lt;/a&gt;").as_deref(),
        Some("<a b=\"1\">\n&\n'</a>")
    );
    assert_eq!(unescape("plain").as_deref(), Some("plain"));
    assert_eq!(unescape("&nope;"), None);
    assert_eq!(unescape("&amp"), None);
}

#[test]
fn escapes_text_for_an_attribute() {
    assert_eq!(
        escape("<a b=\"1\">&\n'</a>"),
        "&lt;a b=&quot;1&quot;&gt;&amp;&#xa;&apos;&lt;/a&gt;"
    );
    assert_eq!(
        unescape(&escape("x < y & \"z\"\n")).as_deref(),
        Some("x < y & \"z\"\n")
    );
}
