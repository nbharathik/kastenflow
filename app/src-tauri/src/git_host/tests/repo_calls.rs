//! Making a backup repository, looking at one, making one private, and the
//! lock on its branch, against the mock.

use serde_json::json;

use super::mock::{Mock, Req, Resp, client, run};
use super::repo;
use crate::backup::contract::{BackupError, ProtectionState, RepoContent, Visibility};
use crate::git_host::endpoints::Endpoints;
use crate::git_host::lock::{FREE_PLAN, protect, protection_of};
use crate::git_host::repos::{check, create_backup, make_private, name_available, visibility};

/// A GitHub where the account may make repositories; `rulesets` is what the
/// ruleset call answers.
fn account(rulesets: fn(&Req) -> Resp) -> Mock {
    Mock::start(move |req| match (req.method.as_str(), req.route()) {
        ("POST", "/user/repos") => {
            let name = req.json()["name"].as_str().unwrap_or("").to_owned();
            if name == "taken" {
                Resp::json(
                    422,
                    json!({"message":"Repository creation failed.",
                           "errors":[{"message":"name already exists on this account"}]}),
                )
            } else {
                Resp::json(201, repo("ada", &name, true))
            }
        }
        ("GET", "/repos/ada/taken") => Resp::json(200, repo("ada", "taken", true)),
        ("PUT", p) if p.ends_with("/topics") => {
            Resp::json(200, json!({"names":["kastenflow-vault"]}))
        }
        (_, p) if p.ends_with("/rulesets") => rulesets(req),
        _ => Resp::empty(404),
    })
}

fn locked(_: &Req) -> Resp {
    Resp::json(201, json!({"id": 7}))
}

fn free_plan(_: &Req) -> Resp {
    Resp::json(
        403,
        json!({"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."}),
    )
}

#[test]
fn a_backup_is_made_private_with_its_description_topic_and_lock() {
    let mock = account(locked);
    let ep = Endpoints::at(&mock.base());
    let (row, protection) = run(create_backup(&client(), &ep, "tok", "ada", "my-notes")).unwrap();
    assert_eq!(row.full_name, "ada/my-notes");
    assert!(row.is_backup && row.visibility == Visibility::Private);
    assert_eq!(protection.state, ProtectionState::Protected);
    let seen = mock.seen();
    let made = seen[0].json();
    assert_eq!(made["private"], true);
    assert_eq!(made["description"], "KastenFlow vault backup");
    assert_eq!(seen[0].headers["authorization"], "Bearer tok");
    assert_eq!(seen[1].method, "PUT");
    assert_eq!(seen[1].json()["names"][0], "kastenflow-vault");
    let rule = seen[2].json();
    assert_eq!(rule["rules"][1]["type"], "non_fast_forward");
}

#[test]
fn a_refused_lock_is_reported_with_the_free_plan_sentence() {
    let mock = account(free_plan);
    let ep = Endpoints::at(&mock.base());
    let (row, protection) = run(create_backup(&client(), &ep, "tok", "ada", "notes")).unwrap();
    // The repository is made all the same.
    assert_eq!(row.name, "notes");
    assert_eq!(protection.state, ProtectionState::Unprotected);
    assert_eq!(protection.reason.as_deref(), Some(FREE_PLAN));
}

#[test]
fn a_ruleset_validation_error_and_a_missing_permission_differ() {
    let mock = Mock::start(|req| {
        if req.path.contains("/ada/refused/") {
            Resp::json(422, json!({"message":"Validation Failed"}))
        } else if req.path.contains("/ada/weak/") {
            Resp::json(
                403,
                json!({"message":"Resource not accessible by personal access token"}),
            )
        } else if req.path.contains("/ada/again/") {
            Resp::json(
                422,
                json!({"message":"Validation Failed","errors":["Name must be unique: already exists"]}),
            )
        } else {
            Resp::json(500, json!({}))
        }
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    let refused = run(protect(&http, &ep, "tok", "ada/refused"));
    assert_eq!(refused.reason.as_deref(), Some(FREE_PLAN));
    let weak = run(protect(&http, &ep, "tok", "ada/weak"));
    assert_eq!(weak.state, ProtectionState::Unprotected);
    assert!(weak.reason.unwrap().starts_with("This token cannot lock"));
    let again = run(protect(&http, &ep, "tok", "ada/again"));
    assert_eq!(again.state, ProtectionState::Protected);
    let broken = run(protect(&http, &ep, "tok", "ada/broken"));
    assert_eq!(broken.state, ProtectionState::Unknown);
    assert!(broken.reason.unwrap().contains("500"));
    let nonsense = run(protect(&http, &ep, "tok", "ada/../x"));
    assert_eq!(nonsense.state, ProtectionState::Unknown);
}

#[test]
fn a_taken_name_offers_the_existing_repository() {
    let mock = account(locked);
    let ep = Endpoints::at(&mock.base());
    let err = run(create_backup(&client(), &ep, "tok", "ada", "taken")).unwrap_err();
    let BackupError::NameTaken { message, existing } = err else {
        panic!("not a taken name");
    };
    assert!(
        message.contains("already have a repository named taken"),
        "{message}"
    );
    assert_eq!(existing.unwrap().full_name, "ada/taken");
    // Nothing was locked or marked.
    assert_eq!(mock.count("POST", "/repos/ada/taken/rulesets"), 0);
}

#[test]
fn a_name_github_would_refuse_is_never_sent() {
    let mock = account(locked);
    let ep = Endpoints::at(&mock.base());
    for bad in ["", "a b", "a/b", "..", "x.git"] {
        assert!(
            run(create_backup(&client(), &ep, "tok", "ada", bad)).is_err(),
            "{bad}"
        );
    }
    assert!(mock.seen().is_empty());
}

#[test]
fn the_name_check_says_free_taken_and_never_asks_about_odd_names() {
    let mock = Mock::start(|req| match req.route() {
        "/repos/ada/free" => Resp::empty(404),
        "/repos/ada/used" => Resp::json(200, repo("ada", "used", true)),
        _ => Resp::json(500, json!({})),
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    assert!(run(name_available(&http, &ep, "tok", "ada", "free")).unwrap());
    assert!(!run(name_available(&http, &ep, "tok", "ada", "used")).unwrap());
    assert!(!run(name_available(&http, &ep, "tok", "ada", "has space")).unwrap());
    assert!(!run(name_available(&http, &ep, "tok", "ada", "")).unwrap());
    assert_eq!(mock.seen().len(), 2);
    assert!(run(name_available(&http, &ep, "tok", "ada", "boom")).is_err());
}

#[test]
fn making_private_is_one_patch_and_its_answer_is_checked() {
    let mock = Mock::start(|req| match (req.method.as_str(), req.route()) {
        ("PATCH", "/repos/ada/open") => Resp::json(200, repo("ada", "open", true)),
        ("PATCH", "/repos/ada/stuck") => Resp::json(200, repo("ada", "stuck", false)),
        ("PATCH", "/repos/ada/theirs") => {
            Resp::json(403, json!({"message":"Must have admin rights"}))
        }
        ("GET", "/repos/ada/open") => Resp::json(200, repo("ada", "open", false)),
        _ => Resp::empty(404),
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    assert_eq!(
        run(visibility(&http, &ep, Some("tok"), "ada/open")).unwrap(),
        Visibility::Public
    );
    assert_eq!(
        run(make_private(&http, &ep, "tok", "ada/open")).unwrap(),
        Visibility::Private
    );
    let patch = mock
        .seen()
        .into_iter()
        .find(|r| r.method == "PATCH")
        .unwrap();
    assert_eq!(patch.json(), json!({"private": true}));
    assert!(run(make_private(&http, &ep, "tok", "ada/stuck")).is_err());
    let err = run(make_private(&http, &ep, "tok", "ada/theirs")).unwrap_err();
    assert!(matches!(&err, BackupError::NoAccess { .. }), "{err:?}");
    assert!(err.message().contains("settings on GitHub"));
    assert!(run(make_private(&http, &ep, "tok", "ada/../etc")).is_err());
}

/// A GitHub with three repositories: empty, this vault's, and another's.
fn three() -> Mock {
    Mock::start(|req| {
        let has = |name: &str| req.route().starts_with(&format!("/repos/ada/{name}"));
        let rest = req.route().rsplit('/').next().unwrap_or("");
        match req.route() {
            "/repos/ada/empty" => Resp::json(200, repo("ada", "empty", true)),
            "/repos/ada/mine" => Resp::json(200, repo("ada", "mine", false)),
            "/repos/ada/other" => Resp::json(200, repo("ada", "other", true)),
            "/repos/ada/empty/commits" => {
                Resp::json(409, json!({"message":"Git Repository is empty."}))
            }
            "/repos/ada/mine/commits" | "/repos/ada/other/commits" => {
                Resp::json(200, json!([{"sha":"f00"}]))
            }
            r if has("mine") && r.contains("/commits/") && rest == "abc1234" => {
                Resp::json(200, json!({"sha":"abc1234"}))
            }
            r if r.contains("/commits/") => {
                Resp::json(422, json!({"message":"No commit found for SHA"}))
            }
            r if r.ends_with("/rulesets") => Resp::json(
                200,
                json!([{"name":"KastenFlow backup","enforcement":"active"}]),
            ),
            _ => Resp::empty(404),
        }
    })
}

#[test]
fn a_repository_is_empty_this_vaults_or_unrelated() {
    let mock = three();
    let ep = Endpoints::at(&mock.base());
    let http = client();
    let ids = vec!["deadbee".to_owned(), "abc1234".to_owned()];
    let empty = run(check(&http, &ep, Some("tok"), "ada/empty", &ids)).unwrap();
    assert!(empty.exists && empty.empty && empty.content == RepoContent::Empty);
    assert_eq!(empty.visibility, Visibility::Private);
    let mine = run(check(&http, &ep, Some("tok"), "ada/mine", &ids)).unwrap();
    assert!(!mine.empty && mine.content == RepoContent::ThisVault);
    assert_eq!(mine.visibility, Visibility::Public);
    assert_eq!(mine.protection.state, ProtectionState::Protected);
    let other = run(check(&http, &ep, Some("tok"), "ada/other", &ids)).unwrap();
    assert_eq!(other.content, RepoContent::Unrelated);
    let unknown = run(check(&http, &ep, Some("tok"), "ada/other", &[])).unwrap();
    assert_eq!(unknown.content, RepoContent::Unknown);
}

#[test]
fn a_repository_that_is_not_there_is_not_an_error() {
    let mock = three();
    let ep = Endpoints::at(&mock.base());
    let none = run(check(&client(), &ep, Some("tok"), "ada/nowhere", &[])).unwrap();
    assert!(!none.exists && !none.empty);
    assert_eq!(none.visibility, Visibility::Unknown);
    assert!(run(check(&client(), &ep, Some("tok"), "not a repo", &[])).is_err());
}

#[test]
fn reading_the_lock_tells_locked_unlocked_and_unavailable() {
    let mock = Mock::start(|req| match req.route() {
        "/repos/ada/on/rulesets" => Resp::json(
            200,
            json!([{"name":"KastenFlow backup","enforcement":"active"}]),
        ),
        "/repos/ada/off/rulesets" => Resp::json(
            200,
            json!([{"name":"KastenFlow backup","enforcement":"disabled"}]),
        ),
        "/repos/ada/free/rulesets" => free_plan(req),
        _ => Resp::json(500, json!({})),
    });
    let ep = Endpoints::at(&mock.base());
    let http = client();
    let state = |full: &str| run(protection_of(&http, &ep, Some("tok"), full));
    assert_eq!(state("ada/on").state, ProtectionState::Protected);
    assert_eq!(state("ada/off").state, ProtectionState::Unprotected);
    assert_eq!(state("ada/free").reason.as_deref(), Some(FREE_PLAN));
    assert_eq!(state("ada/x").state, ProtectionState::Unknown);
}

#[test]
fn a_limit_while_looking_names_the_wait() {
    let mock = Mock::start(|_| {
        Resp::json(403, json!({"message":"API rate limit exceeded"}))
            .header("x-ratelimit-remaining", "0")
            .header("x-ratelimit-reset", "4102444800")
    });
    let ep = Endpoints::at(&mock.base());
    let err = run(visibility(&client(), &ep, Some("tok"), "ada/x")).unwrap_err();
    assert!(
        matches!(
            err,
            BackupError::RateLimited {
                resets_at: Some(4_102_444_800_000),
                ..
            }
        ),
        "{err:?}"
    );
}
