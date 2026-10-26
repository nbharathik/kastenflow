//! A batch the person runs from the window: table bulk actions, a pasted block
//! of cells, "Turn into database". Many changes, all made or none, as one
//! commit that one Undo takes back (kasten-core's `batch_as_person`, which
//! keeps every limit and the vault's own folders out of reach). It runs as the
//! person; no agent tool reaches it.
//!
//! Also here: a page's blocks, which "Turn into database" reads to name the
//! table it replaces in the same batch.

use kasten_core::batch::refs::ops_from_json;
use kasten_core::pages::PageBlocks;
use kasten_core::{Instant, Kasten, PersonBatch};
use serde_json::Value;
use tauri::State;

use super::notes::OpenVault;

/// The blocks a call reads of one page at most (a page the editor opens has
/// far fewer).
const BLOCKS: usize = 1000;

/// Reads the changes and makes them as one batch.
pub(crate) fn run(
    kasten: &Kasten,
    changes: Vec<Value>,
    reason: Option<&str>,
    now: Instant,
) -> kasten_core::Result<PersonBatch> {
    let ops = ops_from_json(changes)?;
    kasten.batch_as_person(&ops, reason, now)
}

/// Makes the changes (each `{"kind": "create_note", …}` as kasten-core's
/// agent ops are written, a note an earlier change makes named as
/// `{"$ref": 0}`) all together or not at all: one commit, one Undo.
#[tauri::command(async)]
pub fn batch_run(
    state: State<'_, OpenVault>,
    changes: Vec<Value>,
    reason: Option<String>,
) -> Result<PersonBatch, String> {
    state.run(|k| run(k, changes, reason.as_deref(), Instant::now()))
}

/// The file the schema of a new tag will be written to (`tags/<name>.yaml`),
/// so a page edited in the same batch can embed the database it makes.
#[tauri::command(async)]
pub fn new_tag_file(tag: String) -> Result<String, String> {
    kasten_core::tags::tag_file(&tag).map_err(|err| err.to_string())
}

/// A page's blocks with the ids and hashes a page edit names. Writes nothing.
#[tauri::command(async)]
pub fn page_blocks(state: State<'_, OpenVault>, path: String) -> Result<PageBlocks, String> {
    state.run(|k| k.read_page_blocks(&path, 1, BLOCKS))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn vault(name: &str) -> (std::path::PathBuf, Kasten) {
        let dir = std::env::temp_dir().join(format!(
            "kasten-app-batch-{name}-{}",
            kasten_core::ulid_at(Instant::now().millis)
        ));
        let kasten = Kasten::init(&dir, "Batch").unwrap();
        (dir, kasten)
    }

    #[test]
    fn json_changes_become_one_commit_and_a_reference_names_the_note_made_before_it() {
        let (dir, kasten) = vault("json");
        let log = |k: &Kasten| k.log(None, 1000).unwrap().len();
        let before = log(&kasten);
        let done = run(
            &kasten,
            vec![
                json!({"kind": "create_note", "type": "page", "title": "Alpha"}),
                json!({"kind": "create_note", "type": "page", "title": "Beta", "parent": {"$ref": 0}}),
                json!({"kind": "update_props", "path": {"$ref": 1}, "props": {"rating": 4}}),
            ],
            Some("Make two pages"),
            Instant::now(),
        )
        .unwrap();
        assert_eq!(done.changes, 3);
        assert_eq!(log(&kasten), before + 1, "one commit");
        let head = &kasten.log(None, 1).unwrap()[0];
        assert_eq!(head.summary, "Make two pages");
        assert_eq!(done.commit.as_deref(), Some(head.id.as_str()));
        let beta = kasten
            .read(done.results[1]["path"].as_str().unwrap())
            .unwrap();
        assert!(beta.text.contains("rating: 4"), "{}", beta.text);
        // The answer is what the window reads.
        let wire = serde_json::to_value(&done).unwrap();
        assert_eq!(wire["changes"], 3);
        assert!(wire["commit"].is_string() && wire["results"][0]["path"].is_string());
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The JSON the window's "Turn into database" builds (app/src/lib/vault/batch-changes.ts):
    /// a schema, a sub-page per row, and the table's block replaced by the embed.
    #[test]
    fn the_changes_turn_into_database_sends_are_read_and_made_as_one_commit() {
        let (dir, kasten) = vault("database");
        let page = run(
            &kasten,
            vec![json!({"kind": "create_note", "type": "page", "title": "Reading", "tags": [], "props": {},
                "body": "# Reading\n\n| Title | Pages |\n| --- | --- |\n| Dune | 412 |\n\nAfter.\n"})],
            None,
            Instant::now(),
        )
        .unwrap();
        let path = page.results[0]["path"].as_str().unwrap().to_owned();
        let blocks = kasten.read_page_blocks(&path, 1, BLOCKS).unwrap();
        let table = blocks.blocks.iter().find(|b| b.table.is_some()).unwrap();
        let log = |k: &Kasten| k.log(None, 1000).unwrap().len();
        let before = log(&kasten);
        let done = run(
            &kasten,
            vec![
                json!({"kind": "tag_schema", "tag": "books", "schema": {
                    "properties": [{"key": "Pages", "type": "number"}],
                    "views": [{"name": "Table", "type": "table"}]}}),
                json!({"kind": "create_note", "type": "page", "title": "Dune", "tags": ["books"],
                    "props": {"Pages": 412}, "parent": path}),
                json!({"kind": "edit_page", "path": path, "steps": [{
                    "op": "replace",
                    "block": {"block": table.id, "hash": table.hash},
                    "markdown": "![[tags/books.yaml#Table]]\n"}]}),
            ],
            Some("Turn the table into a database: Books"),
            Instant::now(),
        )
        .unwrap();
        assert_eq!(done.changes, 3);
        assert_eq!(log(&kasten), before + 1, "one commit for all of it");
        let text = kasten.read(&path).unwrap().text;
        assert!(
            text.contains("![[tags/books.yaml#Table]]") && !text.contains("| Dune |"),
            "{text}"
        );
        assert!(dir.join("tags/books.yaml").exists());
        // The window's Undo is one call and takes every file back.
        kasten
            .undo_commit(done.commit.as_deref().unwrap(), Instant::now())
            .unwrap();
        assert!(kasten.read(&path).unwrap().text.contains("| Dune |"));
        assert!(!dir.join("tags/books.yaml").exists());
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_a_batch_cannot_hold_or_touch_is_refused_and_nothing_is_made() {
        let (dir, kasten) = vault("refuse");
        let before = kasten.list().unwrap().len();
        for (changes, said) in [
            (
                vec![json!({"kind": "nope"})],
                "Change 1 is not one a batch understands",
            ),
            (
                vec![
                    json!({"kind": "create_note", "type": "page", "title": "Alpha"}),
                    json!({"kind": "trash", "path": "library/x.md"}),
                ],
                "cannot be part of a batch",
            ),
            (
                vec![
                    json!({"kind": "create_note", "type": "page", "title": "Alpha"}),
                    json!({"kind": "append", "path": ".kasten/config.yaml", "markdown": "x"}),
                ],
                "keeps for itself",
            ),
            (vec![], "at least one change"),
        ] {
            let err = run(&kasten, changes, None, Instant::now())
                .unwrap_err()
                .to_string();
            assert!(err.contains(said), "{said}: {err}");
        }
        assert_eq!(kasten.list().unwrap().len(), before);
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
