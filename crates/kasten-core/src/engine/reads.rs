//! What the engine answers without writing: notes, search, links, tasks
//! and history, from the index and git.

use super::Kasten;
use crate::error::Result;
use crate::history::CommitInfo;
use crate::index::TaskRow;
use crate::note::{NoteFile, NoteMeta};
use crate::search::{Backlink, DayMention, Hit};

impl Kasten {
    /// Notes about what the note at `path` is about, the most alike first.
    pub fn related(&self, path: &str, limit: usize) -> Result<Vec<crate::index::Related>> {
        self.index().related(path, limit)
    }

    /// Every note, from the index. AI actions are not among them: they are
    /// not notes to open or link, and `ai_actions` lists them.
    pub fn list(&self) -> Result<Vec<NoteMeta>> {
        let mut notes = self.index().notes()?;
        notes.retain(|note| note.kind != crate::note::AI_ACTION);
        Ok(notes)
    }

    /// The notes at `paths` that exist, in the order asked: what the app
    /// refreshes when the watcher reports a few files.
    pub fn notes_at(&self, paths: &[String]) -> Result<Vec<NoteMeta>> {
        let index = self.index();
        let mut out = Vec::with_capacity(paths.len());
        for path in paths {
            if let Some(meta) = index.note(path)?
                && meta.kind != crate::note::AI_ACTION
            {
                out.push(meta);
            }
        }
        Ok(out)
    }

    /// A note's text, remembered so a later save can merge.
    pub fn read(&self, path: &str) -> Result<NoteFile> {
        let note = self.vault.read(path)?;
        self.remember(&note.hash, &note.text);
        Ok(note)
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<Hit>> {
        self.index().search(query, limit)
    }

    /// Notes whose links go to the note at `path`.
    pub fn backlinks(&self, path: &str) -> Result<Vec<Backlink>> {
        self.index().backlinks(path)
    }

    /// Notes naming `title` without linking it.
    pub fn mentions(&self, title: &str, path: &str) -> Result<Vec<Backlink>> {
        self.index().mentions(title, path)
    }

    /// Notes that link each day from `from` to `to`, outside to-dos: the
    /// calendar's mentions.
    pub fn day_mentions(&self, from: &str, to: &str) -> Result<Vec<DayMention>> {
        self.index().day_mentions(from, to)
    }

    pub fn tasks(&self) -> Result<Vec<TaskRow>> {
        self.index().tasks()
    }

    /// The path of the note titled `title`, if any.
    pub fn path_of_title(&self, title: &str) -> Result<Option<String>> {
        Ok(self.index().by_title(title)?.into_iter().next())
    }

    pub fn path_of_id(&self, id: &str) -> Result<Option<String>> {
        self.index().by_id(id)
    }

    /// Commits, newest first; with a path, those that changed that note.
    pub fn log(&self, path: Option<&str>, limit: usize) -> Result<Vec<CommitInfo>> {
        match self.history.get() {
            Some(history) => history.log(path, limit),
            None => Ok(Vec::new()),
        }
    }

    /// A file's text at a commit.
    pub fn file_at(&self, rev: &str, path: &str) -> Result<Option<String>> {
        match self.history.get() {
            Some(history) => history.file_at(rev, path),
            None => Ok(None),
        }
    }

    /// Paths that differ from the last commit.
    pub fn dirty(&self) -> Result<Vec<String>> {
        match self.history.get() {
            Some(history) => history.dirty(),
            None => Ok(Vec::new()),
        }
    }

    /// Human edits waiting for their commit.
    pub fn pending_edits(&self) -> Vec<String> {
        self.state().edits.keys().cloned().collect()
    }

    /// Rebuilds the index from the files.
    pub fn reindex(&self) -> Result<usize> {
        self.index().rebuild(&self.vault)
    }
}
