//! How many nodes a batch of board changes takes off, for the guardrail on
//! agents (`max_board_nodes_removed`).

use std::collections::HashSet;

use super::BoardChange;

/// The nodes `changes` take off the board, each counted once however many
/// times it is named. Ids that are not on the board are counted too: the
/// batch asks for them, and counting only what is there would make the limit
/// depend on the board's state at the moment.
pub fn removed_by(changes: &[BoardChange]) -> usize {
    changes
        .iter()
        .filter_map(|change| match change {
            BoardChange::Remove { ids } => Some(ids),
            _ => None,
        })
        .flatten()
        .collect::<HashSet<_>>()
        .len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_each_id_once_across_the_batch() {
        let remove = |ids: &[&str]| BoardChange::Remove {
            ids: ids.iter().map(|s| (*s).to_owned()).collect(),
        };
        let changes = [
            remove(&["a", "b"]),
            BoardChange::Sticky {
                text: "x".into(),
                x: 0,
                y: 0,
            },
            remove(&["b", "c"]),
        ];
        assert_eq!(removed_by(&changes), 3);
        assert_eq!(removed_by(&changes[1..2]), 0);
        assert_eq!(removed_by(&[]), 0);
    }
}
