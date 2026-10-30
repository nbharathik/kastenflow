//! How pages sit inside one another: which pages may hold which (and never
//! themselves), and in what order a page's sub-pages are shown. The ops that
//! write this are `Kasten::set_parent` and `Kasten::reorder_children`
//! (engine/structure.rs); this module is what they and the readers share, with
//! nothing in it that touches a file.

mod order;
mod parent;

pub use order::{CHILDREN_ORDER, arranged, order_text, ordered_ids};
pub use parent::check_nesting;
