//! One realistic element of each kind, and variants, as a deck file would hold them.

use serde_json::{Value, json};

use crate::model::Element;

/// The box the samples are set in: the content area of a plain layout with a title.
pub const BOX: (f64, f64, f64, f64) = (64.0, 148.0, 832.0, 344.0);

fn element(mut value: Value) -> Element {
    let map = value.as_object_mut().expect("an object");
    for (key, v) in [("x", BOX.0), ("y", BOX.1), ("w", BOX.2), ("h", BOX.3)] {
        map.entry(key).or_insert(json!(v));
    }
    serde_json::from_value(value).expect("a valid element")
}

/// Every kind at least once, with the fields that change how it looks.
pub fn all() -> Vec<Element> {
    vec![
        element(
            json!({ "type": "code", "id": "code-1", "language": "python",
            "code": "def greet(name):\n    # say hello\n    return f'Hello {name}'\n\nprint(greet('Kasten'))" }),
        ),
        element(
            json!({ "type": "code", "id": "code-2", "language": "rust", "theme": "light", "lineNumbers": true, "firstLine": 41, "fontSize": 18,
            "code": "fn main() {\n    let v = vec![1, 2, 3];\n    println!(\"{}\", v.len());\n}" }),
        ),
        element(
            json!({ "type": "code", "id": "code-3", "language": "ts", "focus": ["1", "2-3", "4"],
            "code": "interface User {\n  id: number;\n  name: string;\n}" }),
        ),
        element(
            json!({ "type": "math", "id": "math-1", "latex": "\\int_0^1 x^2\\,dx = \\frac{1}{3}" }),
        ),
        element(
            json!({ "type": "math", "id": "math-2", "latex": "E = mc^2", "inline": true, "color": "accent1", "fontSize": 24 }),
        ),
        element(json!({ "type": "chat", "id": "chat-1", "messages": [
            { "role": "system", "text": "You are a helpful assistant." },
            { "role": "user", "text": "What is the weather in Oslo?" },
            { "role": "toolCall", "text": "get_weather(city=\"Oslo\")" },
            { "role": "toolResult", "text": "{\"temp\": 4, \"sky\": \"rain\"}" },
            { "role": "assistant", "text": "It is 4 degrees and raining in Oslo." } ] })),
        element(
            json!({ "type": "token-probs", "id": "probs-1", "tokens": ["The", " cat", " sat", " on", " the"], "chosen": 0,
            "next": [ { "token": " mat", "p": 0.42 }, { "token": " floor", "p": 0.3 }, { "token": " sofa", "p": 0.14 }, { "token": " bed", "p": 0.09 }, { "token": " roof", "p": 0.05 } ] }),
        ),
        element(json!({ "type": "card-grid", "id": "grid-1", "cards": [
            { "title": "Plan", "body": "Break the goal into steps." }, { "title": "Act", "body": "Call a tool." },
            { "title": "Observe", "body": "Read the result." }, { "title": "Reflect" },
            { "title": "Repeat", "body": "Until it is done." }, { "title": "Answer", "body": "Say what was found." } ] })),
        element(
            json!({ "type": "citation", "id": "cite-1", "keys": ["vaswani2017", "devlin2019"], "format": "short", "y": 470, "h": 30 }),
        ),
        element(
            json!({ "type": "citation", "id": "cite-2", "keys": ["vaswani2017", "devlin2019", "brown2020"], "format": "list", "y": 400, "h": 92 }),
        ),
        element(
            json!({ "type": "step-label", "id": "step-1", "x": 780, "y": 480, "w": 140, "h": 36 }),
        ),
        element(
            json!({ "type": "embed", "id": "embed-1", "url": "https://example.com/demo", "title": "The demo" }),
        ),
        element(
            json!({ "type": "embed", "id": "embed-2", "url": "https://example.com/demo", "poster": "assets/demo.png" }),
        ),
        element(
            json!({ "type": "embed", "id": "embed-3", "url": "", "source": { "page": "library/plan.md", "kind": "embed",
            "title": "Plan", "icon": "\u{1f4cb}", "markdown": "## Plan\n\nOne **idea** per card.\n\n- first\n  - nested\n- second\n\n> [!tip] Careful\n> Mind the gap.\n" } }),
        ),
        element(json!({ "type": "video", "id": "video-1", "src": "assets/clip.mp4" })),
        element(
            json!({ "type": "video", "id": "video-2", "src": "https://example.com/v.mp4", "poster": "assets/still.png" }),
        ),
        element(
            json!({ "type": "chart", "id": "chart-1", "kind": "bar", "title": "Sales by team",
            "categories": ["North", "South", "East", "West"], "labels": true,
            "series": [{ "name": "2025", "values": [12, 19, 8, 14] }, { "name": "2026", "values": [15, 17, 11, 16] }] }),
        ),
        element(json!({ "type": "chart", "id": "chart-2", "kind": "line",
            "categories": ["Mon", "Tue", "Wed", "Thu", "Fri"], "series": [{ "name": "Visits", "values": [3, 7, 4, 9, 6] }] })),
        element(
            json!({ "type": "chart", "id": "chart-3", "kind": "pie", "title": "Budget", "labels": true,
            "categories": ["Rent", "Food", "Fun"], "series": [{ "name": "Budget", "values": [50, 30, 20] }] }),
        ),
        element(
            json!({ "type": "timer", "id": "timer-1", "seconds": 300, "label": "Discussion", "x": 64, "y": 148, "w": 400, "h": 240 }),
        ),
        element(
            json!({ "type": "qr", "id": "qr-1", "data": "https://kasten.example/talk", "caption": "The slides", "x": 300, "y": 120, "w": 340, "h": 380 }),
        ),
    ]
}

const ROLES: [&str; 5] = ["system", "user", "assistant", "toolCall", "toolResult"];
const FORMATS: [&str; 4] = ["short", "full", "numbered", "list"];

/// A composite of the kind called `kind`, with text and numbers from a fuzzer.
pub fn odd(kind: &str, words: &str, more: &str, number: f64, count: usize) -> Element {
    let sized = if number.is_finite() {
        json!(number)
    } else {
        Value::Null
    };
    // What a number in a list must be: the file has no way to write one that is not a number.
    let finite = if number.is_finite() { number } else { 0.0 };
    let chart_kind = ["bar", "line", "pie"][count % 3];
    let value = match kind {
        "code" => json!({ "type": "code", "id": "odd", "language": more, "code": words,
            "lineNumbers": count.is_multiple_of(2), "firstLine": count, "fontSize": sized,
            "focus": (0..count % 5).map(|i| format!("{}-{}", i, count % 7)).collect::<Vec<_>>() }),
        "math" => {
            json!({ "type": "math", "id": "odd", "latex": words, "fontSize": sized, "inline": count.is_multiple_of(2) })
        }
        "chat" => json!({ "type": "chat", "id": "odd", "messages": (0..count % 9).map(|i| json!({
            "role": ROLES[i % 5], "text": if i % 2 == 0 { words } else { more } })).collect::<Vec<_>>() }),
        // A probability that is not a number cannot be written in JSON, so those are set after.
        "token-probs" => {
            json!({ "type": "token-probs", "id": "odd", "tokens": words.split(' ').collect::<Vec<_>>(), "chosen": count,
            "next": (0..count % 12).map(|i| json!({ "token": if i % 2 == 0 { more } else { words }, "p": 0.5 })).collect::<Vec<_>>() })
        }
        "card-grid" => json!({ "type": "card-grid", "id": "odd", "columns": count % 6,
            "cards": (0..count % 14).map(|i| json!({ "title": more, "body": if i % 3 == 0 { Value::Null } else { json!(words) } })).collect::<Vec<_>>() }),
        "citation" => json!({ "type": "citation", "id": "odd", "format": FORMATS[count % 4],
            "keys": (0..count % 10).map(|_| words).collect::<Vec<_>>() }),
        "step-label" => json!({ "type": "step-label", "id": "odd", "format": words }),
        "embed" => {
            json!({ "type": "embed", "id": "odd", "url": words, "title": more, "poster": if count.is_multiple_of(2) { Value::Null } else { json!(more) } })
        }
        "chart" => {
            json!({ "type": "chart", "id": "odd", "kind": chart_kind, "title": words, "labels": count.is_multiple_of(2),
            "categories": (0..count % 50).map(|i| if i % 2 == 0 { words } else { more }).collect::<Vec<_>>(),
            "series": (0..count % 5).map(|i| json!({ "name": more, "values": (0..count % 60).map(|j| finite / (j as f64 + i as f64 + 1.0)).collect::<Vec<_>>() })).collect::<Vec<_>>() })
        }
        "timer" => json!({ "type": "timer", "id": "odd", "seconds": count * 977, "label": words }),
        "qr" => {
            json!({ "type": "qr", "id": "odd", "data": words, "caption": if count.is_multiple_of(2) { Value::Null } else { json!(more) } })
        }
        _ => {
            json!({ "type": "video", "id": "odd", "src": words, "poster": if count.is_multiple_of(2) { Value::Null } else { json!(more) } })
        }
    };
    let mut made = element(value);
    if let Element::TokenProbs(e) = &mut made {
        for (i, next) in e.next.iter_mut().enumerate() {
            next.p = number / (i as f64 + 1.0);
        }
    }
    made
}

/// The names of the kinds, as `Element::kind` gives them.
pub const KINDS: [&str; 12] = [
    "code",
    "math",
    "chat",
    "token-probs",
    "card-grid",
    "citation",
    "step-label",
    "embed",
    "video",
    "chart",
    "timer",
    "qr",
];
