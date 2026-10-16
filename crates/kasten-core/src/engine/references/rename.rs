//! Renaming a citation key everywhere it is written, as one commit: the entry's key
//! in the managed `.bib` file, the `[@key]` citations in pages, the citation key in
//! pictures' sidecars, and the citations of decks. A deck's new text is made by the
//! Slides engine (core never builds deck text) and comes with the request; core takes
//! it only if the deck is as it was planned and the new text is the old with the key
//! swapped and nothing else different.

use std::fs;

use super::super::bibliography::{changed_since, managed_text, person_only};
use super::super::{Change, Kasten};
use crate::bib::{MANAGED, edit, style};
use crate::cite::{
    self, CitingDeck, CitingPage, KeyRename, KeyRenamePlan, KeyRenamed, PlannedDeck, PlannedPage,
};
use crate::deck;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::{content_hash, meta_for};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::vault::Vault;

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The new text for each deck the plan lists with citations on its slides, after checking
/// that the request has exactly those, that each deck is as planned and that each new text
/// differs from the deck only in the key.
fn checked_decks(
    vault: &Vault,
    plan: &KeyRenamePlan,
    rename: &KeyRename,
) -> Result<Vec<(String, String)>> {
    let (from, to) = (plan.from.as_str(), plan.to.as_str());
    for given in &rename.decks {
        if !plan
            .decks
            .iter()
            .any(|d| d.deck.path == given.path && d.deck.count > 0)
        {
            return Err(refuse(format!(
                "{} does not cite “{from}” on its slides, so no new text for it was expected",
                given.path
            )));
        }
    }
    let mut texts = Vec::new();
    for planned in plan.decks.iter().filter(|d| d.deck.count > 0) {
        let path = &planned.deck.path;
        let Some(given) = rename.decks.iter().find(|d| &d.path == path) else {
            return Err(refuse(format!(
                "{path} cites “{from}” on its slides, and no new text for it came with the request"
            )));
        };
        let current = deck::read_deck(vault, path)?;
        if given.base_hash != planned.hash || current.hash != planned.hash {
            return Err(refuse(format!(
                "{path} changed since the rename was planned. Plan it again"
            )));
        }
        deck::head_of(&given.text)?;
        if !deck::cites::same_but_keys(&current.text, &given.text, from, to) {
            return Err(refuse(format!(
                "The new text for {path} changes more than the key “{from}”, so it was not written"
            )));
        }
        texts.push((path.clone(), given.text.clone()));
    }
    Ok(texts)
}

impl Kasten {
    /// What renaming `from` to `to` would change: the pages, decks and pictures that cite
    /// it, with the hashes the rename starts from. Writes nothing. Refused, with a sentence,
    /// when `from` is not in the managed file (an external file is read only), when `to`
    /// cannot be a key, or when `to` is a key already.
    pub fn plan_key_rename(&self, from: &str, to: &str) -> Result<KeyRenamePlan> {
        let to = style::check_key(to)?;
        if from == to {
            return Err(refuse("The new key is the same as the old one"));
        }
        let managed = managed_text(&self.vault)?;
        let bibliography = self.bibliography()?;
        if !bibliography.managed.entries.iter().any(|e| e.key == from) {
            let elsewhere = bibliography
                .external
                .iter()
                .find(|f| f.entries.iter().any(|e| e.key == from));
            return Err(refuse(match elsewhere {
                Some(file) => format!(
                    "“{from}” is in {}, which is read only. Make a managed copy of it first",
                    file.path
                ),
                None => format!("There is no reference with the key “{from}”"),
            }));
        }
        for file in std::iter::once(&bibliography.managed).chain(&bibliography.external) {
            if file.entries.iter().any(|e| e.key.eq_ignore_ascii_case(&to)) {
                return Err(refuse(format!(
                    "“{to}” is already a key in {}. Pick another",
                    file.path
                )));
            }
        }
        let pages = self
            .pages_citing(from)?
            .into_iter()
            .map(|(path, text)| PlannedPage {
                hash: content_hash(&text),
                page: CitingPage {
                    title: meta_for(&path, &text, 0).title,
                    count: cite::count_of(&text, from),
                    path,
                },
            })
            .collect();
        let decks = self
            .decks_citing(from)?
            .into_iter()
            .map(|(file, cited)| PlannedDeck {
                hash: file.hash.clone(),
                deck: CitingDeck {
                    title: deck::title_at(&self.vault, &file.path),
                    path: file.path,
                    count: cited.slides,
                    in_layouts: cited.layouts,
                },
            })
            .collect();
        let assets = self
            .assets_citing(from)
            .into_iter()
            .map(|(path, ..)| path)
            .collect();
        Ok(KeyRenamePlan {
            from: from.to_owned(),
            to,
            file: MANAGED.to_owned(),
            bib_hash: content_hash(&managed.text),
            pages,
            decks,
            assets,
        })
    }

    /// Renames the key in one commit: in the managed file, in the pages that cite it, in
    /// pictures' sidecars and in the decks whose new text came with the request. Everything
    /// is checked first and written or none of it is; undo takes it all back.
    pub fn rename_citation_key(
        &self,
        actor: &Actor,
        rename: &KeyRename,
        now: Instant,
    ) -> Result<KeyRenamed> {
        person_only(actor, "Renaming a citation key")?;
        let (from, to) = (rename.from.as_str(), rename.to.trim());
        let message = format!("reference: rename {from} to {to}");
        let (renamed, commit) = self.apply_committing(
            actor,
            "rename_citation_key",
            false,
            now.millis,
            &[],
            |vault| {
                // Planned again under the lock: what is there now decides.
                let plan = self.plan_key_rename(from, to)?;
                if plan.bib_hash != rename.bib_hash {
                    return Err(changed_since());
                }
                let decks = checked_decks(vault, &plan, rename)?;
                let managed = managed_text(vault)?;
                let new_bib = edit::rename_key(&managed.text, from, to)?;
                let mut done = Rollback::default();
                let written =
                    self.write_rename(vault, &plan, &new_bib, &managed.text, &decks, &mut done);
                let paths = match written {
                    Ok(paths) => paths,
                    Err(err) => {
                        done.put_back();
                        return Err(err);
                    }
                };
                Ok(Change {
                    value: KeyRenamed {
                        from: plan.from.clone(),
                        to: plan.to.clone(),
                        pages: plan.pages.len(),
                        decks: decks.len(),
                        assets: plan.assets.len(),
                        layouts: plan.decks.iter().map(|d| d.deck.in_layouts).sum(),
                        commit: None,
                    },
                    paths,
                    message,
                })
            },
        )?;
        Ok(KeyRenamed { commit, ..renamed })
    }

    /// The writes of a rename, each put in `done` so a failure puts them all back.
    /// Gives the paths written.
    fn write_rename(
        &self,
        vault: &Vault,
        plan: &KeyRenamePlan,
        new_bib: &str,
        old_bib: &str,
        decks: &[(String, String)],
        done: &mut Rollback,
    ) -> Result<Vec<String>> {
        let (from, to) = (plan.from.as_str(), plan.to.as_str());
        let mut paths = vec![MANAGED.to_owned()];
        done.write(
            &vault.file_of(MANAGED, &[".bib"])?,
            new_bib.as_bytes(),
            Some(old_bib.as_bytes().to_vec()),
        )?;
        for planned in &plan.pages {
            let path = &planned.page.path;
            let file = vault.path_of(path)?;
            let text = fs::read_to_string(&file)?;
            if content_hash(&text) != planned.hash {
                return Err(changed_since());
            }
            let (renamed, _) = cite::rename_in(&text, from, to);
            done.write(&file, renamed.as_bytes(), Some(text.into_bytes()))?;
            paths.push(path.clone());
        }
        for (_, sidecar, mut card) in self.assets_citing(from) {
            let file = vault.file_of(&sidecar, &[".json"])?;
            let before = fs::read(&file)?;
            card.set_citation_key(Some(to));
            done.write(&file, card.to_text().as_bytes(), Some(before))?;
            paths.push(sidecar);
        }
        for (path, text) in decks {
            let file = vault.file_of(path, &[".deck"])?;
            let before = fs::read(&file)?;
            done.write(&file, text.as_bytes(), Some(before))?;
            paths.push(path.clone());
        }
        Ok(paths)
    }
}
