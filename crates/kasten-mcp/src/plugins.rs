//! Tools that belong to a plugin. They are listed to an agent, and answer, only
//! while the plugin is on for the vault (`.kasten/config.yaml`, set by a person
//! in Settings → Plugins). The engine keeps its config current with the file,
//! so each request sees a plugin turned on or off in the app; a connected
//! client is told by `config_watch`.

use std::collections::HashMap;
use std::sync::OnceLock;

use kasten_core::Config;
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
        ("latex", KastenServer::latex_tools()),
    ]
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
    let name = match id {
        "diagrams" => "Diagrams",
        "latex" => "LaTeX",
        other => other,
    };
    format!("Turn on the {name} plugin in Settings → Plugins")
}

/// `core` and the tools of every plugin that `config` has on.
pub(crate) fn routes_for(
    core: &ToolRouter<KastenServer>,
    plugins: &[PluginTools],
    config: &Config,
) -> ToolRouter<KastenServer> {
    plugins
        .iter()
        .filter(|(id, _)| config.plugin_enabled(id))
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
        let both = instructions_for(&config(&[("latex", true)]));
        assert!(both.contains("diagram_new") && both.contains("latex_build"));
        assert_eq!(both, crate::server::instructions());
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
    fn the_latex_tools_belong_to_the_latex_plugin() {
        for tool in ["latex_list", "latex_read", "latex_edit", "latex_build"] {
            assert_eq!(owner_of(tool), Some("latex"), "{tool}");
        }
    }
}
