use super::*;

const PAGE: &str = r##"<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>How to Take Smart Notes &mdash; A Review | Example Blog</title>
<meta property="og:title" content="How to Take Smart Notes: A Review">
<style>body { color: red }</style>
<script>alert("no")</script>
</head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<header><h1>Example Blog</h1></header>
<main>
<article>
  <h1>How to Take Smart Notes</h1>
  <p>By <a href="/people/ada">Ada</a> &middot; <time>2026-09-20</time></p>
  <p>The   slip-box is <strong>simple</strong>:
     one idea per note, in <em>your own</em> words.<br>Then link it.</p>
  <h2>Three kinds of notes</h2>
  <ol>
    <li>Fleeting notes</li>
    <li>Literature notes, with <a href="https://example.org/lit?x=1&amp;y=2">sources</a>
      <ul><li>short</li><li>in your words</li></ul>
    </li>
    <li>Permanent notes</li>
  </ol>
  <blockquote><p>Writing is thinking.</p></blockquote>
  <figure><img src="images/slipbox.png" alt="A slip-box"><figcaption>Luhmann's box</figcaption></figure>
  <pre><code>note --link   other
  indented</code></pre>
  <p>Inline <code>code</code> &amp; an <a href="#top">anchor</a>.</p>
  <table><tr><th>Kind</th><th>Lives</th></tr><tr><td>Fleeting</td><td>days</td></tr></table>
  <hr>
  <p>Unclosed paragraph
  <p>Next one &lt;3 &#233;t&eacute; &#x2014; done</p>
  <div class="share"><button>Share</button><form><input name="q"></form></div>
</article>
</main>
<footer>Copyright</footer>
</body></html>"##;

#[test]
fn keeps_an_articles_text_as_markdown() {
    let clipped = clip("https://example.com/blog/smart-notes.html", PAGE);
    assert_eq!(clipped.title, "How to Take Smart Notes: A Review");
    assert_eq!(
        clipped.markdown,
        concat!(
            "# How to Take Smart Notes\n\n",
            "By [Ada](https://example.com/people/ada) · 2026-09-20\n\n",
            "The slip-box is **simple**: one idea per note, in *your own* words.  \nThen link it.\n\n",
            "## Three kinds of notes\n\n",
            "1. Fleeting notes\n",
            "2. Literature notes, with [sources](https://example.org/lit?x=1&y=2)\n",
            "   - short\n",
            "   - in your words\n",
            "3. Permanent notes\n\n",
            "> Writing is thinking.\n\n",
            "![A slip-box](https://example.com/blog/images/slipbox.png)\n\n",
            "*Luhmann's box*\n\n",
            "```\nnote --link   other\n  indented\n```\n\n",
            "Inline `code` & an anchor.\n\n",
            "| Kind | Lives |\n| --- | --- |\n| Fleeting | days |\n\n",
            "---\n\n",
            "Unclosed paragraph\n\n",
            "Next one <3 été — done\n",
        )
    );
}

#[test]
fn takes_the_main_part_or_else_the_body() {
    let page = "<html><head><title>Plain</title></head><body><nav>Menu</nav><div><p>Only text.</p></div><script>x()</script></body></html>";
    let clipped = clip("https://example.com/", page);
    assert_eq!(clipped.title, "Plain");
    assert_eq!(clipped.markdown, "Only text.\n");
    let main = "<body><p>Outside</p><div role=\"main\"><p>Inside</p></div></body>";
    assert_eq!(clip("https://example.com/", main).markdown, "Inside\n");
    // No title at all: the first heading, else the address.
    assert_eq!(
        clip("https://example.com/x", "<h2>Heading</h2><p>t</p>").title,
        "Heading"
    );
    assert_eq!(
        clip("https://example.com/notes/x", "<p>t</p>").title,
        "example.com/notes/x"
    );
}

#[test]
fn reads_only_a_pages_title() {
    let url = "https://example.com/blog/smart-notes.html";
    assert_eq!(title_of(url, PAGE), "How to Take Smart Notes: A Review");
    // A page cut off after its head, as a limited fetch leaves it, still has one.
    let head = &PAGE[..PAGE.find("<body>").unwrap()];
    assert_eq!(title_of(url, head), "How to Take Smart Notes: A Review");
    // Line breaks and runs of spaces in a title are one space.
    assert_eq!(
        title_of(url, "<title>\n  Two\n   lines </title>"),
        "Two lines"
    );
    // Without one, the address without its scheme.
    assert_eq!(
        title_of("https://example.com/notes/x/", "<p>t</p>"),
        "example.com/notes/x"
    );
}

#[test]
fn resolves_links_against_the_page() {
    let base = "https://example.com/a/b/page.html?q=1#frag";
    assert_eq!(resolve(base, "c.png"), "https://example.com/a/b/c.png");
    assert_eq!(resolve(base, "../c.png"), "https://example.com/a/c.png");
    assert_eq!(resolve(base, "/root.png"), "https://example.com/root.png");
    assert_eq!(
        resolve(base, "//cdn.example.net/x.png"),
        "https://cdn.example.net/x.png"
    );
    assert_eq!(resolve(base, "https://other.org/"), "https://other.org/");
    assert_eq!(
        resolve(base, "mailto:ada@example.com"),
        "mailto:ada@example.com"
    );
    assert_eq!(
        resolve(base, "?page=2"),
        "https://example.com/a/b/page.html?page=2"
    );
}

#[test]
fn a_page_cannot_write_markdown_that_does_more_than_it_shows() {
    let page = r#"<article>
<p><a href="https://ok.example/">x](javascript:alert(1)) [y</a></p>
<p><a href="JavaScript:alert(2)">click</a> and <a href=" data:text/html,x">data</a></p>
<p><a href="https://example.com/a (b)">spaced</a></p>
<p><img src="javascript:alert(3)" alt="gone"><img src="/i.png" alt="a]b"></p>
<p>[click](javascript:alert(4)) &lt;img src=x onerror=alert(5)&gt; &lt;3 C:\temp</p>
<p><code>a`[x](javascript:alert(6))</code></p>
<pre><code class="language-js```">```
[y](javascript:alert(7))</code></pre>
</article>"#;
    let md = clip("https://example.com/post", page).markdown;
    // Outside code, every link leads to the web: any other `](` is escaped.
    for part in md.split("\n\n").filter(|p| !p.starts_with('`')) {
        for (at, _) in part.match_indices("](") {
            let to = part[at + 2..].to_lowercase();
            assert!(
                part[..at].ends_with('\\') || to.starts_with("https://"),
                "{part}"
            );
        }
    }
    assert!(
        md.contains(r"[x\](javascript:alert(1)) \[y](https://ok.example/)"),
        "{md}"
    );
    assert!(md.contains("click and data"), "{md}");
    assert!(
        md.contains("[spaced](https://example.com/a%20%28b%29)"),
        "{md}"
    );
    assert!(!md.contains("gone"), "{md}");
    assert!(md.contains(r"![a\]b](https://example.com/i.png)"), "{md}");
    assert!(md.contains(r"\[click\](javascript:alert(4))"), "{md}");
    assert!(md.contains(r"\<img src=x onerror=alert(5)>"), "{md}");
    assert!(md.contains(r"<3 C:\\temp"), "{md}");
    assert!(md.contains("``a`[x](javascript:alert(6))``"), "{md}");
    assert!(
        md.contains("````js\n```\n[y](javascript:alert(7))\n````"),
        "{md}"
    );
}
