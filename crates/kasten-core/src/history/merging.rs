//! Joining two lines of history, as Get latest does when both computers
//! changed the vault. What git joins cleanly stays as it joined it; every
//! clash is settled so that nothing either side wrote is lost:
//!
//! - text is merged line by line, a note's `updated` taking the later time;
//! - an edit wins over a delete;
//! - when both changed the same lines, or a file can't be merged, this
//!   computer's version stays and the other's is kept beside it as a copy,
//!   a note's with a title and id of its own;
//! - settings and tag schemas that clash stay as they are here, and the
//!   other computer's go under `.kasten/conflicts/`.

use std::collections::BTreeSet;
use std::path::Path;

use git2::{DiffOptions, IndexEntry, IndexTime, Oid, Repository};

use super::{Actor, History, full_message, locks::Writing, signature};
use crate::error::{Error, Result};
use crate::frontmatter::{Front, join, key_blocks, set_key, split, yaml_ok};
use crate::merge::merge3;
use crate::ops::eol_of;

/// How one clashing path is settled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Settled {
    /// These bytes at the path, or nothing there.
    Keep(Option<Vec<u8>>),
    /// Ours at the path, and theirs beside it at `copy`.
    Copy {
        ours: Vec<u8>,
        copy: String,
        theirs: Vec<u8>,
    },
    /// Ours at the path, and theirs set aside at `aside`.
    Aside {
        ours: Vec<u8>,
        aside: String,
        theirs: Vec<u8>,
    },
}

/// What joining two lines of history made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Joined {
    pub tree: String,
    /// Copies of the other computer's versions kept beside this one's.
    pub copies: Vec<String>,
    /// The other computer's settings and schemas set aside.
    pub set_aside: Vec<String>,
}

/// Files kept as they are here when they clash, with the other version
/// set aside: the vault's settings, and tag schemas.
fn set_aside(path: &str) -> bool {
    path.starts_with(".kasten/") || (path.starts_with("tags/") && path.ends_with(".yaml"))
}

/// The value of a note's `updated` key, if it has one.
fn updated(text: &str) -> Option<String> {
    key_blocks(split(text).prefix)
        .into_iter()
        .find(|(key, _)| key == "updated")
        .and_then(|(_, block)| {
            let value = block.split_once(':')?.1.trim();
            Some(value.trim_matches(['"', '\'']).to_owned())
        })
}

/// `text` with its `updated` set to `when`.
fn with_updated(text: &str, when: &str) -> String {
    let parts = split(text);
    let eol = eol_of(text);
    join(
        &set_key(parts.prefix, "updated", Some(when), eol),
        parts.body,
        eol,
    )
}

/// Merges text line by line, or None when both sides changed the same
/// lines or the result would not read as its kind of file.
fn merge_text(path: &str, base: Option<&[u8]>, ours: &[u8], theirs: &[u8]) -> Option<Vec<u8>> {
    let base = std::str::from_utf8(base.unwrap_or_default()).ok()?;
    let (mut ours, mut theirs) = (
        std::str::from_utf8(ours).ok()?.to_owned(),
        std::str::from_utf8(theirs).ok()?.to_owned(),
    );
    if path.ends_with(".md")
        && let (Some(a), Some(b)) = (updated(&ours), updated(&theirs))
        && a != b
    {
        // Every edit touches `updated`: the later time stands for both.
        let later = a.max(b);
        ours = with_updated(&ours, &later);
        theirs = with_updated(&theirs, &later);
    }
    let merged = merge3(base, &ours, &theirs)?;
    let reads = if path.ends_with(".md") {
        yaml_ok(split(&merged).prefix)
    } else if path.ends_with(".canvas") || path.ends_with(".deck") || path.ends_with(".json") {
        serde_json::from_str::<serde_json::Value>(&merged).is_ok()
    } else if path.ends_with(".yaml") || path.ends_with(".yml") {
        serde_saphyr::from_str::<crate::loose::Loose>(&merged).is_ok()
    } else if path.ends_with(crate::diagrams::EXT) {
        crate::diagrams::check_xml(&merged).is_ok()
    } else if path.ends_with(crate::diagrams::SIDECAR_EXT) {
        crate::diagrams::check_svg(&merged).is_ok()
    } else {
        true
    };
    reads.then(|| merged.into_bytes())
}

/// `path` with ` (<label>)` before its extension, numbered past any taken.
fn copy_path(path: &str, label: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let name_at = path.rfind('/').map_or(0, |i| i + 1);
    let (stem, ext) = match path[name_at..].rfind('.') {
        Some(dot) if dot > 0 => path.split_at(name_at + dot),
        _ => (path, ""),
    };
    let stem = crate::save::fitting(stem, label.len() + ext.len());
    let mut copy = format!("{stem} ({label}){ext}");
    let mut n = 2;
    while taken(&copy) {
        copy = format!("{stem} ({label} {n}){ext}");
        n += 1;
    }
    copy
}

/// A note from the other computer, as a copy with a title and id of its own.
fn relabel_note(text: &[u8], label: &str, id: &str) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(text) else {
        return text.to_vec();
    };
    let parts = split(text);
    if parts.prefix.is_empty() || !yaml_ok(parts.prefix) {
        return text.as_bytes().to_vec();
    }
    let eol = eol_of(text);
    let front = Front::read(parts.prefix);
    let mut prefix = parts.prefix.to_owned();
    if let Some(title) = Front::text(&front.title) {
        prefix = set_key(&prefix, "title", Some(&format!("{title} ({label})")), eol);
    }
    if front.id.is_some() {
        prefix = set_key(&prefix, "id", Some(id), eol);
    }
    join(&prefix, parts.body, eol).into_bytes()
}

/// Settles one path both sides changed.
pub(crate) fn settle(
    path: &str,
    base: Option<&[u8]>,
    ours: Option<&[u8]>,
    theirs: Option<&[u8]>,
    label: &str,
    taken: &dyn Fn(&str) -> bool,
    new_id: &mut dyn FnMut() -> String,
) -> Settled {
    let (ours, theirs) = match (ours, theirs) {
        (None, None) => return Settled::Keep(None),
        // An edit wins over a delete.
        (Some(one), None) | (None, Some(one)) => return Settled::Keep(Some(one.to_vec())),
        (Some(o), Some(t)) if o == t => return Settled::Keep(Some(o.to_vec())),
        (Some(o), Some(t)) => (o, t),
    };
    if let Some(merged) = merge_text(path, base, ours, theirs) {
        return Settled::Keep(Some(merged));
    }
    if set_aside(path) {
        let stamp: String = label.chars().filter(char::is_ascii_digit).collect();
        return Settled::Aside {
            ours: ours.to_vec(),
            aside: format!(".kasten/conflicts/{stamp}/{path}"),
            theirs: theirs.to_vec(),
        };
    }
    let theirs = if path.ends_with(".md") {
        relabel_note(theirs, label, &new_id())
    } else {
        theirs.to_vec()
    };
    Settled::Copy {
        ours: ours.to_vec(),
        copy: copy_path(path, label, taken),
        theirs,
    }
}

/// Adds `bytes` to `index` at `path` as a file with `mode`.
fn add_blob(
    repo: &Repository,
    index: &mut git2::Index,
    path: &str,
    bytes: &[u8],
    mode: u32,
) -> Result<()> {
    let id = repo.blob(bytes)?;
    index.add(&IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
        id,
        flags: u16::try_from(path.len().min(0xfff)).unwrap_or(0xfff),
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    })?;
    Ok(())
}

/// A note this computer put in the trash while the other computer edited
/// it: git follows the move into `.trash/` with the edit, and here the
/// note comes back out, edit and all, since an edit wins over a delete.
/// The path a file in the trash came from: `.trash/<when>/<path>`.
fn trashed_from(path: &str) -> Option<&str> {
    let (when, from) = path.strip_prefix(".trash/")?.split_once('/')?;
    (!when.is_empty() && !from.is_empty()).then_some(from)
}

fn untrash_edited(
    repo: &Repository,
    index: &mut git2::Index,
    (base, ours, theirs): (git2::Tree<'_>, git2::Tree<'_>, git2::Tree<'_>),
) -> Result<()> {
    let diff = repo.diff_tree_to_tree(Some(&base), Some(&theirs), None)?;
    let edited: Vec<String> = diff
        .deltas()
        .filter(|d| d.status() == git2::Delta::Modified)
        .filter_map(|d| d.new_file().path())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .filter(|p| !p.starts_with(".trash/"))
        .collect();
    for path in edited {
        if index.get_path(Path::new(&path), 0).is_some() || ours.get_path(Path::new(&path)).is_ok()
        {
            continue;
        }
        // The latest trashing of this very path: `.trash/<when>/<path>`.
        let trashed = index
            .iter()
            .map(|e| (String::from_utf8_lossy(&e.path).into_owned(), e))
            .filter(|(p, _)| trashed_from(p) == Some(path.as_str()))
            .last();
        if let Some((from, entry)) = trashed {
            index.remove_path(Path::new(&from))?;
            index.add(&IndexEntry {
                flags: u16::try_from(path.len().min(0xfff)).unwrap_or(0xfff),
                path: path.into_bytes(),
                ..entry
            })?;
        }
    }
    Ok(())
}

impl History {
    /// Whether the two commits share any history at all.
    pub(crate) fn related(&self, a: &str, b: &str) -> Result<bool> {
        let repo = self.repo();
        match repo.merge_base(Oid::from_str(a)?, Oid::from_str(b)?) {
            Ok(_) => Ok(true),
            Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(false),
            Err(err) => Err(err.into()),
        }
    }

    /// The tree a commit has.
    pub(crate) fn tree_of(&self, commit: &str) -> Result<String> {
        let repo = self.repo();
        Ok(repo
            .find_commit(Oid::from_str(commit)?)?
            .tree_id()
            .to_string())
    }

    /// Joins `theirs` into `ours` in memory, settling every clash: the
    /// tree the joining commit will have. `label` names copies, such as
    /// "from other computer 2026-09-28 10-20".
    pub(crate) fn join(
        &self,
        ours: &str,
        theirs: &str,
        label: &str,
        new_id: &mut dyn FnMut() -> String,
    ) -> Result<Joined> {
        let repo = self.repo();
        let (o, t) = (Oid::from_str(ours)?, Oid::from_str(theirs)?);
        let base = repo.merge_base(o, t)?;
        let tree = |id: Oid| repo.find_commit(id).and_then(|c| c.tree());
        let mut index = repo.merge_trees(&tree(base)?, &tree(o)?, &tree(t)?, None)?;
        let conflicts: Vec<git2::IndexConflict> =
            index.conflicts()?.collect::<std::result::Result<_, _>>()?;
        let entry_path = |e: &Option<IndexEntry>| {
            e.as_ref()
                .map(|e| String::from_utf8_lossy(&e.path).into_owned())
        };
        let mut taken: BTreeSet<String> = index
            .iter()
            .map(|e| String::from_utf8_lossy(&e.path).into_owned())
            .collect();
        let blob = |e: &Option<IndexEntry>| -> Result<Option<Vec<u8>>> {
            match e {
                Some(e) => Ok(Some(repo.find_blob(e.id)?.content().to_vec())),
                None => Ok(None),
            }
        };
        let mut joined = Joined {
            tree: String::new(),
            copies: Vec::new(),
            set_aside: Vec::new(),
        };
        for conflict in &conflicts {
            let Some(path) = entry_path(&conflict.our)
                .or_else(|| entry_path(&conflict.their))
                .or_else(|| entry_path(&conflict.ancestor))
            else {
                continue;
            };
            let mode = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .map_or(0o100644, |e| e.mode);
            let settled = settle(
                &path,
                blob(&conflict.ancestor)?.as_deref(),
                blob(&conflict.our)?.as_deref(),
                blob(&conflict.their)?.as_deref(),
                label,
                &|p| taken.contains(p),
                new_id,
            );
            index.conflict_remove(Path::new(&path))?;
            match settled {
                Settled::Keep(None) => {}
                Settled::Keep(Some(bytes)) => add_blob(&repo, &mut index, &path, &bytes, mode)?,
                Settled::Copy { ours, copy, theirs } => {
                    add_blob(&repo, &mut index, &path, &ours, mode)?;
                    add_blob(&repo, &mut index, &copy, &theirs, mode)?;
                    taken.insert(copy.clone());
                    joined.copies.push(copy);
                }
                Settled::Aside {
                    ours,
                    aside,
                    theirs,
                } => {
                    add_blob(&repo, &mut index, &path, &ours, mode)?;
                    add_blob(&repo, &mut index, &aside, &theirs, 0o100644)?;
                    joined.set_aside.push(aside);
                }
            }
        }
        untrash_edited(&repo, &mut index, (tree(base)?, tree(o)?, tree(t)?))?;
        joined.tree = index.write_tree_to(&repo)?.to_string();
        Ok(joined)
    }

    /// Moves the branch from `from` to `to`, only while it is still at
    /// `from`: a fast-forward, which the caller has proven.
    pub(crate) fn advance_branch(&self, from: &str, to: &str, message: &str) -> Result<()> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        let branch = format!("refs/heads/{}", self.branch()?);
        let repo = self.repo();
        repo.reference_matching(
            &branch,
            Oid::from_str(to)?,
            true,
            Oid::from_str(from)?,
            message,
        )?;
        Ok(())
    }

    /// Commits `tree` as the join of `ours` and `theirs`, on the branch,
    /// only while the branch is still at `ours`.
    pub(crate) fn commit_join(
        &self,
        tree: &str,
        ours: &str,
        theirs: &str,
        message: &str,
        trailers: &[(&str, String)],
    ) -> Result<String> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        let repo = self.repo();
        let tree = repo.find_tree(Oid::from_str(tree)?)?;
        let (o, t) = (
            repo.find_commit(Oid::from_str(ours)?)?,
            repo.find_commit(Oid::from_str(theirs)?)?,
        );
        let signature = signature(&repo, &Actor::Human)?;
        let text = full_message(message, &Actor::Human, "get_latest", trailers);
        let id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &text,
            &tree,
            &[&o, &t],
        )?;
        Ok(id.to_string())
    }

    /// The files that differ between two trees.
    pub(crate) fn changed_between(&self, old: &str, new: &str) -> Result<Vec<String>> {
        let repo = self.repo();
        let (old, new) = (
            repo.find_tree(Oid::from_str(old)?)?,
            repo.find_tree(Oid::from_str(new)?)?,
        );
        let diff = repo.diff_tree_to_tree(Some(&old), Some(&new), Some(&mut DiffOptions::new()))?;
        let mut out: Vec<String> = diff
            .deltas()
            .flat_map(|d| [d.old_file().path(), d.new_file().path()])
            .flatten()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();
        out.sort();
        out.dedup();
        Ok(out)
    }

    /// A file's bytes in a tree, or None when it is not there.
    pub(crate) fn blob_in_tree(&self, tree: &str, path: &str) -> Result<Option<Vec<u8>>> {
        let repo = self.repo();
        let tree = repo.find_tree(Oid::from_str(tree)?)?;
        let Ok(entry) = tree.get_path(Path::new(path)) else {
            return Ok(None);
        };
        Ok(Some(repo.find_blob(entry.id())?.content().to_vec()))
    }

    /// `tree` with the files in `files` written anew: the new tree.
    pub(crate) fn replace_in_tree(
        &self,
        tree: &str,
        files: &[(String, Vec<u8>)],
    ) -> Result<String> {
        let repo = self.repo();
        let mut index = git2::Index::new()?;
        index.read_tree(&repo.find_tree(Oid::from_str(tree)?)?)?;
        for (path, bytes) in files {
            let mode = index
                .get_path(Path::new(path), 0)
                .map_or(0o100644, |e| e.mode);
            add_blob(&repo, &mut index, path, bytes, mode)?;
        }
        Ok(index.write_tree_to(&repo)?.to_string())
    }
}

/// The error for two histories that share nothing.
pub(crate) fn unrelated() -> Error {
    Error::Invalid(
        "This backup is a different vault: its history shares nothing with this one, so nothing was changed. Restore it into an empty folder instead".into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str =
        "---\nid: A1\ntitle: Plan\nupdated: 2026-09-23T10:00:00Z\n---\nOne\nTwo\nThree\n";

    #[test]
    fn a_trashed_file_is_known_by_its_whole_path() {
        assert_eq!(
            trashed_from(".trash/20260928T101500Z/notes/a.md"),
            Some("notes/a.md")
        );
        // A deeper file that only ends the same is another file.
        assert_ne!(
            trashed_from(".trash/20260928T101500Z/old/notes/a.md"),
            Some("notes/a.md")
        );
        assert_eq!(trashed_from("notes/a.md"), None);
        assert_eq!(trashed_from(".trash/a.md"), None);
    }

    fn settle_here(path: &str, base: &str, ours: &str, theirs: &str) -> Settled {
        let mut n = 0;
        settle(
            path,
            Some(base.as_bytes()),
            Some(ours.as_bytes()),
            Some(theirs.as_bytes()),
            "from other computer 2026-09-28 10-20",
            &|p| p == "plan (from other computer 2026-09-28 10-20).md",
            &mut || {
                n += 1;
                format!("NEW{n}")
            },
        )
    }

    #[test]
    fn edits_to_other_lines_merge_with_the_later_update_time() {
        let ours = NOTE.replace("One", "Uno").replace("10:00", "11:00");
        let theirs = NOTE.replace("Three", "Tres").replace("10:00", "12:00");
        let Settled::Keep(Some(merged)) = settle_here("plan.md", NOTE, &ours, &theirs) else {
            panic!("not merged");
        };
        let merged = String::from_utf8(merged).unwrap();
        assert!(merged.contains("Uno\nTwo\nTres\n"), "{merged}");
        assert!(merged.contains("updated: 2026-09-23T12:00:00Z"), "{merged}");
    }

    #[test]
    fn edits_to_the_same_lines_keep_a_copy_with_its_own_title_and_id() {
        let ours = NOTE.replace("Two", "Mine");
        let theirs = NOTE.replace("Two", "Yours");
        let Settled::Copy {
            ours: kept,
            copy,
            theirs: other,
        } = settle_here("plan.md", NOTE, &ours, &theirs)
        else {
            panic!("no copy");
        };
        assert_eq!(kept, ours.as_bytes());
        assert_eq!(copy, "plan (from other computer 2026-09-28 10-20 2).md");
        let other = String::from_utf8(other).unwrap();
        assert!(other.contains("Yours"));
        assert!(other.contains("id: NEW1"), "{other}");
        assert!(
            other.contains("title: Plan (from other computer 2026-09-28 10-20)"),
            "{other}"
        );
    }

    #[test]
    fn an_edit_wins_over_a_delete_either_way() {
        let edited = NOTE.replace("Two", "Still here");
        for (ours, theirs) in [
            (Some(edited.as_bytes()), None),
            (None, Some(edited.as_bytes())),
        ] {
            let settled = settle(
                "plan.md",
                Some(NOTE.as_bytes()),
                ours,
                theirs,
                "x",
                &|_| false,
                &mut String::new,
            );
            assert_eq!(settled, Settled::Keep(Some(edited.clone().into_bytes())));
        }
    }

    #[test]
    fn settings_and_schemas_that_clash_are_set_aside() {
        let base = "name: Vault\n";
        match settle_here(
            ".kasten/config.yaml",
            base,
            "name: Desk\n",
            "name: Laptop\n",
        ) {
            Settled::Aside {
                ours,
                aside,
                theirs,
            } => {
                assert_eq!(ours, b"name: Desk\n");
                assert_eq!(aside, ".kasten/conflicts/202609281020/.kasten/config.yaml");
                assert_eq!(theirs, b"name: Laptop\n");
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            settle_here("tags/task.yaml", "a: 1\n", "a: 2\n", "a: 3\n"),
            Settled::Aside { .. }
        ));
    }

    #[test]
    fn decks_merge_when_edits_are_on_different_slides_and_keep_both_when_the_result_breaks() {
        let slide = |id: &str, text: &str| format!("    {{ \"id\": \"{id}\", \"t\": \"{text}\" }}");
        let deck = |a: &str, b: &str, c: &str| {
            format!(
                "{{\n  \"format\": \"kasten-deck\",\n  \"slides\": [\n{},\n{},\n{}\n  ]\n}}\n",
                slide("s-a", a),
                slide("s-b", b),
                slide("s-c", c)
            )
        };
        let base = deck("one", "two", "three");
        let ours = deck("ONE", "two", "three");
        let theirs = deck("one", "two", "THREE");
        match settle_here("projects/p/decks/d.deck", &base, &ours, &theirs) {
            Settled::Keep(Some(bytes)) => {
                assert_eq!(
                    String::from_utf8(bytes).unwrap(),
                    deck("ONE", "two", "THREE")
                );
            }
            other => panic!("{other:?}"),
        }
        // Both changed the same slide: kept as two files, not a broken one.
        let clash = deck("uno", "two", "three");
        assert!(matches!(
            settle_here("projects/p/decks/d.deck", &base, &ours, &clash),
            Settled::Copy { .. }
        ));
    }

    #[test]
    fn a_merge_that_breaks_a_board_or_binary_files_keep_both() {
        let base = "{\"nodes\":[\n{\"id\":\"a\"}\n]}\n";
        let ours = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"b\"}\n]}\n";
        let theirs = "{\"nodes\":[\n{\"id\":\"a\"},\n{\"id\":\"c\"}\n]}\n";
        assert!(matches!(
            settle_here("boards/b.canvas", base, ours, theirs),
            Settled::Copy { .. }
        ));
        let settled = settle(
            "assets/photo.png",
            Some(&[1, 2, 3][..]),
            Some(&[1, 2, 4][..]),
            Some(&[0xff, 0xfe, 5][..]),
            "from other computer 2026-09-28 10-20",
            &|_| false,
            &mut String::new,
        );
        match settled {
            Settled::Copy { copy, .. } => {
                assert_eq!(
                    copy,
                    "assets/photo (from other computer 2026-09-28 10-20).png"
                )
            }
            other => panic!("{other:?}"),
        }
    }
}
