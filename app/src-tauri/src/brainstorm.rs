//! "Brainstorm on this board": what the model is asked,
//! how its answer becomes ideas, and the command that places them. Placing
//! is one core op, `Kasten::brainstorm`, run in the brainstorm's own agent
//! session, so History shows it as one session and "Undo session" takes all
//! of it back.

use std::sync::Arc;

use kasten_core::agent::Session;
use kasten_core::board::BoardView;
use kasten_core::{Brainstormed, Idea, Instant, Kasten, MAX_IDEAS};
use serde_json::Value;
use tauri::State;

use crate::chat::commands::ChatState;
use crate::chat::model::{Model, complete};
use crate::commands::notes::OpenVault;

/// The client name a brainstorm's session carries in History.
pub const CLIENT: &str = "kasten-brainstorm";
/// The longest section label a topic makes.
const MAX_LABEL: usize = 60;

/// Board items quoted to the model, so a big board does not crowd it out.
const MAX_CONTEXT_ITEMS: usize = 60;
/// Characters of a sticky or label quoted.
const MAX_ITEM_CHARS: usize = 200;

pub const SYSTEM: &str = "You help someone think on a whiteboard in KastenFlow, a notes app. \
Reply with a JSON array and nothing else: [{\"title\": \"...\", \"text\": \"...\"}]. \
Each title is short (under 60 characters) and names one distinct, concrete idea; \
text says in one to three sentences what it is and why it might help. \
Do not repeat what is already on the board. No Markdown, no code fences, no commentary.";

/// The request for `count` ideas about `topic`, with what the board holds.
pub fn request(board: &BoardView, topic: &str, count: usize) -> String {
    let count = count.clamp(1, MAX_IDEAS);
    let mut items: Vec<String> = board
        .nodes
        .iter()
        .filter_map(|n| {
            let name = n
                .title
                .as_deref()
                .or(n.label.as_deref())
                .or(n.text.as_deref())?;
            let name: String = name.trim().chars().take(MAX_ITEM_CHARS).collect();
            (!name.is_empty()).then(|| format!("- {}", name.replace('\n', " ")))
        })
        .collect();
    let more = items.len().saturating_sub(MAX_CONTEXT_ITEMS);
    items.truncate(MAX_CONTEXT_ITEMS);
    let holds = if items.is_empty() {
        "The board is empty.".to_owned()
    } else {
        let tail = if more > 0 {
            format!("\n(and {more} more)")
        } else {
            String::new()
        };
        format!("The board holds:\n{}{tail}", items.join("\n"))
    };
    let topic = match topic.trim() {
        "" => format!("whatever would move “{}” forward", board.title),
        topic => topic.to_owned(),
    };
    format!(
        "Board: “{}”\n{holds}\n\nGive {count} new ideas about: {topic}",
        board.title
    )
}

/// The ideas in a model's answer: the first JSON array in it, of objects
/// with a title (or name/idea) and text (or description/body), or of plain
/// strings. At most `count`; entries without a title are dropped.
pub fn parse_ideas(answer: &str, count: usize) -> Result<Vec<Idea>, String> {
    let start = answer
        .find('[')
        .ok_or("The model's answer held no list of ideas")?;
    let end = answer
        .rfind(']')
        .filter(|end| *end > start)
        .ok_or("The model's answer held no list of ideas")?;
    let list: Vec<Value> = serde_json::from_str(&answer[start..=end])
        .map_err(|err| format!("The model's list of ideas could not be read: {err}"))?;
    let text_of = |value: &Value, keys: &[&str]| {
        keys.iter()
            .find_map(|k| value.get(*k).and_then(Value::as_str))
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    let ideas: Vec<Idea> = list
        .iter()
        .filter_map(|item| {
            let (title, text) = match item {
                Value::String(s) => (s.trim().to_owned(), String::new()),
                Value::Object(_) => (
                    text_of(item, &["title", "name", "idea"]),
                    text_of(item, &["text", "description", "body", "why"]),
                ),
                _ => return None,
            };
            (!title.is_empty()).then_some(Idea { title, text })
        })
        .take(count.clamp(1, MAX_IDEAS))
        .collect();
    if ideas.is_empty() {
        return Err("The model gave no ideas with a title".into());
    }
    Ok(ideas)
}

/// The new section's label: the topic, shortened, else "Brainstorm".
fn label_of(topic: &str) -> String {
    let topic = topic.trim();
    if topic.is_empty() {
        return "Brainstorm".into();
    }
    let mut label: String = topic.chars().take(MAX_LABEL).collect();
    if topic.chars().count() > MAX_LABEL {
        label = format!("{}…", label.trim_end());
    }
    label
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(crate::crash::joined)?
}

/// Asks `model` for `count` ideas about `topic` and places them on `board`
/// in a new session. Refused, as the chat is, in a vault without history,
/// where the brainstorm could not be undone.
pub(crate) async fn run(
    kasten: Arc<Kasten>,
    model: &impl Model,
    board: String,
    topic: String,
    count: usize,
) -> Result<Brainstormed, String> {
    if !kasten.has_history() {
        return Err("This vault keeps no history, so a brainstorm could not be undone. Turn on history in Settings first.".into());
    }
    let (k, b) = (Arc::clone(&kasten), board.clone());
    let view = blocking(move || {
        k.board(&k.resolve_board(&b).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    })
    .await?;
    let answer = complete(model, SYSTEM, &request(&view, &topic, count)).await?;
    let ideas = parse_ideas(&answer, count)?;
    let label = label_of(&topic);
    blocking(move || {
        let session = Session::start(CLIENT, Instant::now());
        kasten
            .brainstorm(&session, &view.path, &label, &ideas, Instant::now())
            .map_err(|e| e.to_string())
    })
    .await
}

/// "Brainstorm on this board": the model is `model` of `provider`, as a chat
/// would ask it.
#[tauri::command]
pub async fn brainstorm_board(
    vault: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    board: String,
    topic: String,
    count: usize,
    provider: String,
    model: String,
) -> Result<Brainstormed, String> {
    let kasten = vault.require()?;
    let model = chat.model(&kasten, &provider, &model).await?;
    run(kasten, &model, board, topic, count).await
}

#[cfg(test)]
mod tests {
    use kasten_core::Instant;
    use kasten_core::board::{BoardView, NodeView};

    use super::{CLIENT, label_of, parse_ideas, request, run};
    use crate::chat::model::Stop;
    use crate::chat::tests::{Fake, Step, block_on, vault, vault_with};

    const BOARD: &str = "projects/photo-organiser/boards/brainstorm.canvas";

    fn node(title: Option<&str>, text: Option<&str>) -> NodeView {
        NodeView {
            title: title.map(Into::into),
            text: text.map(Into::into),
            ..Default::default()
        }
    }

    #[test]
    fn asks_for_ideas_with_what_the_board_holds() {
        let board = BoardView {
            path: "projects/trip/boards/hilltown.canvas".into(),
            title: "Hilltown".into(),
            nodes: vec![
                node(Some("The old temple"), None),
                node(None, Some("Book the\nguesthouse")),
                node(None, None),
            ],
            edges: vec![],
            source: None,
        };
        let asked = request(&board, "day trips", 5);
        assert!(asked.contains("Board: “Hilltown”"), "{asked}");
        assert!(
            asked.contains("- The old temple\n- Book the guesthouse"),
            "{asked}"
        );
        assert!(
            asked.ends_with("Give 5 new ideas about: day trips"),
            "{asked}"
        );
        let empty = BoardView {
            title: "Hilltown".into(),
            ..board.clone()
        };
        let empty = BoardView {
            nodes: vec![],
            ..empty
        };
        assert!(request(&empty, " ", 50).contains(
            "The board is empty.\n\nGive 20 new ideas about: whatever would move “Hilltown” forward"
        ));
    }

    #[test]
    fn reads_ideas_from_the_answer_however_it_is_wrapped() {
        let fenced = "Here you go:\n```json\n[{\"title\": \"Nara day trip\", \"text\": \"Deer and temples.\"}, {\"name\": \"Arashiyama\", \"description\": \"Bamboo at dawn.\"}]\n```";
        let ideas = parse_ideas(fenced, 10).unwrap();
        assert_eq!(ideas.len(), 2);
        assert_eq!(
            (ideas[0].title.as_str(), ideas[0].text.as_str()),
            ("Nara day trip", "Deer and temples.")
        );
        assert_eq!(
            (ideas[1].title.as_str(), ideas[1].text.as_str()),
            ("Arashiyama", "Bamboo at dawn.")
        );
        let plain = parse_ideas("[\"One\", \"  \", \"Two\", \"Three\"]", 2).unwrap();
        assert_eq!(
            plain.iter().map(|i| i.title.as_str()).collect::<Vec<_>>(),
            ["One", "Two"]
        );
    }

    #[test]
    fn says_why_when_there_are_no_ideas() {
        assert!(
            parse_ideas("I cannot help with that.", 5)
                .unwrap_err()
                .contains("no list")
        );
        assert!(
            parse_ideas("[{\"text\": \"no title\"}]", 5)
                .unwrap_err()
                .contains("no ideas")
        );
        assert!(
            parse_ideas("[not json]", 5)
                .unwrap_err()
                .contains("could not be read")
        );
    }

    #[test]
    fn labels_sections_by_the_topic() {
        assert_eq!(label_of("  "), "Brainstorm");
        assert_eq!(label_of("day trips"), "day trips");
        assert!(label_of(&"x".repeat(80)).ends_with('…'));
    }

    #[test]
    fn places_the_ideas_in_one_session_that_undoes_whole() {
        let v = vault();
        let fake = Fake::new(vec![Step::Reply(
            "[{\"title\": \"Group photos by date\", \"text\": \"Match before sorting.\"}, {\"title\": \"Score by size\", \"text\": \"Weight by resolution.\"}]",
            vec![],
            Stop::End,
        )]);
        let before = v.kasten.board(BOARD).unwrap().nodes.len();
        let done = block_on(run(
            v.kasten.clone(),
            &fake,
            BOARD.into(),
            "Ways to measure edits".into(),
            5,
        ))
        .unwrap();
        assert_eq!(done.cards.len(), 2);
        assert_eq!(v.kasten.board(BOARD).unwrap().nodes.len(), before + 3);
        // The model saw the board and the topic.
        let (system, _) = fake.requests.lock().unwrap()[0].clone();
        assert!(system.contains("JSON array"), "{system}");
        let session = v
            .kasten
            .sessions(10)
            .unwrap()
            .into_iter()
            .find(|s| s.id == done.session)
            .unwrap();
        assert_eq!(session.client, CLIENT);
        let undone = v
            .kasten
            .undo_session(&done.session, Instant::now())
            .unwrap();
        assert!(undone.conflict.is_none());
        assert_eq!(v.kasten.board(BOARD).unwrap().nodes.len(), before);
    }

    #[test]
    fn refuses_a_vault_without_history_and_an_answer_without_ideas() {
        let bare = vault_with(false);
        let fake = Fake::new(vec![]);
        let err =
            block_on(run(bare.kasten.clone(), &fake, BOARD.into(), "x".into(), 3)).unwrap_err();
        assert!(err.contains("no history"), "{err}");
        let v = vault();
        let fake = Fake::new(vec![Step::Reply(
            "Sorry, no ideas today.",
            vec![],
            Stop::End,
        )]);
        let err = block_on(run(v.kasten.clone(), &fake, BOARD.into(), "x".into(), 3)).unwrap_err();
        assert!(err.contains("no list"), "{err}");
    }
}
