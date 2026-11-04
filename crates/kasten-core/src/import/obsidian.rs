//! An Obsidian vault, or any folder of Markdown, as a Kasten project:
//!
//! - notes become pages, their folders a page tree: a folder's own note
//!   (`Travel/Travel.md`, or `Travel.md` beside the folder) is its page,
//!   else a page listing what is in it is made;
//! - daily notes become journal days, added to days already here;
//! - titles come from `title:` or the file name, made unique in the import;
//! - links follow what they point at, inline `#tags` join the note's tags;
//! - attachments go to `assets/<project>/`, PDFs to `sources/`, canvases
//!   to the project's boards.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;

use super::canvas;
use super::days::DailyNotes;
use super::files::{pdf_plan, project_page};
use super::front::{Keys, own_id, own_title, with_keys};
use super::markdown::{inline_tags, without_title};
use super::plan::{
    Context, Copied, Day, MAX_FILE_BYTES, Names, Plan, Warn, Warnings, Written, clean_title,
    slug_path, stamp, unique_titles,
};
use super::resolve::{Resolver, rewrite_body};
use super::walk::SourceFile;
use crate::error::Result;
use crate::frontmatter::split;
use crate::id::ulid_at;
use crate::journal_path::day_file;

/// A page to make: from a note, or for a folder without a note of its own.
struct Page<'a> {
    file: Option<(&'a SourceFile, String)>,
    /// The source folder it goes in.
    folder: String,
    /// The folder it stands for, as that folder's page.
    folder_of: Option<String>,
    title: String,
    path: String,
    id: String,
}

fn parent_folder(folder: &str) -> &str {
    folder.rsplit_once('/').map_or("", |(dir, _)| dir)
}

fn last_part(folder: &str) -> &str {
    folder.rsplit('/').next().unwrap_or(folder)
}

pub(crate) fn plan(ctx: &Context, files: &[SourceFile]) -> Result<Plan> {
    let mut warnings = Warnings::default();
    let mut names = Names::default();
    let mut resolver = Resolver::default();
    // Source paths (lowercase) to vault paths, for board cards.
    let mut moved: HashMap<String, String> = HashMap::new();
    let daily = DailyNotes::read(ctx.root);
    let project = ctx.folder();
    let (mut notes, mut days, mut canvases, mut copies, mut pdfs) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for f in files {
        if f.size > MAX_FILE_BYTES {
            warnings.add(Warn::TooBig, &f.rel);
            continue;
        }
        match f.ext().as_str() {
            "md" | "markdown" => match fs::read_to_string(&f.abs) {
                Ok(text) => match daily.date_of(&f.rel) {
                    Some(date) => days.push((f, date, text)),
                    None => notes.push((f, text)),
                },
                Err(_) => warnings.add(Warn::NotText, &f.rel),
            },
            "canvas" => canvases.push(f),
            "pdf" => {
                let pdf = pdf_plan(ctx, &mut names, f)?;
                resolver.add_file(&f.rel, &pdf.path);
                moved.insert(f.rel.to_lowercase(), pdf.path.clone());
                pdfs.push(pdf);
            }
            ext => {
                let dot = if ext.is_empty() {
                    String::new()
                } else {
                    format!(".{ext}")
                };
                let path = names.free(ctx.vault, &format!("assets/{}", ctx.slug), f.stem(), &dot);
                resolver.add_file(&f.rel, &path);
                moved.insert(f.rel.to_lowercase(), path.clone());
                copies.push(Copied {
                    path,
                    from: f.abs.clone(),
                });
            }
        }
    }

    let mut pages = page_tree(notes);
    let wanted: Vec<(String, String)> = pages
        .iter()
        .map(|p| {
            let own = p
                .file
                .as_ref()
                .and_then(|(_, text)| own_title(split(text).prefix));
            let title = match (&own, &p.file) {
                (Some(title), _) => clean_title(title),
                (None, Some((f, _))) => clean_title(f.stem()),
                (None, None) => clean_title(last_part(p.folder_of.as_deref().unwrap_or(""))),
            };
            let label = p
                .folder_of
                .as_deref()
                .map_or(p.folder.as_str(), parent_folder);
            (title, last_part(label).to_owned())
        })
        .collect();
    let titles = unique_titles(&wanted);
    let mut ids: HashSet<String> = HashSet::new();
    for (page, title) in pages.iter_mut().zip(titles) {
        let dir = format!("{project}/pages/{}", slug_path(&page.folder));
        page.path = names.free(ctx.vault, dir.trim_end_matches('/'), &title, ".md");
        let own = page
            .file
            .as_ref()
            .and_then(|(_, text)| own_id(split(text).prefix));
        page.id = match own {
            Some(id) if !(ctx.id_taken)(&id) && !ids.contains(&id) => id,
            _ => ulid_at(ctx.now.millis),
        };
        ids.insert(page.id.clone());
        if let Some((f, _)) = &page.file {
            resolver.add_note(&f.rel, &title);
            moved.insert(f.rel.to_lowercase(), page.path.clone());
        }
        page.title = title;
    }
    for (f, date, _) in &days {
        resolver.add_note(&f.rel, date);
        moved.insert(f.rel.to_lowercase(), day_file(None, date));
    }
    let boards: Vec<(&SourceFile, String)> = canvases
        .into_iter()
        .map(|f| {
            let path = names.free(ctx.vault, &format!("{project}/boards"), f.stem(), ".canvas");
            moved.insert(f.rel.to_lowercase(), path.clone());
            (f, path)
        })
        .collect();

    let page_of: HashMap<&str, &Page> = pages
        .iter()
        .filter_map(|p| p.folder_of.as_deref().map(|f| (f, p)))
        .collect();
    let parent_of = |p: &Page| {
        let folder = p
            .folder_of
            .as_deref()
            .map_or(p.folder.as_str(), parent_folder);
        page_of.get(folder).map(|parent| parent.id.clone())
    };
    let mut written: Vec<Written> = Vec::new();
    for page in &pages {
        let parent = parent_of(page);
        let now = ctx.now.rfc3339();
        let text = match &page.file {
            Some((f, text)) => {
                let wanted = own_title(split(text).prefix).unwrap_or_else(|| f.stem().to_owned());
                let body = without_title(split(text).body, &wanted);
                let body = without_title(&body, f.stem());
                let body = rewrite_body(&body, &page.path, f.folder(), &resolver);
                let tags = inline_tags(&body);
                let time = stamp(f.modified, ctx.now);
                let keys = Keys {
                    id: &page.id,
                    title: &page.title,
                    kind: "page",
                    created: &time,
                    updated: &time,
                    tags: &tags,
                    parent: parent.as_deref(),
                    props: None,
                };
                with_keys(text, &body, &keys, &f.rel, &mut warnings)
            }
            None => {
                let folder = page.folder_of.as_deref().unwrap_or_default();
                let mut children: Vec<&str> = pages
                    .iter()
                    .filter(|p| {
                        !std::ptr::eq(*p, page) && parent_of(p).as_deref() == Some(page.id.as_str())
                    })
                    .map(|p| p.title.as_str())
                    .collect();
                children.sort_by_key(|t| t.to_lowercase());
                let body: String = children.iter().map(|t| format!("- [[{t}]]\n")).collect();
                let keys = Keys {
                    id: &page.id,
                    title: &page.title,
                    kind: "page",
                    created: &now,
                    updated: &now,
                    tags: &[],
                    parent: parent.as_deref(),
                    props: None,
                };
                with_keys("", &body, &keys, folder, &mut warnings)
            }
        };
        written.push(Written {
            path: page.path.clone(),
            text,
        });
    }

    let journal = journal_days(ctx, &days, &resolver, &mut warnings);
    let mut boards_written = Vec::new();
    for (f, path) in &boards {
        let Ok(text) = fs::read_to_string(&f.abs) else {
            warnings.add(Warn::BadBoard, &f.rel);
            continue;
        };
        match canvas::board(&text, path, f.stem(), &moved, &resolver, &mut warnings) {
            Some(text) => boards_written.push(Written {
                path: path.clone(),
                text,
            }),
            None => warnings.add(Warn::BadBoard, &f.rel),
        }
    }
    // The project's page comes first; it counts what else there is.
    written.insert(
        0,
        Written {
            path: String::new(),
            text: String::new(),
        },
    );
    let mut plan = Plan {
        kind: ctx.kind,
        project: ctx.project.clone(),
        folder: project,
        notes: written,
        days: journal,
        boards: boards_written,
        tags: Vec::new(),
        copies,
        pdfs,
        warnings,
    };
    plan.notes[0] = project_page(ctx, &plan.counts());
    Ok(plan)
}

/// Notes as pages, with a page for each folder: its own note or a new one.
fn page_tree(notes: Vec<(&SourceFile, String)>) -> Vec<Page<'_>> {
    let mut folders: BTreeSet<String> = BTreeSet::new();
    for (f, _) in &notes {
        let mut folder = f.folder();
        while !folder.is_empty() {
            folders.insert(folder.to_owned());
            folder = parent_folder(folder);
        }
    }
    let mut pages: Vec<Page> = notes
        .into_iter()
        .map(|(f, text)| Page {
            folder: f.folder().to_owned(),
            file: Some((f, text)),
            folder_of: None,
            title: String::new(),
            path: String::new(),
            id: String::new(),
        })
        .collect();
    for folder in folders {
        let name = last_part(&folder).to_lowercase();
        let own = |p: &Page, dir: &str| {
            p.folder_of.is_none()
                && p.folder == dir
                && p.file
                    .as_ref()
                    .is_some_and(|(f, _)| f.stem().to_lowercase() == name)
        };
        let found = pages
            .iter()
            .position(|p| own(p, &folder))
            .or_else(|| pages.iter().position(|p| own(p, parent_folder(&folder))));
        match found {
            Some(i) => pages[i].folder_of = Some(folder),
            None => pages.push(Page {
                file: None,
                folder: folder.clone(),
                folder_of: Some(folder),
                title: String::new(),
                path: String::new(),
                id: String::new(),
            }),
        }
    }
    pages
}

/// Daily notes as journal days, one per date.
fn journal_days(
    ctx: &Context,
    days: &[(&SourceFile, String, String)],
    resolver: &Resolver,
    warnings: &mut Warnings,
) -> Vec<Day> {
    let mut out: Vec<Day> = Vec::new();
    for (f, date, text) in days {
        let path = day_file(None, date);
        let body = without_title(split(text).body, f.stem());
        let body = rewrite_body(&body, &path, f.folder(), resolver);
        let tags = inline_tags(&body);
        if let Some(day) = out.iter_mut().find(|d| &d.date == date) {
            day.text = format!("{}\n{body}", day.text.trim_end_matches('\n'));
            day.tags.extend(tags);
            continue;
        }
        let exists = ctx.vault.exists(&path);
        let text = if exists {
            body
        } else {
            let time = stamp(f.modified, ctx.now);
            let id = ulid_at(ctx.now.millis);
            let keys = Keys {
                id: &id,
                title: date,
                kind: "journal",
                created: &time,
                updated: &time,
                tags: &tags,
                parent: None,
                props: None,
            };
            with_keys(text, &body, &keys, &f.rel, warnings)
        };
        out.push(Day {
            date: date.clone(),
            text,
            tags,
            exists,
        });
    }
    out
}
