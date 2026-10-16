//! A vault with a project, "trip", that uses pictures, a PDF, tags and works, and
//! other things around it that a bundle must leave out.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::{Instant, ulid_at};

use crate::bibliography::support::{Fresh, fresh};

pub const FOLDER: &str = "trip";

pub fn id(n: u32) -> String {
    format!("01K5Z{n:0>21}")
}

pub const BIB: &str = "% my papers\n@string{nips = \"Advances in NIPS\"}\n\n@article{old2020thing,\n  title = {A thing},\n  booktitle = nips,\n  year = {2020}\n}\n\n@article{other2019,\n  title = {Another},\n  year = {2019}\n}\n\n@article{notcited2018,\n  title = {Left out},\n  year = {2018}\n}\n";

pub fn plan_page() -> String {
    format!(
        "---\nid: {}\ntitle: Plan\ntype: page\ntags: [atlas, journey]\n---\nSee [[Itinerary]] and [[Outside note]]. ![map](../../../assets/map.png) ![[chart.png]]\nGuide: [guide](../../../assets/guide.pdf)\nPaper: [[sources/paper.pdf]]\nCites [@old2020thing, p. 4] and [see @other2019].\nBy path: [[projects/trip/pages/itinerary|the days]]\n",
        id(2)
    )
}

pub fn itinerary_page() -> String {
    format!(
        "---\nid: {}\ntitle: Itinerary\ntype: page\nparent: {}\n---\nDay one, and [@missing2000].\n",
        id(3),
        id(2)
    )
}

pub fn project_page() -> String {
    format!(
        "---\nid: {}\ntitle: Trip\ntype: project\n---\nA trip.\n",
        id(1)
    )
}

pub fn board() -> String {
    "{\n  \"nodes\": [\n    {\"id\": \"n1\", \"type\": \"file\", \"file\": \"projects/trip/pages/plan.md\", \"x\": 0, \"y\": 0, \"width\": 300, \"height\": 200},\n    {\"id\": \"n2\", \"type\": \"file\", \"file\": \"assets/map.png\", \"x\": 400, \"y\": 0, \"width\": 300, \"height\": 200},\n    {\"id\": \"n3\", \"type\": \"file\", \"file\": \"library/outside-note.md\", \"x\": 800, \"y\": 0, \"width\": 300, \"height\": 200}\n  ],\n  \"edges\": []\n}\n".to_owned()
}

pub fn deck() -> String {
    "{\n  \"format\": \"kasten-deck\",\n  \"formatVersion\": 1,\n  \"slides\": [\n    {\n      \"elements\": [\n        {\"id\": \"c1\", \"keys\": [\"old2020thing\"], \"type\": \"citation\"},\n        {\"id\": \"i1\", \"src\": \"assets/map.png\", \"type\": \"image\"}\n      ],\n      \"id\": \"s1\",\n      \"layout\": \"title\"\n    }\n  ],\n  \"title\": \"Talk\"\n}\n".to_owned()
}

pub const CARD_MAP: &str = "{\n  \"id\": \"01K5ZK0000000000000000AS01\",\n  \"name\": \"map.png\",\n  \"tags\": [],\n  \"citationKey\": \"other2019\"\n}\n";
pub const CARD_PLAIN: &str =
    "{\n  \"id\": \"01K5ZK0000000000000000AS02\",\n  \"name\": \"x.png\",\n  \"tags\": []\n}\n";
pub const PDF: &[u8] = b"%PDF-1.4\n% a paper\n";
pub const HIGHLIGHTS: &str = "{\n  \"version\": 1,\n  \"highlights\": []\n}\n";
pub const TAG_ATLAS: &str = "name: atlas\ncolor: blue\nproperties: []\n";
pub const TAG_JOURNEY: &str = "name: journey\ncolor: green\nproperties: []\n";

/// A vault with the project and its surroundings, with everything in history.
pub fn trip() -> Fresh {
    let f = fresh();
    fill(&f);
    f.reindex();
    f.k.commit_external().unwrap();
    f
}

/// The files of the sample, in a vault that has none of them.
pub fn fill(f: &Fresh) {
    f.put("projects/trip/_project.md", &project_page());
    f.put("projects/trip/pages/plan.md", &plan_page());
    f.put("projects/trip/pages/itinerary.md", &itinerary_page());
    f.put(
        "projects/trip/pages/plan.comments.json",
        "{\"comments\": []}\n",
    );
    f.put("projects/trip/boards/map.canvas", &board());
    f.put("projects/trip/decks/talk.deck", &deck());
    f.put_bytes("assets/map.png", b"the map picture");
    f.put("assets/.meta/map.png.json", CARD_MAP);
    f.put_bytes("assets/chart.png", b"the chart picture");
    f.put("assets/.meta/chart.png.json", CARD_PLAIN);
    f.put_bytes("assets/guide.pdf", b"%PDF-1.4 a guide");
    f.put_bytes("assets/unused.png", b"nobody shows me");
    f.put("assets/.meta/unused.png.json", CARD_PLAIN);
    f.put_bytes("sources/paper.pdf", PDF);
    f.put("sources/paper.highlights.json", HIGHLIGHTS);
    f.put_bytes("sources/other.pdf", PDF);
    f.put("sources/other.highlights.json", HIGHLIGHTS);
    f.put("sources/references.bib", BIB);
    f.put("tags/atlas.yaml", TAG_ATLAS);
    f.put("tags/journey.yaml", TAG_JOURNEY);
    f.put("tags/unused.yaml", "name: unused\nproperties: []\n");
    f.put(
        "library/outside-note.md",
        &format!(
            "---\nid: {}\ntitle: Outside note\ntype: page\n---\nElsewhere.\n",
            id(9)
        ),
    );
    f.put(
        "chats/talk.md",
        "---\ntype: chat\ntitle: Talk\n---\nsecret\n",
    );
    f.put(
        "projects/other/_project.md",
        &format!("---\nid: {}\ntitle: Other\ntype: project\n---\n", id(10)),
    );
    f.put(
        "projects/other/pages/x.md",
        "---\ntitle: X\n---\nnot in the bundle\n",
    );
}

/// A folder under the system temp folder that is gone when this is dropped.
pub struct Dest {
    pub dir: PathBuf,
}

impl Dest {
    /// A path that does not exist yet.
    pub fn new() -> Dest {
        Dest {
            dir: std::env::temp_dir()
                .join(format!("kasten-bundle-{}", ulid_at(Instant::now().millis))),
        }
    }

    pub fn path(&self, rel: &str) -> PathBuf {
        self.dir.join(rel)
    }

    pub fn text(&self, rel: &str) -> String {
        fs::read_to_string(self.path(rel)).unwrap()
    }
}

impl Drop for Dest {
    fn drop(&mut self) {
        // Only the test's own export folder under the system temp folder.
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Every file of a folder by its path, git's and Kasten's own aside.
pub fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

/// The bundle of the sample project, exported from a fresh sample vault.
pub fn exported() -> (Fresh, Dest) {
    let f = trip();
    let dest = Dest::new();
    f.k.export_project(FOLDER, &dest.dir, crate::bibliography::support::NOW)
        .unwrap();
    (f, dest)
}
