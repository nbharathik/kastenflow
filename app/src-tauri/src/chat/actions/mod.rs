//! AI actions: the templates a person runs on a page or a PDF, such as
//! Explain or Outline. Each is Markdown whose frontmatter says what it needs
//! and what it does with its answer, and whose body is the instruction
//! (`parse`). Five ship with the app and the vault adds or replaces its own
//! in `templates/ai/` (`catalog`). Running one gathers what it asks for as
//! data within a size limit (`context`) and asks the model without tools
//! (`commands`).

pub mod catalog;
pub mod commands;
pub mod context;
pub mod parse;
