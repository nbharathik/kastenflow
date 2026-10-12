//! Backup files: the whole history in one file, a git bundle, which plain
//! git can clone. It is written from the vault's own history, checked by
//! reading every object back in a scratch repository, and restored into an
//! empty folder.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{ObjectType, Oid, Repository, RepositoryInitOptions};
use serde::Serialize;

use super::{History, keep_line_endings};
use crate::error::{Error, Result};
use crate::id::ulid_at;
use crate::time::Instant;

/// The longest header line read: a file that is not a bundle can't make
/// Kasten read it whole as one line.
const MAX_LINE: u64 = 4096;

/// What a backup file holds: its newest commit and the branch it is on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleHeader {
    pub head: String,
    pub branch: String,
}

fn not_a_backup(why: &str) -> Error {
    Error::Invalid(format!("This is not a KastenFlow backup file: {why}"))
}

/// One header line, without its line end, or None at the end of the file.
fn line(reader: &mut impl BufRead) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    let read = reader
        .by_ref()
        .take(MAX_LINE)
        .read_until(b'\n', &mut bytes)?;
    if read == 0 {
        return Ok(None);
    }
    if bytes.last() != Some(&b'\n') {
        return Err(not_a_backup("its header is cut off or too long"));
    }
    bytes.pop();
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| not_a_backup("its header is not text"))
}

/// Reads a bundle's header, leaving `reader` at the start of its pack.
fn parse_header(reader: &mut impl BufRead) -> Result<BundleHeader> {
    let first = line(reader)?.ok_or_else(|| not_a_backup("it is empty"))?;
    if first != "# v2 git bundle" && first != "# v3 git bundle" {
        return Err(not_a_backup("it does not start as a git bundle does"));
    }
    let mut refs: Vec<(String, String)> = Vec::new();
    loop {
        let Some(line) = line(reader)? else {
            return Err(not_a_backup("its header never ends"));
        };
        if line.is_empty() {
            break;
        }
        if line.starts_with('-') {
            return Err(not_a_backup(
                "it needs another file's history too, and KastenFlow's files hold everything",
            ));
        }
        if let Some(capability) = line.strip_prefix('@') {
            if capability.starts_with("object-format=") && capability != "object-format=sha1" {
                return Err(not_a_backup(
                    "its history uses a kind of id KastenFlow doesn't read",
                ));
            }
            continue;
        }
        let (id, name) = line
            .split_once(' ')
            .ok_or_else(|| not_a_backup("a line of its header is not an id and a name"))?;
        Oid::from_str(id).map_err(|_| not_a_backup("a line of its header has no valid id"))?;
        refs.push((id.to_owned(), name.to_owned()));
    }
    let branch_of = |name: &str| {
        name.strip_prefix("refs/heads/")
            .filter(|b| git2::Reference::is_valid_name(&format!("refs/heads/{b}")))
            .map(str::to_owned)
    };
    let head = refs
        .iter()
        .find(|(_, name)| name == "HEAD")
        .or_else(|| refs.iter().find(|(_, name)| name == "refs/heads/main"))
        .or_else(|| refs.iter().find(|(_, name)| branch_of(name).is_some()))
        .map(|(id, _)| id.clone())
        .ok_or_else(|| not_a_backup("it names no branch"))?;
    let branch = refs
        .iter()
        .filter(|(id, _)| *id == head)
        .filter_map(|(_, name)| branch_of(name))
        .min_by_key(|b| b != "main")
        .unwrap_or_else(|| "main".to_owned());
    Ok(BundleHeader { head, branch })
}

/// What a backup file holds, from its header alone.
pub fn read_bundle_header(path: &Path) -> Result<BundleHeader> {
    parse_header(&mut BufReader::new(File::open(path)?))
}

/// Adds a bundle's objects to `repo`, checking the pack as it goes.
pub(super) fn index_into(repo: &Repository, path: &Path) -> Result<BundleHeader> {
    let mut reader = BufReader::new(File::open(path)?);
    let header = parse_header(&mut reader)?;
    let odb = repo.odb()?;
    let mut writer = odb.packwriter()?;
    io::copy(&mut reader, &mut writer)?;
    writer.commit()?;
    Ok(header)
}

/// Reads every commit, tree and file reachable from `head`, once each.
pub(super) fn read_all(repo: &Repository, head: Oid) -> Result<usize> {
    let mut seen: HashSet<Oid> = HashSet::new();
    let mut walk = repo.revwalk()?;
    walk.push(head)?;
    let mut trees = Vec::new();
    for id in walk {
        let commit = repo.find_commit(id?)?;
        seen.insert(commit.id());
        trees.push(commit.tree_id());
    }
    while let Some(id) = trees.pop() {
        if !seen.insert(id) {
            continue;
        }
        let tree = repo.find_tree(id)?;
        for entry in tree.iter() {
            match entry.kind() {
                Some(ObjectType::Tree) => trees.push(entry.id()),
                Some(ObjectType::Blob) if seen.insert(entry.id()) => {
                    repo.find_blob(entry.id())?;
                }
                _ => {}
            }
        }
    }
    Ok(seen.len())
}

/// Checks a backup file whole: its objects go into a scratch repository in
/// `scratch_parent` and every one the history needs is read back. The
/// scratch repository is removed after.
pub fn verify_bundle(path: &Path, scratch_parent: &Path) -> Result<BundleHeader> {
    let scratch = scratch_parent.join(format!("bundle-check-{}", ulid_at(Instant::now().millis)));
    let checked = (|| {
        let repo = Repository::init_bare(&scratch)?;
        let header = index_into(&repo, path)?;
        read_all(&repo, Oid::from_str(&header.head)?)?;
        Ok(header)
    })();
    // Kasten's own scratch copy, never the person's files.
    let _ = fs::remove_dir_all(&scratch);
    checked
}

/// Restores a backup file into `target`, which must be missing or an empty
/// folder. The vault is built in a hidden folder beside it and moved into
/// place only when whole, so a failure leaves `target` as it was.
pub fn restore_from_bundle(bundle: &Path, target: &Path) -> Result<BundleHeader> {
    if target.exists() && fs::read_dir(target)?.next().is_some() {
        return Err(Error::Invalid(format!(
            "{} has files in it. Restore into an empty folder, so nothing there is overwritten",
            target.display()
        )));
    }
    let header = read_bundle_header(bundle)?;
    let parent = target
        .parent()
        .ok_or_else(|| Error::Invalid("Restore into a folder inside another one".into()))?;
    fs::create_dir_all(parent)?;
    let work = parent.join(format!(
        ".kasten-restore-{}",
        ulid_at(Instant::now().millis)
    ));
    let built = (|| {
        let repo = Repository::init_opts(
            &work,
            RepositoryInitOptions::new().initial_head(&header.branch),
        )?;
        keep_line_endings(&repo)?;
        // A link in the file is written as a plain file: it never points
        // outside the vault.
        repo.config()?.set_bool("core.symlinks", false)?;
        index_into(&repo, bundle)?;
        let head = Oid::from_str(&header.head)?;
        read_all(&repo, head)?;
        let branch = format!("refs/heads/{}", header.branch);
        repo.reference(&branch, head, false, "restore: from a backup file")?;
        repo.set_head(&branch)?;
        // The folder is new and empty: nothing there to keep.
        repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
        Ok(())
    })();
    if let Err(err) = built {
        // Only the hidden folder this restore made.
        let _ = fs::remove_dir_all(&work);
        return Err(err);
    }
    if target.exists() {
        // Checked empty above; remove_dir removes only an empty folder.
        fs::remove_dir(target)?;
    }
    fs::rename(&work, target)?;
    Ok(header)
}

impl History {
    /// Writes the whole history, as a git bundle, to `out`.
    pub fn write_bundle(&self, out: &mut impl Write) -> Result<BundleHeader> {
        let repo = self.own_repo()?;
        let head_ref = repo.head()?;
        let head = head_ref
            .target()
            .ok_or_else(|| Error::Invalid("This vault's history has no commit yet".into()))?;
        let branch = head_ref.shorthand().unwrap_or("main").to_owned();
        out.write_all(
            format!("# v2 git bundle\n{head} refs/heads/{branch}\n{head} HEAD\n\n").as_bytes(),
        )?;
        let mut pack = repo.packbuilder()?;
        let mut walk = repo.revwalk()?;
        walk.push(head)?;
        pack.insert_walk(&mut walk)?;
        let mut failed: Option<io::Error> = None;
        let written = pack.foreach(|chunk| match out.write_all(chunk) {
            Ok(()) => true,
            Err(err) => {
                failed = Some(err);
                false
            }
        });
        if let Some(err) = failed {
            return Err(err.into());
        }
        written?;
        Ok(BundleHeader {
            head: head.to_string(),
            branch,
        })
    }

    /// Whether the history holds `ancestor` at or before `commit`.
    pub fn holds(&self, commit: &str, ancestor: &str) -> bool {
        let (Ok(commit), Ok(ancestor)) = (Oid::from_str(commit), Oid::from_str(ancestor)) else {
            return false;
        };
        commit == ancestor
            || self
                .repo()
                .graph_descendant_of(commit, ancestor)
                .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(text: &str) -> Result<BundleHeader> {
        parse_header(&mut text.as_bytes())
    }

    const A: &str = "0123456789abcdef0123456789abcdef01234567";
    const B: &str = "89abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn reads_the_head_and_branch_a_bundle_names() {
        let found = header(&format!(
            "# v2 git bundle\n{A} refs/heads/main\n{A} HEAD\n\nPACK"
        ))
        .unwrap();
        assert_eq!(
            found,
            BundleHeader {
                head: A.into(),
                branch: "main".into()
            }
        );
        let found = header(&format!(
            "# v3 git bundle\n@object-format=sha1\n{B} refs/heads/notes\n\n"
        ))
        .unwrap();
        assert_eq!(
            found,
            BundleHeader {
                head: B.into(),
                branch: "notes".into()
            }
        );
    }

    #[test]
    fn refuses_what_is_not_a_whole_bundle() {
        for bad in [
            String::new(),
            "hello\n".to_owned(),
            format!("# v2 git bundle\n-{A} needs this\n{B} refs/heads/main\n\n"),
            format!("# v2 git bundle\n{A} refs/heads/main\n"),
            "# v2 git bundle\nnot-an-id refs/heads/main\n\n".to_owned(),
            format!("# v2 git bundle\n{A} refs/tags/v1\n\n"),
            format!("# v3 git bundle\n@object-format=sha256\n{A} refs/heads/main\n\n"),
            format!("# v2 git bundle\n{}", "x".repeat(10_000)),
        ] {
            assert!(header(&bad).is_err(), "{bad:?}");
        }
    }
}
