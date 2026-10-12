use super::*;

const BODY: &str = "# Plan\n\nSee [[Photo organiser roadmap]] and ![[Sketch|the sketch]].\n\n```\n[[Not a link]]\n- [ ] not a task\n```\n\n- [ ] Draft intro [[2026-10-01]]\n  - [x] Outline `[[code]]`\n1. [ ] Book room @2026-10-03\n> [!tip] **Bold** tip with a [site](https://x.y)\n";

#[test]
fn finds_links_outside_code() {
    let e = extract(BODY);
    let targets: Vec<(&str, bool)> = e
        .links
        .iter()
        .map(|l| (l.target.as_str(), l.embed))
        .collect();
    assert_eq!(
        targets,
        [
            ("Photo organiser roadmap", false),
            ("Sketch", true),
            ("2026-10-01", false)
        ]
    );
    assert_eq!(e.links[0].line, 2);
    assert_eq!(
        e.links[0].context,
        "See Photo organiser roadmap and the sketch."
    );
}

#[test]
fn finds_headings_and_tasks_with_dates() {
    let e = extract(BODY);
    assert_eq!(
        e.headings,
        [Heading {
            level: 1,
            text: "Plan".into(),
            line: 0
        }]
    );
    let tasks: Vec<(bool, &str, Option<&str>)> = e
        .tasks
        .iter()
        .map(|t| (t.done, t.text.as_str(), t.due.as_deref()))
        .collect();
    assert_eq!(
        tasks,
        [
            (false, "Draft intro 2026-10-01", Some("2026-10-01")),
            (true, "Outline", None),
            (false, "Book room @2026-10-03", Some("2026-10-03")),
        ]
    );
    // A numbered heading keeps its number; marks inside it go.
    let numbered = extract("## 4. **Evaluation**\n### - dash\n");
    let texts: Vec<&str> = numbered.headings.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(texts, ["4. Evaluation", "- dash"]);
}

#[test]
fn writes_a_readable_excerpt_and_counts_words() {
    let e = extract(BODY);
    assert!(
        e.excerpt
            .starts_with("Plan See Photo organiser roadmap and the sketch. Draft intro"),
        "{}",
        e.excerpt
    );
    assert!(e.excerpt.contains("Bold tip with a site"), "{}", e.excerpt);
    assert!(e.words > 20);
    let long = "word ".repeat(200);
    let cut = extract(&long).excerpt;
    assert!(cut.ends_with('…') && cut.chars().count() <= 221, "{cut}");
}

#[test]
fn leaves_tables_and_equations_out_of_excerpts() {
    let body = "Intro line.\n\n| Phase | Goal |\n| --- | --- |\n| 1 | Parse |\n\n$$\nE = mc^2\n$$\n\n$$ x^2 $$\n\nSome _italic_ and *more* text, snake_case kept and 2*3 too.\n";
    assert_eq!(
        extract(body).excerpt,
        "Intro line. Some italic and more text, snake_case kept and 2*3 too."
    );
}

#[test]
fn reads_markdown_lines_as_text() {
    assert_eq!(readable("## Morning"), "Morning");
    assert_eq!(
        readable("- [x] Read the [[Photo organiser roadmap]]"),
        "Read the Photo organiser roadmap"
    );
    assert_eq!(readable("> [!note] Title"), "Title");
    // A line may start with any character, one byte long or four.
    assert_eq!(
        readable("> 💡 Everything important"),
        "💡 Everything important"
    );
    assert_eq!(readable("é. not a list"), "é. not a list");
    assert_eq!(
        readable("Text <span style=\"color: red\">red</span> and <u>u</u>"),
        "Text red and u"
    );
    assert_eq!(
        readable("12. item with `code` and \\[[escaped]]"),
        "item with code and [[escaped]]"
    );
    // Code spans keep their text as written.
    assert_eq!(
        readable("- [ ] Type `[[` and link to [[Note-taking study]]"),
        "Type [[ and link to Note-taking study"
    );
    assert_eq!(readable("a ``x ` **y**`` b"), "a x ` **y** b");
    assert_eq!(readable("an ` unclosed tick"), "an unclosed tick");
    // Only ASCII punctuation can be escaped, as in CommonMark: TeX and
    // Windows paths keep their backslashes.
    assert_eq!(
        readable(r"Area $\pi r^2$ in C:\Users, not \$5 or \*this\*"),
        r"Area \pi r^2 in C:\Users, not $5 or *this*"
    );
    assert_eq!(
        due_date("call 📅 2026-12-24 now"),
        Some("2026-12-24".into())
    );
    assert_eq!(due_date("no date 2026-12-24"), None);
}

#[test]
fn reads_inline_math_as_its_tex() {
    // Dollars mark math the way the editor reads them (Pandoc's rule), so
    // an excerpt shows the TeX without them, as links lose their brackets.
    assert_eq!(
        readable("Where $D$ is the set of duplicate pairs."),
        "Where D is the set of duplicate pairs."
    );
    assert_eq!(readable("- [ ] Prove $x > 0$ first"), "Prove x > 0 first");
    assert_eq!(readable("a $$x^2$$ b"), "a x^2 b");
    assert_eq!(readable("costs $5$"), "costs 5");
    // Prices and lone dollars stay as written.
    assert_eq!(readable("Pay $5 and $10 today"), "Pay $5 and $10 today");
    assert_eq!(readable("from $5 to $ 6"), "from $5 to $ 6");
    assert_eq!(readable("an $ unclosed one"), "an $ unclosed one");
    assert_eq!(readable("empty $$ here"), "empty $$ here");
    // TeX stands as written, like a code span.
    assert_eq!(readable(r"$\frac{*a*}{[[b]]}$"), r"\frac{*a*}{[[b]]}");
}

#[test]
fn keeps_the_time_after_a_day_link_or_an_at_date() {
    let body = "Call [[2026-10-07]] 09:00 now\nSee [[Some page]] 10:00 and [[2026-10-08]] later\n- [ ] Book @2026-10-08 9:05\n- [x] Plan [[2026-10-09|friday]] 17:30\n- [ ] Odd [[2026-02-30]] 10:00 and @2026-13-45\n- [ ] Code `[[2026-10-10]] 08:00` only\n";
    let e = extract(body);
    let links: Vec<(&str, Option<&str>)> = e
        .links
        .iter()
        .map(|l| (l.target.as_str(), l.at.as_deref()))
        .collect();
    assert_eq!(
        links,
        [
            ("2026-10-07", Some("09:00")),
            ("Some page", None),
            ("2026-10-08", None),
            ("2026-10-09", Some("17:30")),
            ("2026-02-30", None),
        ]
    );
    let tasks: Vec<(Option<&str>, Option<&str>)> = e
        .tasks
        .iter()
        .map(|t| (t.due.as_deref(), t.at.as_deref()))
        .collect();
    assert_eq!(
        tasks,
        [
            (Some("2026-10-08"), Some("09:05")),
            (Some("2026-10-09"), Some("17:30")),
            (None, None),
            (None, None),
        ]
    );
}

#[test]
fn a_fence_closes_on_a_plain_line_as_long_as_it_or_longer() {
    // Spaces after the closing run still close it; a shorter run or one
    // with words after it does not.
    let body =
        "````\n[[In code]]\n```\n[[Still code]]\n```` js\n[[Code too]]\n`````   \n[[After]]\n";
    let targets: Vec<String> = extract(body).links.into_iter().map(|l| l.target).collect();
    assert_eq!(targets, ["After"]);
    let spans: Vec<&str> = crate::links::scan::link_spans(body)
        .into_iter()
        .map(|r| &body[r])
        .collect();
    assert_eq!(spans, ["After"]);
}
