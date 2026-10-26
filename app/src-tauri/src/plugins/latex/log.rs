//! The reader of what TeX, Tectonic and latexmk print lives in kasten-core
//! (`kasten_core::latex`), where the MCP server's `latex_build` reads the last
//! build's log too. It is re-exported here so the build code and its tests
//! keep their names.

pub use kasten_core::latex::{Diagnostic, Severity, parse_log, parse_log_bytes};
