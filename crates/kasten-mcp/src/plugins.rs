//! Tools that belong to a plugin. They are listed to an agent, and answer, only
//! while the plugin is on for the vault (`.kasten/config.yaml`, set by a person
//! in Settings → Plugins). The engine keeps its config current with the file,
//! so each request sees a plugin turned on or off in the app; a connected
//! client is told by `config_watch`.

use std::collections::HashMap;
use std::sync::OnceLock;

use kasten_core::{Config, Kasten};
use rmcp::handler::server::router::tool::ToolRouter;

use crate::server::KastenServer;

/// A plugin and the tools it adds.
pub(crate) type PluginTools = (&'static str, ToolRouter<KastenServer>);

/// The plugins that add tools. Another plugin's tools are added to this list.
pub(crate) fn plugin_tools() -> Vec<PluginTools> {
    vec![
        (
            "diagrams",
            KastenServer::diagram_tools()
                + KastenServer::diagram_ai_tools()
                + KastenServer::diagram_more_tools(),
        ),
        (
            "latex",
            KastenServer::latex_tools()
                + KastenServer::latex_file_tools()
                + KastenServer::latex_more_tools()
                + KastenServer::latex_app_tools(),
        ),
        // Off until a person turns it on; `request_smart_pages` is listed in its place.
        ("smart", KastenServer::smart_tools()),
        // A tool that needs two plugins is listed, and answers, only while both are on.
        ("diagrams+latex", KastenServer::figure_tools()),
    ]
}

/// The id of the plugin that is on for a vault by the vault's plugin or one
/// of its projects alike: its tools are offered when anything may use them.
const SMART: &str = "smart";

/// The plugins a group of tools needs: an id naming two, as `diagrams+latex`,
/// needs both.
fn needed(id: &str) -> impl Iterator<Item = &str> {
    id.split('+')
}

/// Whether plugin `id` is on: for smart pages, anywhere in the vault (each
/// call still asks about the project of its own page). A group that needs two
/// plugins is on when both are.
pub(crate) fn is_on(kasten: &Kasten, id: &str) -> bool {
    needed(id).all(|one| {
        if one == SMART {
            kasten.smart_enabled_anywhere()
        } else {
            kasten.config().plugin_enabled(one)
        }
    })
}

/// What a call to a tool of plugin `id` answers while it is off. For a tool
/// that needs two plugins it says why, and which to turn on.
pub(crate) fn off_sentence(kasten: &Kasten, id: &str) -> String {
    if id == SMART {
        return kasten.smart_off_sentence(None);
    }
    if id.contains('+') {
        let off: Vec<&str> = needed(id)
            .filter(|one| !kasten.config().plugin_enabled(one))
            .collect();
        let names: Vec<String> = needed(id).map(plugin_name).collect();
        let to_turn_on: Vec<String> = off.iter().map(|one| plugin_name(one)).collect();
        return format!(
            "This needs the {} plugins together. Turn on the {} plugin{} in Settings → Plugins",
            names.join(" and "),
            to_turn_on.join(" and "),
            if to_turn_on.len() == 1 { "" } else { "s" }
        );
    }
    turn_on_sentence(id)
}

/// A plugin as the person reads its name.
fn plugin_name(id: &str) -> String {
    match id {
        "diagrams" => "Diagrams",
        "latex" => "LaTeX",
        other => other,
    }
    .to_owned()
}

/// The plugin whose tool `name` is, if it belongs to one.
pub(crate) fn owner_of(name: &str) -> Option<&'static str> {
    static OWNERS: OnceLock<HashMap<String, &'static str>> = OnceLock::new();
    OWNERS
        .get_or_init(|| {
            plugin_tools()
                .into_iter()
                .flat_map(|(id, router)| {
                    router
                        .list_all()
                        .into_iter()
                        .map(move |tool| (tool.name.into_owned(), id))
                })
                .collect()
        })
        .get(name)
        .copied()
}

/// What a call to a tool of a plugin that is off answers.
pub(crate) fn turn_on_sentence(id: &str) -> String {
    format!(
        "Turn on the {} plugin in Settings → Plugins",
        plugin_name(id)
    )
}

/// `core` and the tools of every plugin that `config` has on.
pub(crate) fn routes_for(
    core: &ToolRouter<KastenServer>,
    plugins: &[PluginTools],
    config: &Config,
) -> ToolRouter<KastenServer> {
    plugins
        .iter()
        .filter(|(id, _)| needed(id).all(|one| config.plugin_enabled(one)))
        .fold(core.clone(), |all, (_, tools)| all + tools.clone())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
    use rmcp::handler::server::tool::ToolCallContext;
    use rmcp::model::Tool;
    use serde_json::{Map, Value};

    use super::*;
    use crate::server::done;

    fn dummy(name: &'static str) -> ToolRouter<KastenServer> {
        let mut router = ToolRouter::new();
        let tool = Tool::new(
            name,
            "a tool of a test plugin",
            Arc::new(Map::<String, Value>::new()),
        );
        router.add_route(ToolRoute::new_dyn(
            tool,
            move |_: ToolCallContext<'_, KastenServer>| {
                Box::pin(async move { Ok(done(&name).into()) })
            },
        ));
        router
    }

    fn names(router: &ToolRouter<KastenServer>) -> Vec<String> {
        let mut all: Vec<String> = router
            .list_all()
            .into_iter()
            .map(|t| t.name.into_owned())
            .collect();
        all.sort();
        all
    }

    /// A config with these plugins chosen on or off, and the rest left to the defaults.
    fn config(chosen: &[(&str, bool)]) -> Config {
        let mut config = Config::default();
        for (id, on) in chosen {
            config.set_plugin_enabled(id, *on);
        }
        config
    }

    #[test]
    fn a_plugins_tools_are_listed_only_while_it_is_on() {
        let core = dummy("core_tool");
        let plugins: Vec<PluginTools> =
            vec![("latex", dummy("latex_build")), ("diagrams", dummy("draw"))];

        let none = config(&[]);
        assert_eq!(
            names(&routes_for(&core, &plugins, &none)),
            ["core_tool", "draw"]
        );
        let both = config(&[("latex", true)]);
        assert_eq!(
            names(&routes_for(&core, &plugins, &both)),
            ["core_tool", "draw", "latex_build"]
        );
        let off = config(&[("diagrams", false), ("latex", false)]);
        assert_eq!(names(&routes_for(&core, &plugins, &off)), ["core_tool"]);
    }

    #[test]
    fn the_instructions_talk_only_about_plugins_that_are_on() {
        use crate::server::instructions_for;
        let off = instructions_for(&config(&[("diagrams", false), ("latex", false)]));
        assert!(
            !off.contains("diagram_new") && !off.contains("diagram_edit"),
            "diagrams"
        );
        assert!(!off.contains("latex_build"), "latex");
        assert!(
            off.contains("lint_deck") && off.contains("`capture`"),
            "the rest stays"
        );
        let default = instructions_for(&config(&[]));
        assert!(default.contains("diagram_new") && !default.contains("latex_build"));
        let all = instructions_for(&config(&[("latex", true), ("smart", true)]));
        assert!(all.contains("diagram_new") && all.contains("latex_build"));
        assert!(all.contains("smart_create") && all.contains("## Smart pages"));
        assert_eq!(all, crate::server::instructions());
    }

    #[test]
    fn the_instructions_say_nothing_of_smart_pages_while_they_are_off() {
        use crate::server::instructions_for;
        for off in [
            instructions_for(&config(&[])),
            instructions_for(&config(&[("smart", false)])),
        ] {
            assert!(!off.to_lowercase().contains("smart page"), "{off}");
            assert!(!off.contains("smart_"), "{off}");
            assert!(off.contains("lint_deck") && off.contains("`capture`"));
        }
        let on = instructions_for(&config(&[("smart", true)]));
        assert!(on.contains("smart_create") && on.contains("smart_check"));
    }

    #[test]
    fn the_smart_page_tools_belong_to_the_smart_plugin_and_the_request_tool_to_none() {
        for tool in [
            "smart_create",
            "smart_read",
            "smart_edit",
            "smart_write_file",
            "smart_delete_file",
            "smart_check",
            "smart_render",
        ] {
            assert_eq!(owner_of(tool), Some("smart"), "{tool}");
        }
        assert_eq!(owner_of("request_smart_pages"), None);
        let listed = |config: &Config| {
            names(&routes_for(
                &KastenServer::core_router(),
                &plugin_tools(),
                config,
            ))
        };
        assert!(!listed(&config(&[])).iter().any(|n| n.starts_with("smart_")));
        assert!(listed(&config(&[("smart", true)])).contains(&"smart_create".to_owned()));
    }

    #[test]
    fn the_set_tag_views_description_names_every_view_type() {
        let router = KastenServer::router();
        let tool = router
            .list_all()
            .into_iter()
            .find(|t| t.name == "set_tag_views")
            .expect("the tool is listed");
        let text = tool.description.as_deref().unwrap_or_default();
        for kind in kasten_core::tags::VIEW_KINDS {
            assert!(text.contains(kind), "the description leaves out {kind}");
        }
    }

    #[test]
    fn the_diagram_tools_belong_to_the_diagrams_plugin() {
        assert_eq!(owner_of("diagram_edit"), Some("diagrams"));
        assert_eq!(owner_of("create_diagram"), Some("diagrams"));
        assert_eq!(owner_of("read_note"), None);
        assert_eq!(owner_of("lint_deck"), None);
    }

    #[test]
    fn the_figure_tool_needs_both_plugins_and_the_selection_tool_none() {
        assert_eq!(owner_of("diagram_to_latex_figure"), Some("diagrams+latex"));
        assert_eq!(owner_of("get_selection"), None);
        let listed = |config: &Config| {
            names(&routes_for(
                &KastenServer::core_router(),
                &plugin_tools(),
                config,
            ))
        };
        for (diagrams, latex, shown) in [
            (true, true, true),
            (true, false, false),
            (false, true, false),
            (false, false, false),
        ] {
            let all = listed(&config(&[("diagrams", diagrams), ("latex", latex)]));
            assert_eq!(
                all.contains(&"diagram_to_latex_figure".to_owned()),
                shown,
                "diagrams {diagrams}, latex {latex}"
            );
            // The selection belongs to the app, not to a plugin.
            assert!(all.contains(&"get_selection".to_owned()));
        }
    }

    #[test]
    fn the_latex_tools_belong_to_the_latex_plugin() {
        for tool in [
            "latex_list",
            "latex_read",
            "latex_edit",
            "latex_build",
            "latex_create_document",
            "latex_write_file",
            "latex_append",
            "latex_delete_file",
            "latex_add_asset",
            "latex_cite",
            "latex_send_page",
            "latex_export_pdf",
        ] {
            assert_eq!(owner_of(tool), Some("latex"), "{tool}");
        }
    }
}
