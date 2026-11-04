//! Which conversation of the CLI a thread goes on with. The CLI numbers its own
//! conversations; the thread keeps that number here (in the app's data folder,
//! next to the saved chats), so a thread that is left and opened again, or a
//! restarted app, resumes the same conversation. A thread whose agent changed
//! starts a new conversation with the new agent.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::Agent;

const FILE: &str = "agent-sessions.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    agent: Agent,
    session: String,
}

#[derive(Default)]
pub struct Sessions {
    file: Mutex<Option<PathBuf>>,
    map: Mutex<BTreeMap<String, Entry>>,
}

impl Sessions {
    fn map(&self) -> MutexGuard<'_, BTreeMap<String, Entry>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads the numbers kept in `dir`, and keeps them there from now on.
    pub fn open(&self, dir: &Path) {
        let file = dir.join(FILE);
        let read = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<BTreeMap<String, Entry>>(&bytes).ok())
            .unwrap_or_default();
        *self.map() = read;
        *self.file.lock().unwrap_or_else(|e| e.into_inner()) = Some(file);
    }

    /// The CLI's number for the thread, when it was made by `agent`.
    pub fn get(&self, chat: &str, agent: Agent) -> Option<String> {
        self.map()
            .get(chat)
            .filter(|e| e.agent == agent)
            .map(|e| e.session.clone())
    }

    /// Keeps the number for the thread.
    pub fn set(&self, chat: &str, agent: Agent, session: &str) {
        let entry = Entry {
            agent,
            session: session.to_owned(),
        };
        let json = {
            let mut map = self.map();
            if map.get(chat) == Some(&entry) {
                return;
            }
            map.insert(chat.to_owned(), entry);
            serde_json::to_vec_pretty(&*map)
        };
        let file = self.file.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let (Some(file), Ok(json)) = (file, json) {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let temp = file.with_extension("json.tmp");
            if std::fs::write(&temp, json).is_ok() {
                let _ = std::fs::rename(&temp, &file);
            }
        }
    }
}
