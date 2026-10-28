//! The stand-in for the app, and a way to compare the vault's files.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use kasten_core::agent::AgentOp;
use kasten_core::bridge::{Call, Handler, Published, Server, Snippet, serve};
use kasten_core::latex::build_dir;
use kasten_core::{Instant, Kasten};
use serde_json::json;
use slides_core::agent::base64_encode;

use super::make;

/// Every file of the vault, but not git's own and not the cache.
pub fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel.starts_with(".kasten/cache") {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

/// The app: draws the diagram, builds cleanly, keeps the PDF, shares a selection.
/// `asked` collects the kind of each request it served, in order.
pub fn app(root: &Path, asked: &Arc<Mutex<Vec<String>>>, selected: Snippet) -> Server {
    let asked = Arc::clone(asked);
    let this = Arc::new(Kasten::open(root).unwrap());
    let mailbox = kasten_mcp::bridge::mailbox(root).unwrap();
    let writer = mailbox.clone();
    let root = root.to_path_buf();
    let handler: Handler = Arc::new(move |request, call| {
        asked.lock().unwrap().push(call.kind().to_owned());
        match call {
            Call::DiagramPng { diagram, page } => {
                let picture = this
                    .diagram_picture(&diagram, page.as_deref(), true)
                    .map_err(|e| e.to_string())?;
                if !picture.svg.contains("Web app") {
                    return Err("The picture is not the diagram's".to_owned());
                }
                Ok(json!({
                    "png_base64": base64_encode(&make::drawn_diagram()),
                    "bytes": make::drawn_diagram().len(),
                    "width": 48,
                    "height": 32,
                    "from": "draft",
                    "background": "#ffffff",
                    "warnings": [],
                }))
            }
            Call::LatexBuild { doc, .. } => {
                // The stand-in engine: a valid PDF, newer than every source.
                let pdf = root.join(build_dir(&doc)).join("out/main.pdf");
                fs::create_dir_all(pdf.parent().unwrap()).map_err(|e| e.to_string())?;
                fs::write(&pdf, make::pdf()).map_err(|e| e.to_string())?;
                fs::File::options()
                    .write(true)
                    .open(&pdf)
                    .and_then(|f| f.set_modified(SystemTime::now()))
                    .map_err(|e| e.to_string())?;
                Ok(json!({
                    "doc": doc, "built": true, "succeeded": true, "errors": 0, "warnings": 0,
                    "diagnostics": [], "pages": 2, "pdf_bytes": make::pdf().len(), "build_ms": 900,
                }))
            }
            Call::LatexExportPdf { doc, reason } => {
                let session = request.session.ok_or("no session")?;
                let op = AgentOp::ExportLatexPdf { doc, reason };
                let outcome = this
                    .agent_run(&session, &op, Instant::now())
                    .map_err(|e| e.to_string())?;
                let mut told = serde_json::to_value(outcome).map_err(|e| e.to_string())?;
                told["pages"] = json!(2);
                told["size_bytes"] = json!(make::pdf().len());
                Ok(told)
            }
            Call::WatchSelection {} => {
                let published =
                    Published::of(std::slice::from_ref(&selected), &[], Instant::now().millis);
                writer
                    .write_selection(&published)
                    .map_err(|e| e.to_string())?;
                Ok(json!({"shared": true}))
            }
        }
    });
    serve(mailbox, "1.2.2", handler).unwrap()
}
