//! The chat list's size: the panel shows the newest `chat.list_size` threads
//! and the rest are archived, which only sets `archived: true` in the
//! thread's head file. An archived thread is still saved, searchable and can
//! be reopened. Nothing is ever deleted because of the list's size: a person
//! deletes archived chats themselves, by name (`chat_delete_archived`).

use serde::Serialize;

use super::store::Head;

/// What the list size may be set to, and what it is without a setting.
pub const LIST_SIZE: (usize, usize) = (10, 200);
pub const DEFAULT_LIST_SIZE: usize = 30;

/// What the cap needs to know about a saved thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub id: String,
    /// Milliseconds since the epoch.
    pub updated: u64,
    pub archived: bool,
    /// Tied to a page, deck or diagram: it lives with that, not in the list.
    pub bound: bool,
    /// A turn is working in it.
    pub running: bool,
}

impl Candidate {
    pub fn of(head: &Head, running: bool) -> Candidate {
        Candidate {
            id: head.summary.id.clone(),
            updated: head.summary.updated,
            archived: head.summary.archived,
            bound: head.summary.bound.is_some(),
            running,
        }
    }
}

/// The threads to archive so the list holds `cap` at most: the oldest of the
/// unarchived ones that no page owns. A thread that is working is left until
/// it is done. Newest first among equals by name, so the answer is steady.
pub fn overflow(threads: &[Candidate], cap: usize) -> Vec<String> {
    let mut listed: Vec<&Candidate> = threads.iter().filter(|t| !t.archived && !t.bound).collect();
    listed.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.id.cmp(&b.id)));
    listed
        .into_iter()
        .skip(cap)
        .filter(|t| !t.running)
        .map(|t| t.id.clone())
        .collect()
}

/// A chat that was not deleted, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Skipped {
    pub id: String,
    pub reason: String,
}

/// What `chat_delete_archived` did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Deleted {
    /// The chats removed, by name.
    pub deleted: Vec<String>,
    /// How many that is, for the sentence "Deleted 12 archived chats".
    pub count: usize,
    /// Named chats that stayed: not archived, still working, or with changes
    /// waiting for review.
    pub skipped: Vec<Skipped>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(id: &str, updated: u64) -> Candidate {
        Candidate {
            id: id.to_owned(),
            updated,
            archived: false,
            bound: false,
            running: false,
        }
    }

    #[test]
    fn the_oldest_beyond_the_cap_are_archived_and_nothing_else() {
        let all: Vec<Candidate> = (0..15).map(|n| thread(&format!("c{n}"), n)).collect();
        assert!(overflow(&all, 15).is_empty());
        assert!(overflow(&all, 100).is_empty());
        let over = overflow(&all, 10);
        assert_eq!(over, ["c4", "c3", "c2", "c1", "c0"]);
    }

    #[test]
    fn archived_bound_and_working_threads_do_not_count_or_move() {
        let mut all: Vec<Candidate> = (0..12).map(|n| thread(&format!("c{n}"), 10 + n)).collect();
        all[0].archived = true;
        all[1].bound = true;
        all[2].running = true;
        // c0 (archived) and c1 (bound) are out of the count: c2 to c11 are ten.
        let over = overflow(&all, 10);
        assert!(
            over.is_empty(),
            "c2 is the tenth and still inside: {over:?}"
        );
        let over = overflow(&all, 9);
        assert!(
            over.is_empty(),
            "c2 is the oldest counted but it is working: {over:?}"
        );
        all[2].running = false;
        assert_eq!(overflow(&all, 9), ["c2"]);
    }
}
