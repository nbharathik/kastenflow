//! A batch in words, and how the classes of its changes come to one: the
//! worst of them decides what the whole batch does.

use std::collections::BTreeMap;

use crate::agent::AgentOp;
use crate::policy::OpClass;

/// The class that holds for a batch: the one of its changes that asks for the
/// most care (an always-review change over a soft limit over an ordinary one),
/// with that change's reason.
pub fn worst(classes: impl IntoIterator<Item = OpClass>) -> OpClass {
    let mut worst = OpClass::Ordinary;
    for class in classes {
        let weight = |c: &OpClass| match c {
            OpClass::Ordinary => 0,
            OpClass::Soft(_) => 1,
            OpClass::Always(_) => 2,
            OpClass::Hard(_) => 3,
        };
        if weight(&class) > weight(&worst) {
            worst = class;
        }
    }
    worst
}

/// What the changes are, counted by kind: "3 new notes, 2 additions".
pub fn describe(ops: &[AgentOp]) -> String {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for op in ops {
        let kind = match op.name() {
            "capture" => "create_note",
            "journal_append" => "append",
            other => other,
        };
        *counts.entry(kind).or_default() += 1;
    }
    let words = |name: &str, n: usize| -> String {
        let (one, many) = match name {
            "create_note" | "capture" => ("new note", "new notes"),
            "append" | "journal_append" => ("addition", "additions"),
            "replace_section" => ("section replaced", "sections replaced"),
            "edit_page" => ("page edit", "page edits"),
            "update_props" => ("property change", "property changes"),
            "tags" => ("tag change", "tag changes"),
            "rename_note" => ("rename", "renames"),
            "move_note" => ("move", "moves"),
            "set_parent" => (
                "page put in or out of another",
                "pages put in or out of another",
            ),
            "reorder_children" => ("sub-page order", "sub-page orders"),
            "set_tag_views" => ("view change", "view changes"),
            "set_view_order" => ("row order", "row orders"),
            "update_tag_schema" => ("tag schema", "tag schemas"),
            _ => ("board change", "board changes"),
        };
        format!("{n} {}", if n == 1 { one } else { many })
    };
    let mut parts: Vec<String> = Vec::new();
    let mut boards = 0;
    for (name, n) in counts {
        match name {
            "create_board" | "add_to_board" | "connect" | "group_on_board" => boards += n,
            other => parts.push(words(other, n)),
        }
    }
    if boards > 0 {
        parts.push(words("board", boards));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_worst_change_decides() {
        assert_eq!(worst([]), OpClass::Ordinary);
        let soft = OpClass::Soft("many".into());
        let always = OpClass::Always("rewrite".into());
        assert_eq!(
            worst([OpClass::Ordinary, soft.clone()]),
            soft,
            "a soft limit beats ordinary"
        );
        assert_eq!(worst([soft, always.clone(), OpClass::Ordinary]), always);
    }

    #[test]
    fn changes_are_counted_in_plain_words() {
        let create = |t: &str| AgentOp::CreateNote {
            note_type: "card".into(),
            title: t.into(),
            body: String::new(),
            project: None,
            tags: vec![],
            props: Default::default(),
            parent: None,
            template: None,
        };
        let ops = [
            create("A"),
            create("B"),
            AgentOp::Rename {
                path: "a.md".into(),
                title: "C".into(),
            },
        ];
        assert_eq!(describe(&ops), "2 new notes, 1 rename");
    }
}
