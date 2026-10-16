//! The scripts Kasten runs in a browser tab to read what is selected (or the
//! page), one per way the answer can come back (see `capture.rs`). Each
//! holds the request's nonce and nothing else that varies, and refuses a
//! nonce that is not plain base64url, so no text of a page or of the person's
//! ever becomes code.

use super::capture::{CHUNK, Kind};

/// The most characters of HTML or text the page-side collector keeps.
const LIMIT: usize = 900_000;
/// The most a slower way carries, in characters of the encoded answer.
const SLOW_LIMIT: usize = 340_000;

// The tags reader keeps at most 120 tags (a name of 100 characters and a value
// of 1000) and 3 scripts of 30000, which stays under what a slower way carries.
const _: () = assert!(120 * (100 + 1000) + 3 * 30_000 < SLOW_LIMIT * 3 / 4);

/// Reads the selection (HTML and text) or the page's article, the title, and
/// says who it answers for. `@NONCE@`, `@KIND@`, `@LIMIT@` are filled in.
const COLLECT: &str = r#"
function readMeta() {
  var meta = [];
  var tags = document.querySelectorAll("meta[name], meta[property]");
  for (var i = 0; i < tags.length && meta.length < 120; i++) {
    var name = String(tags[i].getAttribute("name") || tags[i].getAttribute("property") || "").toLowerCase().slice(0, 100);
    var content = String(tags[i].getAttribute("content") || "").slice(0, 1000);
    if (name && content) meta.push([name, content]);
  }
  var ld = [];
  var scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (var j = 0; j < scripts.length && ld.length < 3; j++) {
    var text = String(scripts[j].textContent || "");
    if (text.length > 0 && text.length <= 30000) ld.push(text);
  }
  return { meta: meta, ld: ld };
}
function collect() {
  var out = { n: "@NONCE@", title: "", html: "", text: "" };
  try {
    out.title = String(document.title || "").slice(0, 1000);
    if ("@KIND@" === "meta") {
      out.html = JSON.stringify(readMeta());
    } else if ("@KIND@" === "page") {
      var el = document.querySelector("article") || document.querySelector("main") || document.body || document.documentElement;
      out.html = String(el.outerHTML || "").slice(0, @LIMIT@);
      out.text = "";
    } else {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        var box = document.createElement("div");
        for (var i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
        out.html = String(box.innerHTML || "").slice(0, @LIMIT@);
        out.text = String(sel.toString() || "").slice(0, @LIMIT@);
      }
    }
  } catch (e) {
    out = { n: "@NONCE@", error: String((e && e.message) || e) };
  }
  return out;
}
function encode(data, limit) {
  var json = JSON.stringify(data);
  var b64 = btoa(unescape(encodeURIComponent(json))).split("+").join("-").split("/").join("_").split("=").join("");
  if (b64.length > limit) return null;
  return b64;
}
"#;

fn plain(nonce: &str) -> bool {
    (16..=64).contains(&nonce.len())
        && nonce
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn collector(nonce: &str, kind: Kind) -> String {
    COLLECT
        .replace("@NONCE@", nonce)
        .replace(
            "@KIND@",
            match kind {
                Kind::Selection => "selection",
                Kind::Page => "page",
                Kind::Meta => "meta",
            },
        )
        .replace("@LIMIT@", &LIMIT.to_string())
}

/// For `eval_with_callback`: the script's value is the answer.
pub fn result(nonce: &str, kind: Kind) -> Option<String> {
    plain(nonce).then(|| {
        format!(
            "(function(){{{}\nreturn collect();}})()",
            collector(nonce, kind)
        )
    })
}

/// The title way: the answer in base64url chunks, one at a time, as the
/// page's title; Kasten asks for the next with `next` and ends it with `end`.
pub fn titled(nonce: &str, kind: Kind) -> Option<String> {
    plain(nonce).then(|| {
        format!(
            r#"(function(){{{collect}
var original = document.title;
try {{
  var b64 = encode(collect(), {limit});
  if (b64 === null) b64 = encode({{ n: "{nonce}", error: "That is too big for this way of reading the page" }}, {limit});
  var parts = [];
  for (var i = 0; i < b64.length; i += {chunk}) parts.push(b64.slice(i, i + {chunk}));
  if (parts.length === 0) parts.push("");
  var at = 0;
  var send = function () {{ document.title = "kasten-capture:{nonce}:" + at + ":" + parts.length + ":" + parts[at]; }};
  window.__kasten_next = function (n) {{
    if (n !== "{nonce}") return;
    at++;
    if (at < parts.length) send(); else {{ document.title = original; delete window.__kasten_next; }}
  }};
  window.__kasten_end = function (n) {{
    if (n !== "{nonce}") return;
    document.title = original; delete window.__kasten_next; delete window.__kasten_end;
  }};
  send();
}} catch (e) {{ document.title = original; }}
}})()"#,
            collect = collector(nonce, kind),
            limit = SLOW_LIMIT,
            chunk = CHUNK,
        )
    })
}

/// Asks the page for the next chunk of its title answer.
pub fn next(nonce: &str) -> Option<String> {
    plain(nonce).then(|| format!("window.__kasten_next && window.__kasten_next(\"{nonce}\");"))
}

/// Tells the page the title answer is over, so it puts its title back.
pub fn end(nonce: &str) -> Option<String> {
    plain(nonce).then(|| format!("window.__kasten_end && window.__kasten_end(\"{nonce}\");"))
}

/// The navigation way: a hidden frame, then the page itself, go to an address
/// that never resolves and that Kasten always cancels.
pub fn sentinel(nonce: &str, kind: Kind, host: &str) -> Option<String> {
    plain(nonce).then(|| {
        format!(
            r#"(function(){{{collect}
var b64 = encode(collect(), {limit});
if (b64 === null) b64 = encode({{ n: "{nonce}", error: "That is too big for this way of reading the page" }}, {limit});
var url = "https://{host}/?n={nonce}&d=" + b64;
try {{
  var f = document.createElement("iframe");
  f.style.display = "none";
  f.src = url;
  (document.body || document.documentElement).appendChild(f);
}} catch (e) {{}}
setTimeout(function () {{ if (!window.__kasten_seen) {{ try {{ location.assign(url); }} catch (e) {{}} }} }}, 500);
}})()"#,
            collect = collector(nonce, kind),
            limit = SLOW_LIMIT,
        )
    })
}

/// Tells the page's sentinel script the frame was seen, so it does not navigate too.
pub fn seen() -> &'static str {
    "window.__kasten_seen = 1;"
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "abcDEF0123456789_-abcDEF0123456789_-abcdefg";

    #[test]
    fn every_script_names_the_nonce_and_leaves_no_blank_to_fill() {
        let scripts = [
            result(NONCE, Kind::Selection).unwrap(),
            result(NONCE, Kind::Page).unwrap(),
            titled(NONCE, Kind::Selection).unwrap(),
            sentinel(NONCE, Kind::Page, "kasten-capture.invalid").unwrap(),
            next(NONCE).unwrap(),
            end(NONCE).unwrap(),
            result(NONCE, Kind::Meta).unwrap(),
            titled(NONCE, Kind::Meta).unwrap(),
        ];
        for script in &scripts {
            assert!(script.contains(NONCE));
            assert!(!script.contains('@'), "{script}");
        }
        assert!(scripts[1].contains("\"page\" === \"page\""));
        assert!(scripts[0].contains("\"selection\" === \"page\""));
        assert!(scripts[3].contains("https://kasten-capture.invalid/?n="));
        // The tags are read by the same collector, asked for by kind.
        assert!(scripts[6].contains("\"meta\" === \"meta\""));
        assert!(scripts[0].contains("\"selection\" === \"meta\""));
    }

    #[test]
    fn the_tags_reader_takes_only_data_and_keeps_its_answer_small() {
        let script = result(NONCE, Kind::Meta).unwrap();
        // It reads attributes and text, never runs or follows anything the page holds.
        assert!(script.contains("function readMeta()"));
        for forbidden in ["eval(", "Function(", "location", "fetch(", "XMLHttpRequest"] {
            assert!(!script.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn a_nonce_that_is_not_plain_never_becomes_code() {
        for bad in [
            "",
            "short",
            "\"; alert(1); \"                  ",
            "abcdefghijklmnop\"+alert(1)+\"xx",
            "abcdefghijklmnop\nabcdef",
            "abcdefghijklmnop</script>",
            &"a".repeat(65),
        ] {
            assert!(result(bad, Kind::Selection).is_none(), "{bad}");
            assert!(titled(bad, Kind::Selection).is_none(), "{bad}");
            assert!(
                sentinel(bad, Kind::Selection, "x.invalid").is_none(),
                "{bad}"
            );
            assert!(next(bad).is_none(), "{bad}");
            assert!(end(bad).is_none(), "{bad}");
        }
    }
}
