//! What requests have found out about each model on the ChatGPT plan's
//! route. Nothing documents what the route takes, so a request is sent with
//! everything the first time; when the route names a part it will not take
//! (the reasoning effort, the encrypted reasoning that goes back with the
//! next request, tools listed one by one), the request is sent again without
//! it, and that model is asked without it from then on. What was found is
//! about one model and one part, never about the account or the route as a
//! whole, and it is kept in the app's cache folder (not the vault), for the
//! account it was found for, so the same refusal is not met again at every
//! start. A refusal is believed for two weeks and then asked again, since
//! the route changes.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::oauth;
use crate::chat::cache;
use crate::chat::responses::Shape;

const FILE: &str = "chatgpt-learned.json";
/// How long a refusal is believed, in seconds.
const BELIEVED: u64 = 14 * 24 * 3600;

/// What a request found out about a part of a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tried {
    /// The route took it.
    Works,
    /// The route turned it down; requests go without.
    Refused,
}

/// A part of a request the route may turn down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    /// The reasoning effort the person asked for.
    Effort,
    /// The encrypted reasoning that is asked for and goes back.
    Include,
    /// The tools listed one by one; turned down, they go in one namespace.
    Flat,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct Fact {
    tried: Tried,
    /// Seconds since 1970.
    at: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct File {
    version: u32,
    owner: String,
    models: BTreeMap<String, BTreeMap<Feature, Fact>>,
}

#[derive(Default)]
struct Inner {
    owner: Option<String>,
    dir: Option<PathBuf>,
    models: BTreeMap<String, BTreeMap<Feature, Fact>>,
}

/// The facts, by model.
#[derive(Default)]
pub struct Learned {
    inner: Mutex<Inner>,
}

impl Learned {
    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn folder(inner: &Inner) -> Option<PathBuf> {
        inner.dir.clone().or_else(cache::folder)
    }

    /// Keeps the facts in `dir` instead of the app's cache folder.
    #[cfg(test)]
    pub fn keep_in(&self, dir: PathBuf) {
        self.inner().dir = Some(dir);
    }

    /// The account the facts are about (a short hash of its id). Facts that
    /// were kept for another account are not believed.
    pub fn for_owner(&self, owner: Option<String>) {
        let mut inner = self.inner();
        if inner.owner == owner {
            return;
        }
        inner.models.clear();
        inner.owner.clone_from(&owner);
        if let (Some(owner), Some(dir)) = (owner, Self::folder(&inner)) {
            let kept =
                cache::read::<File>(&dir, FILE).filter(|f| f.version == 1 && f.owner == owner);
            inner.models = kept.map(|f| f.models).unwrap_or_default();
        }
    }

    fn found_at(&self, model: &str, feature: Feature, now: u64) -> Option<Tried> {
        let inner = self.inner();
        let fact = inner.models.get(model)?.get(&feature)?;
        // Only a refusal goes stale: what works keeps working until it does not.
        (fact.tried == Tried::Works || now.saturating_sub(fact.at) < BELIEVED).then_some(fact.tried)
    }

    pub fn refused(&self, model: &str, feature: Feature) -> bool {
        self.found_at(model, feature, oauth::now()) == Some(Tried::Refused)
    }

    pub fn works(&self, model: &str, feature: Feature) -> bool {
        self.found_at(model, feature, oauth::now()) == Some(Tried::Works)
    }

    /// Remembers what a request found out, in memory and in the file.
    pub fn tried(&self, model: &str, feature: Feature, found: Tried) {
        self.record(model, feature, found, oauth::now());
    }

    pub(crate) fn record(&self, model: &str, feature: Feature, found: Tried, at: u64) {
        let mut inner = self.inner();
        inner
            .models
            .entry(model.to_owned())
            .or_default()
            .insert(feature, Fact { tried: found, at });
        let (Some(owner), Some(dir)) = (inner.owner.clone(), Self::folder(&inner)) else {
            return;
        };
        let file = File {
            version: 1,
            owner,
            models: inner.models.clone(),
        };
        // Facts that cannot be kept are only asked again at the next start.
        let _ = cache::write(&dir, FILE, &file);
    }

    /// The request shape to start with for `model`: everything, less what
    /// the route has been found to turn down for that model.
    pub fn shape_for(&self, model: &str) -> Shape {
        Shape {
            effort: !self.refused(model, Feature::Effort),
            reasoning: !self.refused(model, Feature::Include),
            namespaced: self.refused(model, Feature::Flat),
        }
    }
}

#[cfg(test)]
#[path = "efforts_tests.rs"]
mod tests;
