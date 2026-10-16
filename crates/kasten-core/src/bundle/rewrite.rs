//! Rewriting the text of files that come in from a bundle, so that what refers to a
//! note, a folder, a file or a key keeps referring to it after the import settled a
//! name that was taken. Each function changes only the references it is given.

use crate::import::link_path;

/// Whether a character continues a name: a path `assets/fig.png` is not the start
/// of `assets/fig.png.bak`, and `projects/trip/` is not the end of `myprojects/trip/`.
fn continues(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '-' | '_')
}

/// `text` with `new` written for `old` wherever `old` is a whole path or path start:
/// not in the middle of a longer name before it, and (when `whole`) not followed by more
/// of a name.
fn replace_paths(text: &str, old: &str, new: &str, whole: bool) -> String {
    if old.is_empty() || old == new {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = text[from..].find(old) {
        let start = from + found;
        let end = start + old.len();
        from = end;
        let before = text[..start].chars().next_back();
        let after = text[end..].chars().next();
        let after_ok = !whole
            || match after {
                None => true,
                Some('.') => !text[end + 1..]
                    .chars()
                    .next()
                    .is_some_and(char::is_alphanumeric),
                Some(c) => !continues(c) && c != '%',
            };
        if before.is_some_and(|c| continues(c) || c == '.') || !after_ok {
            continue;
        }
        out.push_str(&text[copied..start]);
        out.push_str(new);
        copied = end;
    }
    out.push_str(&text[copied..]);
    out
}

/// `text` with every `old` id written as its `new` one.
pub fn ids(text: &str, pairs: &[(String, String)]) -> String {
    let mut out = text.to_owned();
    for (old, new) in pairs {
        if out.contains(old.as_str()) {
            out = out.replace(old.as_str(), new);
        }
    }
    out
}

/// `text` with the folder `projects/old/` written as `projects/new/`, in paths however
/// a link writes them (`../` before it, percent codes for spaces).
pub fn folder(text: &str, old: &str, new: &str) -> String {
    let (old, new) = (format!("projects/{old}/"), format!("projects/{new}/"));
    let plain = replace_paths(text, &old, &new, false);
    replace_paths(&plain, &link_path(&old), &link_path(&new), false)
}

/// `text` with the file `old` (a vault path) written as `new`: as a path, as a link
/// writes it with percent codes, and as a bare name in `[[name]]` and `![[name|size]]`.
pub fn file(text: &str, old: &str, new: &str) -> String {
    let path = replace_paths(text, old, new, true);
    let encoded = replace_paths(&path, &link_path(old), &link_path(new), true);
    let (old_name, new_name) = (
        old.rsplit('/').next().unwrap_or(old),
        new.rsplit('/').next().unwrap_or(new),
    );
    let mut out = String::with_capacity(encoded.len());
    let mut copied = 0;
    let mut from = 0;
    let open = format!("[[{old_name}");
    while let Some(found) = encoded[from..].find(&open) {
        let start = from + found;
        let end = start + open.len();
        from = end;
        if !matches!(encoded[end..].chars().next(), Some(']' | '|' | '#' | '\\')) {
            continue;
        }
        out.push_str(&encoded[copied..start]);
        out.push_str(&format!("[[{new_name}"));
        copied = end;
    }
    out.push_str(&encoded[copied..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_is_renamed_as_a_path_and_not_in_a_longer_name() {
        let text = "[[projects/trip/pages/plan|Plan]] ![](../../../projects/trip/x.png) myprojects/trip/y projects/trip-2/z \"projects/trip/a.md\" projects/Trip/b";
        assert_eq!(
            folder(text, "trip", "trip-3"),
            "[[projects/trip-3/pages/plan|Plan]] ![](../../../projects/trip-3/x.png) myprojects/trip/y projects/trip-2/z \"projects/trip-3/a.md\" projects/Trip/b"
        );
    }

    #[test]
    fn a_file_is_renamed_as_a_path_a_link_and_a_bare_embed() {
        let text = "![](../../assets/fig.png) \"assets/fig.png\" assets/fig.png.bak assets/fig.pngs ![[fig.png]] ![[fig.png|300]] [[fig.png#x]] [[fig.png.old]] myassets/fig.png";
        assert_eq!(
            file(text, "assets/fig.png", "assets/fig-2.png"),
            "![](../../assets/fig-2.png) \"assets/fig-2.png\" assets/fig.png.bak assets/fig.pngs ![[fig-2.png]] ![[fig-2.png|300]] [[fig-2.png#x]] [[fig.png.old]] myassets/fig.png"
        );
        assert_eq!(
            file(
                "![](../assets/my%20fig.png)",
                "assets/my fig.png",
                "assets/my fig-2.png"
            ),
            "![](../assets/my%20fig-2.png)"
        );
    }

    #[test]
    fn ids_are_replaced_wherever_they_stand() {
        let pairs = vec![("01AAAA".to_owned(), "01BBBB".to_owned())];
        assert_eq!(
            ids("id: 01AAAA\nparent: 01AAAA\n", &pairs),
            "id: 01BBBB\nparent: 01BBBB\n"
        );
        assert_eq!(ids("nothing", &pairs), "nothing");
    }
}
