//! Agents citing a Reference in a LaTeX file. `\cite{key}` goes where the
//! editor's "Insert citation" would put it (at the end of the paragraph that
//! holds a piece of text, or at the end of the file), and the document's
//! `references.bib` gets the Reference's entry once, written afresh so that no
//! title can break out of it. The Reference itself, in the vault's References,
//! is only read. Both files change in one commit.

use std::fs;

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Target};
use crate::bib::{BibEntry, edit, style};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{self, Cited, LatexDoc, MAX_SOURCE_BYTES};
use crate::rollback::Rollback;
use crate::time::Instant;

/// The `.bib` file a document keeps its References in.
const LOCAL_BIB: &str = "references.bib";

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Where the Reference was found.
enum Found {
    /// In a `.bib` file of the document: nothing to add.
    InDocument(String),
    /// In the vault's managed file, which a document set to use the vault's
    /// bibliography is built with: nothing to add.
    InVault(String),
    /// In the vault's References: its entry is copied into the document.
    Reference(BibEntry),
}

/// The `.bib` file of the document that is written, as it is and as it will be.
struct BibChange {
    path: String,
    before: Option<String>,
    after: String,
}

/// Citing, worked out and checked, not yet written.
struct CitePlan {
    tex: String,
    tex_before: String,
    cited: Cited,
    key: String,
    bib: Option<BibChange>,
    root: String,
}

impl Kasten {
    /// The entry for `key` in one of the document's own `.bib` files.
    fn key_in_document(&self, doc: &LatexDoc, key: &str) -> Result<Option<String>> {
        for file in self.latex_files(doc)? {
            if !file.ends_with(".bib") {
                continue;
            }
            let Ok(text) = self.source_text(&format!("{}/{file}", doc.folder)) else {
                continue;
            };
            if let Some(entry) = slides_bib::read(&text)
                .into_iter()
                .find(|entry| entry.key.eq_ignore_ascii_case(key))
            {
                return Ok(Some(entry.key));
            }
        }
        Ok(None)
    }

    /// Where the Reference `key` is: the document's own files, then the vault's.
    fn find_reference(&self, doc: &LatexDoc, key: &str) -> Result<Found> {
        if let Some(own) = self.key_in_document(doc, key)? {
            return Ok(Found::InDocument(own));
        }
        let bibliography = self.bibliography()?;
        let files = std::iter::once(&bibliography.managed).chain(&bibliography.external);
        for file in files {
            let entry = file
                .entries
                .iter()
                .find(|entry| entry.key == key)
                .or_else(|| {
                    file.entries
                        .iter()
                        .find(|entry| entry.key.eq_ignore_ascii_case(key))
                });
            if let Some(entry) = entry {
                if file.managed && doc.bibliography == "vault" {
                    return Ok(Found::InVault(entry.key.clone()));
                }
                return Ok(Found::Reference(entry.clone()));
            }
        }
        Err(invalid(format!(
            "There is no reference with the key “{key}” in the References or in the document. list_references shows the keys"
        )))
    }

    /// The document's `references.bib` with the entry added.
    fn bib_with(&self, doc: &LatexDoc, entry: &BibEntry) -> Result<BibChange> {
        let path = format!("{}/{LOCAL_BIB}", doc.folder);
        let before = match self.source_text(&path) {
            Ok(text) => Some(text),
            Err(Error::NotFound(_)) => None,
            Err(other) => return Err(other),
        };
        let eol = before.as_deref().map_or("\n", style::eol_of);
        let text = latex::bib_entry(&entry.kind, &entry.key, &entry.fields, eol)?;
        let after = match &before {
            Some(held) => edit::append(held, &text),
            None => text,
        };
        if after.len() > MAX_SOURCE_BYTES {
            return Err(invalid(format!(
                "{LOCAL_BIB} would be over {} KB with this entry",
                MAX_SOURCE_BYTES / 1024
            )));
        }
        super::latex_source::visible(&path)?;
        self.check_spelling(&path)?;
        Ok(BibChange {
            path,
            before,
            after,
        })
    }

    fn cite_plan(&self, op: &AgentOp) -> Result<CitePlan> {
        let AgentOp::CiteReference {
            doc, file, key, at, ..
        } = op
        else {
            return Err(invalid(format!("{} is not a citation", op.name())));
        };
        let doc = self.doc_in_folder(doc)?;
        if !file.ends_with(".tex") || !file.starts_with(&format!("{}/", doc.folder)) {
            return Err(invalid(format!(
                "{file} is not a .tex file of the document {}: a citation goes into one of those",
                doc.title
            )));
        }
        self.check_spelling(file)?;
        // A key is written into `\cite{}`: one that could end it early is refused before it is looked up.
        style::check_key(key)?;
        let tex_before = self.source_text(file)?;
        let found = self.find_reference(&doc, key.trim())?;
        let (key, bib) = match found {
            Found::InDocument(key) | Found::InVault(key) => (key, None),
            Found::Reference(entry) => (entry.key.clone(), Some(self.bib_with(&doc, &entry)?)),
        };
        let cited = latex::cite_into(&tex_before, at.as_deref(), &key, name_of(file))?;
        Ok(CitePlan {
            tex: file.clone(),
            tex_before,
            cited,
            key,
            bib,
            root: doc.main_path,
        })
    }

    pub(super) fn latex_cite_refusals(&self, op: &AgentOp) -> Result<()> {
        self.cite_plan(op).map(|_| ())
    }

    pub(super) fn latex_cite_preview(&self, op: &AgentOp) -> Result<Preview> {
        let plan = self.cite_plan(op)?;
        let mut diff = format!(
            "Cite “{}” in {}\n\n{}",
            plan.key,
            name_of(&plan.tex),
            unified(&plan.tex, &plan.tex_before, &plan.cited.text, 3)
        );
        if let Some(bib) = &plan.bib {
            diff.push_str(&format!(
                "\n\nAdd the entry to {}\n\n{}",
                name_of(&bib.path),
                unified(
                    &bib.path,
                    bib.before.as_deref().unwrap_or(""),
                    &bib.after,
                    3
                )
            ));
        }
        Ok(Preview {
            diff,
            target: Some(Target {
                path: plan.tex.clone(),
                title: name_of(&plan.tex).to_owned(),
            }),
            before: Some(plan.tex_before),
            after: Some(plan.cited.text),
        })
    }

    /// Cites, and keeps the Reference's entry in the document's bibliography.
    pub(super) fn latex_cite_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let plan = self.cite_plan(op)?;
        let tex_file = self.vault.file_of(&plan.tex, &[".tex"])?;
        let bib_file = plan
            .bib
            .as_ref()
            .map(|bib| self.vault.file_of(&bib.path, &[".bib"]))
            .transpose()?;
        self.apply(actor, "cite_reference", false, now.millis, |_| {
            // The files are as they were when the citation was worked out, or it is redone.
            let moved = || invalid("A file changed while it was being cited. Try again");
            if fs::read_to_string(&tex_file).ok().as_deref() != Some(plan.tex_before.as_str()) {
                return Err(moved());
            }
            if let (Some(bib), Some(file)) = (&plan.bib, &bib_file) {
                let held = fs::read_to_string(file).ok();
                if held != bib.before {
                    return Err(moved());
                }
            }
            let mut done = Rollback::default();
            let mut paths = vec![plan.tex.clone()];
            let written = (|| -> std::io::Result<()> {
                done.write(
                    &tex_file,
                    plan.cited.text.as_bytes(),
                    Some(plan.tex_before.clone().into_bytes()),
                )?;
                if let (Some(bib), Some(file)) = (&plan.bib, &bib_file) {
                    done.write(
                        file,
                        bib.after.as_bytes(),
                        bib.before.clone().map(String::into_bytes),
                    )?;
                    paths.push(bib.path.clone());
                }
                Ok(())
            })();
            if let Err(err) = written {
                done.put_back();
                return Err(err.into());
            }
            Ok(Change {
                message: format!("cite: {} in {}", plan.key, name_of(&plan.tex)),
                paths,
                value: (),
            })
        })?;
        let mut out = json!({
            "status": "cited",
            "path": plan.tex,
            "key": plan.key,
            "cite": plan.cited.added,
            "bib": match &plan.bib {
                Some(bib) => json!({ "path": bib.path, "added": true }),
                None => json!({ "added": false }),
            },
        });
        let loads = self
            .source_text(&plan.root)
            .map(|root| loads_bibliography(&root))
            .unwrap_or(true);
        if !loads {
            out["note"] = json!(
                "The document does not load a bibliography yet, so the citation shows as unknown until it does. Add \\bibliographystyle{plain} and \\bibliography{references} before \\end{document} (or \\addbibresource{references.bib} in the preamble) with latex_append"
            );
        }
        Ok(out)
    }
}

/// Whether a root file names a bibliography in a line that is not a comment.
fn loads_bibliography(root: &str) -> bool {
    root.lines().any(|line| {
        let code = line.split('%').next().unwrap_or("");
        code.contains("\\bibliography{")
            || code.contains("\\addbibresource")
            || code.contains("\\printbibliography")
            || code.contains("thebibliography")
    })
}
