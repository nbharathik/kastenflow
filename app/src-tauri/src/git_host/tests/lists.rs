//! The repository list: paging, search, and KastenFlow's backups first.

use serde_json::{Value, json};

use super::mock::{Mock, Resp, client, run};
use super::repo;
use crate::backup::contract::{RepoPage, Visibility};
use crate::git_host::endpoints::Endpoints;
use crate::git_host::repos::{PER_PAGE, all, list};

fn backup(owner: &str, name: &str) -> Value {
    let mut value = repo(owner, name, true);
    value["topics"] = json!(["kastenflow-vault"]);
    value
}

fn names(page: &RepoPage) -> Vec<&str> {
    page.repos.iter().map(|r| r.name.as_str()).collect()
}

#[test]
fn backups_come_first_and_the_order_of_the_rest_is_kept() {
    let mock = Mock::start(|req| match req.route() {
        "/user/repos" => {
            let mut described = repo("ada", "described", true);
            described["description"] = json!("KastenFlow vault backup");
            Resp::json(
                200,
                json!([
                    repo("ada", "newest", true),
                    backup("ada", "topic-backup"),
                    repo("ada", "older", true),
                    described,
                ]),
            )
        }
        _ => Resp::empty(404),
    });
    let ep = Endpoints::at(&mock.base());
    let page = run(list(&client(), &ep, "tok", "ada", "", 1)).unwrap();
    assert_eq!(
        names(&page),
        ["topic-backup", "described", "newest", "older"]
    );
    assert!(page.repos[0].is_backup && page.repos[1].is_backup && !page.repos[2].is_backup);
    assert!(
        page.repos
            .iter()
            .all(|r| r.visibility == Visibility::Private)
    );
    assert!(!page.has_more);
    let asked = &mock.seen()[0].path;
    assert!(
        asked.contains("visibility=private") && asked.contains("page=1"),
        "{asked}"
    );
}

#[test]
fn paging_follows_the_link_header_and_page_zero_means_one() {
    let mock = Mock::start(|req| {
        let page: u32 = req
            .path
            .rsplit("page=")
            .next()
            .and_then(|p| p.split('&').next())
            .and_then(|p| p.parse().ok())
            .unwrap_or(0);
        let rows: Vec<Value> = (0..PER_PAGE)
            .map(|n| repo("ada", &format!("r{page}-{n}"), true))
            .collect();
        let resp = Resp::json(200, Value::Array(rows));
        if page < 3 {
            resp.header("Link", "<https://api.github.com/x?page=2>; rel=\"next\"")
        } else {
            resp
        }
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    let first = run(list(&http, &ep, "tok", "ada", "", 0)).unwrap();
    assert!(first.has_more && first.repos[0].name == "r1-0");
    let last = run(list(&http, &ep, "tok", "ada", "", 3)).unwrap();
    assert!(!last.has_more && last.repos[0].name == "r3-0");
    let everything = run(all(&http, &ep, "tok", "ada")).unwrap();
    assert_eq!(everything.len(), 3 * PER_PAGE);
}

#[test]
fn a_search_asks_githubs_search_inside_the_account_and_drops_public_ones() {
    let mock = Mock::start(|req| match req.route() {
        "/search/repositories" => Resp::json(
            200,
            json!({
                "total_count": 45,
                "items": [
                    repo("ada", "my-notes", true),
                    repo("ada", "notes-public", false),
                    backup("ada", "notes-backup"),
                ],
            }),
        ),
        _ => Resp::empty(404),
    });
    let ep = Endpoints::at(&mock.base());
    let page = run(list(&client(), &ep, "tok", "ada", "  notes ", 1)).unwrap();
    assert_eq!(names(&page), ["notes-backup", "my-notes"]);
    // 45 results, 30 to a page: more to come.
    assert!(page.has_more);
    let asked = &mock.seen()[0].path;
    assert!(
        asked.contains("q=notes%20in%3Aname%20user%3Aada"),
        "{asked}"
    );
    let second = run(list(&client(), &ep, "tok", "ada", "notes", 2)).unwrap();
    assert!(!second.has_more);
}

#[test]
fn a_repository_that_is_not_on_github_is_left_out() {
    let mock = Mock::start(|_| {
        let mut elsewhere = repo("ada", "x", true);
        elsewhere["clone_url"] = json!("https://evil.example/ada/x.git");
        Resp::json(200, json!([elsewhere, repo("ada", "ok", true)]))
    });
    let ep = Endpoints::at(&mock.base());
    let page = run(list(&client(), &ep, "tok", "ada", "", 1)).unwrap();
    assert_eq!(names(&page), ["ok"]);
}
