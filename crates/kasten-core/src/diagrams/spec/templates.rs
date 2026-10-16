//! Starting points for the diagrams people ask for most: a spec each, with
//! sample names an agent changes with `diagram_edit`. A template is a
//! diagram, not a form: it is laid out like any other.

use std::collections::BTreeMap;

use super::{Spec, SpecEdge, SpecGroup, SpecNode};

/// A template as it is listed.
#[derive(Debug, Clone, Copy)]
pub struct TemplateInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub about: &'static str,
}

pub fn templates() -> &'static [TemplateInfo] {
    const ALL: [TemplateInfo; 10] = [
        TemplateInfo {
            id: "c4-context",
            title: "C4 context",
            about: "a system, the people who use it and the systems it talks to",
        },
        TemplateInfo {
            id: "c4-container",
            title: "C4 containers",
            about: "the applications and stores inside a system",
        },
        TemplateInfo {
            id: "c4-component",
            title: "C4 components",
            about: "the parts inside one container",
        },
        TemplateInfo {
            id: "three-tier",
            title: "Three tiers",
            about: "presentation, application and data tiers",
        },
        TemplateInfo {
            id: "event-driven",
            title: "Event driven",
            about: "producers, an event bus and consumers",
        },
        TemplateInfo {
            id: "ci-cd",
            title: "CI/CD pipeline",
            about: "from commit to production, with its gates",
        },
        TemplateInfo {
            id: "data-pipeline",
            title: "Data pipeline",
            about: "sources, ingestion, processing, a warehouse and its readers",
        },
        TemplateInfo {
            id: "network",
            title: "Network",
            about: "the internet, a firewall, a router, a switch and servers",
        },
        TemplateInfo {
            id: "sequence",
            title: "Sequence",
            about: "a request through four participants, with its replies",
        },
        TemplateInfo {
            id: "er",
            title: "Entity-relationship",
            about: "customers, orders and products as tables",
        },
    ];
    &ALL
}

fn node(id: &str, label: &str, kind: &str) -> SpecNode {
    SpecNode {
        id: id.into(),
        label: label.into(),
        kind: Some(kind.into()),
        shape: None,
        group: None,
        x: None,
        y: None,
        set: None,
    }
}

fn inside(group: &str, mut n: SpecNode) -> SpecNode {
    n.group = Some(group.into());
    n
}

fn group(id: &str, label: &str, kind: &str) -> SpecGroup {
    SpecGroup {
        id: id.into(),
        label: label.into(),
        kind: Some(kind.into()),
        group: None,
    }
}

fn edge(from: &str, to: &str, label: &str, kind: &str) -> SpecEdge {
    SpecEdge {
        from: from.into(),
        to: to.into(),
        label: (!label.is_empty()).then(|| label.into()),
        kind: Some(kind.into()),
        set: None,
    }
}

fn spec(preset: &str, direction: &str) -> Spec {
    Spec {
        preset: Some(preset.into()),
        direction: Some(direction.into()),
        ..Spec::default()
    }
}

pub(super) fn spec_for(id: &str, title: &str) -> Option<Spec> {
    let _ = title;
    Some(match id {
        "c4-context" => Spec {
            nodes: vec![
                node("customer", "Customer\nBuys things online", "person"),
                node("shop", "Shop\nLets customers browse and order", "system"),
                node(
                    "payments",
                    "Payment provider\nTakes card payments",
                    "external-system",
                ),
                node("mail", "Email service\nSends receipts", "external-system"),
            ],
            edges: vec![
                edge("customer", "shop", "Browses and orders", "rel"),
                edge("shop", "payments", "Takes payment", "rel"),
                edge("shop", "mail", "Sends receipts", "rel"),
            ],
            ..spec("c4", "TB")
        },
        "c4-container" => Spec {
            groups: vec![group("shop", "Shop", "c4-boundary")],
            nodes: vec![
                node("customer", "Customer\nBuys things online", "person"),
                inside(
                    "shop",
                    node("web", "Web app [React]\nShows the shop", "container"),
                ),
                inside(
                    "shop",
                    node("api", "API [Rust]\nOrders, stock, accounts", "container"),
                ),
                inside(
                    "shop",
                    node(
                        "db",
                        "Database [PostgreSQL]\nOrders and accounts",
                        "data-container",
                    ),
                ),
                node(
                    "payments",
                    "Payment provider\nTakes card payments",
                    "external-system",
                ),
            ],
            edges: vec![
                edge("customer", "web", "Uses", "rel"),
                edge("web", "api", "Calls [JSON/HTTPS]", "rel"),
                edge("api", "db", "Reads and writes [SQL]", "rel"),
                edge("api", "payments", "Takes payment [HTTPS]", "rel"),
            ],
            ..spec("c4", "TB")
        },
        "c4-component" => Spec {
            groups: vec![group("api", "API", "c4-boundary")],
            nodes: vec![
                node("web", "Web app\nCalls the API", "container"),
                inside(
                    "api",
                    node(
                        "orders",
                        "Order controller [REST]\nAccepts orders",
                        "component",
                    ),
                ),
                inside(
                    "api",
                    node(
                        "stock",
                        "Stock service [Rust]\nChecks and reserves stock",
                        "component",
                    ),
                ),
                inside(
                    "api",
                    node(
                        "repo",
                        "Repository [SQL]\nReads and writes records",
                        "component",
                    ),
                ),
                node("db", "Database\nOrders and stock", "data-container"),
            ],
            edges: vec![
                edge("web", "orders", "Calls", "rel"),
                edge("orders", "stock", "Reserves", "rel"),
                edge("orders", "repo", "Saves", "rel"),
                edge("stock", "repo", "Reads", "rel"),
                edge("repo", "db", "Uses", "rel"),
            ],
            ..spec("c4", "TB")
        },
        "three-tier" => Spec {
            groups: vec![
                group("presentation", "Presentation", "container"),
                group("application", "Application", "container"),
                group("data", "Data", "container"),
            ],
            nodes: vec![
                node("users", "Users", "actor"),
                inside("presentation", node("web", "Web app", "client")),
                inside("application", node("api", "API", "service")),
                inside("application", node("worker", "Background jobs", "worker")),
                inside("data", node("db", "Database", "database")),
                inside("data", node("cache", "Cache", "cache")),
            ],
            edges: vec![
                edge("users", "web", "", "sync"),
                edge("web", "api", "HTTPS", "sync"),
                edge("api", "db", "SQL", "sync"),
                edge("api", "cache", "", "sync"),
                edge("api", "worker", "jobs", "async"),
                edge("worker", "db", "SQL", "sync"),
            ],
            ..spec("architecture-light", "LR")
        },
        "event-driven" => Spec {
            nodes: vec![
                node("orders", "Orders service", "service"),
                node("payments", "Payments service", "service"),
                node("bus", "Event bus", "queue"),
                node("stock", "Stock service", "service"),
                node("mail", "Notifications", "worker"),
                node("store", "Event store", "database"),
            ],
            edges: vec![
                edge("orders", "bus", "OrderPlaced", "async"),
                edge("payments", "bus", "PaymentTaken", "async"),
                edge("bus", "stock", "", "async"),
                edge("bus", "mail", "", "async"),
                edge("bus", "store", "", "data"),
            ],
            ..spec("architecture-light", "LR")
        },
        "ci-cd" => Spec {
            nodes: vec![
                node("commit", "Commit", "worker"),
                node("build", "Build", "worker"),
                node("test", "Test", "worker"),
                node("scan", "Security scan", "worker"),
                node("package", "Package", "worker"),
                node("staging", "Deploy to staging", "service"),
                node("approve", "Approval", "external"),
                node("prod", "Deploy to production", "service"),
            ],
            edges: vec![
                edge("commit", "build", "", "sync"),
                edge("build", "test", "", "sync"),
                edge("build", "scan", "", "sync"),
                edge("test", "package", "pass", "sync"),
                edge("scan", "package", "pass", "sync"),
                edge("package", "staging", "", "sync"),
                edge("staging", "approve", "", "sync"),
                edge("approve", "prod", "approved", "sync"),
            ],
            ..spec("architecture-light", "LR")
        },
        "data-pipeline" => Spec {
            nodes: vec![
                node("app", "Application events", "service"),
                node("files", "Partner files", "storage"),
                node("ingest", "Ingestion queue", "queue"),
                node("clean", "Clean and join", "worker"),
                node("lake", "Raw data", "storage"),
                node("warehouse", "Warehouse", "database"),
                node("bi", "Dashboards", "client"),
            ],
            edges: vec![
                edge("app", "ingest", "events", "async"),
                edge("files", "ingest", "batches", "data"),
                edge("ingest", "lake", "", "data"),
                edge("ingest", "clean", "", "data"),
                edge("clean", "warehouse", "tables", "data"),
                edge("warehouse", "bi", "SQL", "sync"),
            ],
            ..spec("architecture-light", "LR")
        },
        "network" => Spec {
            groups: vec![group("lan", "Office network", "boundary")],
            nodes: vec![
                node("internet", "Internet", "cloud"),
                inside("lan", node("firewall", "Firewall", "firewall")),
                inside("lan", node("router", "Router", "router")),
                inside("lan", node("switch", "Switch", "switch")),
                inside("lan", node("files", "File server", "server")),
                inside("lan", node("print", "Print server", "server")),
            ],
            edges: vec![
                edge("internet", "firewall", "", "line"),
                edge("firewall", "router", "", "line"),
                edge("router", "switch", "", "line"),
                edge("switch", "files", "", "line"),
                edge("switch", "print", "", "line"),
            ],
            ..spec("network", "TB")
        },
        "sequence" => {
            let mut s = spec("sequence", "LR");
            s.layout = Some(false);
            for (i, (id, label)) in [
                ("user", "User"),
                ("web", "Web app"),
                ("api", "API"),
                ("db", "Database"),
            ]
            .into_iter()
            .enumerate()
            {
                let mut n = node(id, label, "lifeline");
                n.x = Some(40.0 + 160.0 * i as f64);
                n.y = Some(40.0);
                s.nodes.push(n);
            }
            // Each message leaves and arrives at the same height, further down for each one.
            for (i, (from, to, label, kind)) in [
                ("user", "web", "Open the page", "message"),
                ("web", "api", "GET /orders", "message"),
                ("api", "db", "SELECT orders", "message"),
                ("db", "api", "rows", "reply"),
                ("api", "web", "200 OK", "reply"),
                ("web", "user", "Show the list", "reply"),
            ]
            .into_iter()
            .enumerate()
            {
                let y = format!("{:.2}", 0.15 + 0.13 * i as f64);
                let mut e = edge(from, to, label, kind);
                e.set = Some(BTreeMap::from([
                    ("exitX".to_owned(), "0.5".to_owned()),
                    ("exitY".to_owned(), y.clone()),
                    ("entryX".to_owned(), "0.5".to_owned()),
                    ("entryY".to_owned(), y),
                ]));
                s.edges.push(e);
            }
            s
        }
        "er" => {
            let mut s = spec("er", "LR");
            let mut table = |id: &str, label: &str, fields: &[(&str, &str)]| {
                s.groups.push(group(id, label, "entity"));
                for (field, ty) in fields {
                    s.nodes.push(inside(
                        id,
                        node(&format!("{id}-{field}"), &format!("{field}: {ty}"), "field"),
                    ));
                }
            };
            table(
                "customer",
                "Customer",
                &[("id", "uuid"), ("name", "text"), ("email", "text")],
            );
            table(
                "order",
                "Order",
                &[
                    ("id", "uuid"),
                    ("customer_id", "uuid"),
                    ("placed_at", "timestamp"),
                ],
            );
            table(
                "line",
                "Order line",
                &[
                    ("order_id", "uuid"),
                    ("product_id", "uuid"),
                    ("quantity", "int"),
                ],
            );
            table(
                "product",
                "Product",
                &[("id", "uuid"), ("name", "text"), ("price", "money")],
            );
            s.edges = vec![
                edge("customer", "order", "places", "one-to-many"),
                edge("order", "line", "has", "one-to-many"),
                edge("product", "line", "appears in", "one-to-many"),
            ];
            s
        }
        _ => return None,
    })
}
