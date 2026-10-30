//! What the LaTeX changes that wait for review would make of a document's
//! files. A chat that asks first holds an agent's `latex_edit` as a proposal,
//! which never touches the file until the person accepts it, so a build of the
//! files on disk would compile the old text. The app builds the text below
//! instead, in a scratch folder of its own (never the files, never the last
//! good PDF), and the agent hears how many errors the proposed text has before
//! the person is asked. Reads only; nothing is written here.

use std::collections::BTreeMap;
use std::fs;

use super::Kasten;
use crate::agent::{AgentOp, ProposalStatus};
use crate::error::Result;
use crate::latex::{Diagnostic, LatexDoc, Plan, SOURCE_EXTENSIONS, engine_advice, plan};
use crate::note::content_hash;

impl Kasten {
    /// The files of the document in `folder` as the pending proposals of
    /// `session` would leave them: path relative to the folder, and the whole
    /// text. A proposal is read as accepting it now would (a change made to the
    /// file since is merged in; one that would conflict is left out), and when a
    /// file has several, the newest wins: a later edit of the same file is made
    /// on top of the earlier one.
    pub fn latex_proposed(&self, folder: &str, session: &str) -> Result<BTreeMap<String, String>> {
        let prefix = format!("{}/", folder.trim_end_matches('/'));
        let mut found = BTreeMap::new();
        for proposal in self.proposals()? {
            if proposal.session != session || proposal.status != ProposalStatus::Pending {
                continue;
            }
            let AgentOp::SaveSource {
                path, text, base, ..
            } = &proposal.op
            else {
                continue;
            };
            let Some(rel) = path.strip_prefix(&prefix) else {
                continue;
            };
            let Ok(full) = self.vault.file_of(path, &SOURCE_EXTENSIONS) else {
                continue;
            };
            let made = if base.is_empty() {
                Some(text.clone())
            } else {
                let Ok(current) = fs::read_to_string(&full) else {
                    continue;
                };
                match plan(&current, &content_hash(base), Some(base), text) {
                    Plan::Write(written) | Plan::Merged(written) => Some(written),
                    Plan::Unchanged | Plan::Conflict => None,
                }
            };
            if let Some(made) = made {
                found.insert(rel.to_owned(), made);
            }
        }
        Ok(found)
    }

    /// A line of advice on the engine for `doc`, given what its last build said
    /// (see `latex::engine_advice`); none when the engine is fine or the root
    /// file cannot be read.
    pub fn latex_engine_advice(
        &self,
        doc: &LatexDoc,
        diagnostics: &[Diagnostic],
    ) -> Option<&'static str> {
        let main = self
            .source(&doc.main_path)
            .map(|f| f.text)
            .unwrap_or_default();
        engine_advice(&doc.engine, &main, diagnostics)
    }
}
