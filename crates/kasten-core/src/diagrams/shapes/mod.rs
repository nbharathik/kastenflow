//! The editor's own shapes by name, so an agent asks for `aws4.lambda` and is
//! never made to write a style. The index is generated from the editor's
//! palette files by `scripts/gen-diagram-shapes.mjs` and kept in
//! `index.tsv`: one tab-separated line per shape (`key`, `title`, `w`, `h`,
//! the number of a style template, the part of the style that varies, and
//! search words), after the lines `@number<TAB>template` that define the
//! templates, where `~` stands for the varying part.

use std::sync::OnceLock;

const INDEX: &str = include_str!("index.tsv");

/// One shape of the editor's libraries.
#[derive(Debug, Clone, PartialEq)]
pub struct Shape {
    /// `library.name`, such as `aws4.lambda` or `flowchart.decision`.
    pub key: String,
    pub title: String,
    pub style: String,
    pub w: f64,
    pub h: f64,
    pub tags: String,
}

impl Shape {
    /// The library: the key's first part.
    pub fn library(&self) -> &str {
        self.key.split('.').next().unwrap_or("")
    }
}

/// Reads an index.
pub fn parse(index: &str) -> Vec<Shape> {
    let mut templates: Vec<(u32, String)> = Vec::new();
    let mut shapes = Vec::new();
    for line in index.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix('@') {
            if let Some((n, template)) = rest.split_once('\t')
                && let Ok(n) = n.parse()
            {
                templates.push((n, template.to_owned()));
            }
            continue;
        }
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 6 {
            continue;
        }
        let Ok(t) = f[4].parse::<u32>() else { continue };
        let Some((_, template)) = templates.iter().find(|(n, _)| *n == t) else {
            continue;
        };
        // An empty varying part is the key's own tail.
        let name = if f[5].is_empty() {
            f[0].split_once('.').map_or("", |(_, tail)| tail)
        } else {
            f[5]
        };
        shapes.push(Shape {
            key: f[0].to_owned(),
            title: f[1].to_owned(),
            style: template.replace('~', name),
            w: f[2].parse().unwrap_or(80.0),
            h: f[3].parse().unwrap_or(80.0),
            tags: f.get(6).copied().unwrap_or("").to_owned(),
        });
    }
    shapes
}

/// Every shape of the built-in index.
pub fn all() -> &'static [Shape] {
    static SHAPES: OnceLock<Vec<Shape>> = OnceLock::new();
    SHAPES.get_or_init(|| parse(INDEX))
}

/// The shape with this key (case does not matter).
pub fn lookup(key: &str) -> Option<&'static Shape> {
    let key = key.trim().to_lowercase();
    all().iter().find(|s| s.key.to_lowercase() == key)
}

/// The libraries and how many shapes each has.
pub fn libraries() -> Vec<(String, usize)> {
    let mut out: Vec<(String, usize)> = Vec::new();
    for s in all() {
        match out.iter_mut().find(|(l, _)| l == s.library()) {
            Some((_, n)) => *n += 1,
            None => out.push((s.library().to_owned(), 1)),
        }
    }
    out
}

/// The shapes that best match `query`, best first. `library` limits the
/// search to one library by its name.
pub fn find(query: &str, library: Option<&str>, limit: usize) -> Vec<&'static Shape> {
    let words: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    let library = library
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty());
    let mut scored: Vec<(u32, usize, &Shape)> = Vec::new();
    for (i, s) in all().iter().enumerate() {
        if let Some(l) = &library
            && s.library().to_lowercase() != *l
        {
            continue;
        }
        let key = s.key.to_lowercase();
        let title = s.title.to_lowercase();
        let tags = s.tags.to_lowercase();
        let mut score = 0;
        for w in &words {
            let part = key.rsplit('.').next().unwrap_or("");
            score += if key == *w || part == w {
                100
            } else if title == *w {
                80
            } else if part.starts_with(w.as_str()) || title.starts_with(w.as_str()) {
                40
            } else if key.contains(w.as_str()) || title.contains(w.as_str()) {
                20
            } else if tags.contains(w.as_str()) {
                5
            } else {
                // A word that matches nothing rules the shape out.
                score = 0;
                break;
            };
        }
        if score > 0 || words.is_empty() {
            scored.push((score, i, s));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    scored.into_iter().take(limit).map(|(_, _, s)| s).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# index\n@1\tsketch=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.~;\n@2\trhombus;whiteSpace=wrap;html=1;\naws4.lambda\tLambda\t78\t78\t1\t\tserverless function\naws4.ec2\tEC2\t78\t78\t1\tec2_alt\tcompute server\nflowchart.decision\tDecision\t120\t80\t2\t\tchoice branch\n";

    #[test]
    fn an_index_line_becomes_a_shape_with_its_style() {
        let shapes = parse(SAMPLE);
        assert_eq!(shapes.len(), 3);
        // An empty varying part is the key's own tail.
        assert_eq!(
            shapes[0].style,
            "sketch=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;"
        );
        assert_eq!(
            shapes[1].style,
            "sketch=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2_alt;"
        );
        assert_eq!((shapes[0].w, shapes[0].library()), (78.0, "aws4"));
        assert_eq!(shapes[2].style, "rhombus;whiteSpace=wrap;html=1;");
    }

    #[test]
    fn the_built_in_index_has_shapes_of_the_main_libraries_and_is_small() {
        assert!(INDEX.len() <= 250_000, "{} bytes", INDEX.len());
        let libs: Vec<String> = libraries().into_iter().map(|(l, _)| l).collect();
        for want in [
            "aws4",
            "azure2",
            "kubernetes",
            "flowchart",
            "networks",
            "er",
            "uml",
            "bpmn",
        ] {
            assert!(libs.iter().any(|l| l == want), "{want} in {libs:?}");
        }
        assert!(all().len() > 1500);
        let lambda = lookup("AWS4.Lambda").unwrap();
        assert!(
            lambda.style.contains("resIcon=mxgraph.aws4.lambda;")
                && lambda.style.contains("shape=mxgraph.aws4.resourceIcon")
        );
        assert_eq!((lambda.w, lambda.h), (78.0, 78.0));
        assert!(lookup("nope.nothing").is_none());
        // Every key is its own, and no style is left with the mark for the varying part.
        let mut keys: Vec<&str> = all().iter().map(|s| s.key.as_str()).collect();
        keys.sort_unstable();
        let before = keys.len();
        keys.dedup();
        assert_eq!(before, keys.len());
        assert!(all().iter().all(|s| !s.style.contains('~')
            && !s.style.contains("points=[")
            && !s.key.contains(' ')));
    }

    #[test]
    fn a_search_finds_the_shape_by_its_name_its_title_or_its_family() {
        assert_eq!(find("lambda", None, 3)[0].key, "aws4.lambda");
        assert_eq!(
            find("decision", Some("flowchart"), 1)[0].key,
            "flowchart.decision"
        );
        assert_eq!(find("pod", Some("kubernetes"), 1)[0].key, "kubernetes.pod");
        assert!(
            find("virtual machine", Some("azure2"), 30)
                .iter()
                .any(|s| s.key == "azure2.compute_virtual_machine")
        );
        assert!(find("zzzzqqq", None, 5).is_empty());
        // A word that matches nothing rules a shape out; a library narrows the search.
        assert!(find("lambda", Some("azure2"), 5).is_empty());
        assert_eq!(
            find("", Some("er"), 100).len(),
            libraries().iter().find(|(l, _)| l == "er").unwrap().1
        );
    }
}
