//! Kasten desktop app. Every Tauri command is a thin wrapper over a kasten-core
//! op; the frontend never touches the filesystem.

mod app_settings;
mod backup;
mod brainstorm;
mod browser;
mod calendars;
mod capture;
mod chat;
mod clip;
mod closing;
mod commands;
mod crash;
mod desktop_prefs;
mod diagrams;
mod downloads;
mod drops;
mod extension;
mod git_host;
mod guard;
mod launch;
mod main_window;
mod meaning;
mod notify;
mod open_vault;
mod presenter;
mod reveal;
mod runtime;
mod secrets;
mod shortcut;
mod startup;
mod tray;
mod update_install;
mod updates;
mod vault_path;
mod web;

use tauri::{Manager, RunEvent};

/// Lets the window load the vault's own files, such as images on a board,
/// through the asset protocol; git's, Kasten's and the trash's stay out.
fn show_files(app: &tauri::AppHandle, root: &std::path::Path) {
    let scope = app.asset_protocol_scope();
    if let Err(err) = scope.allow_directory(root, true) {
        eprintln!("Images in the vault cannot be shown: {err}");
        return;
    }
    for private in [".git", ".kasten", ".trash"] {
        let _ = scope.forbid_directory(root.join(private), true);
    }
}

/// The arguments for the MCP server when the app is started as one
/// (`--mcp` first), else None.
pub fn mcp_args(args: &[String]) -> Option<&[String]> {
    match args.split_first() {
        Some((first, rest)) if first == "--mcp" => Some(rest),
        _ => None,
    }
}

/// Every async task and blocking call gets this much stack: unoptimised
/// builds need far more than the 1 MB Windows gives a thread by default.
pub(crate) const STACK_BYTES: usize = 8 << 20;

/// Builds and runs the Tauri application.
pub fn run() {
    startup::begin();
    crash::install();
    // Tauri's own runtime, with roomy stacks. It lives as long as
    // the app: `app.run` never returns.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("kasten-async")
        .thread_stack_size(STACK_BYTES)
        .build()
        .expect("error while starting the KastenFlow app's runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    let context = tauri::generate_context!();
    let vault_from_env = std::env::var_os("KASTEN_VAULT").is_some();
    let mut builder = tauri::Builder::default();
    // First of all, so a second launch goes no further than handing over.
    let asked = std::env::var("KASTEN_SINGLE_INSTANCE").ok();
    let bus = std::env::var("DBUS_SESSION_BUS_ADDRESS").ok();
    if launch::single_instance(cfg!(debug_assertions), vault_from_env, asked.as_deref())
        && (!cfg!(target_os = "linux") || launch::bus_usable(bus.as_deref()))
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
            // `kasten-app --capture`, as a desktop's own shortcut runs it.
            if args.iter().any(|a| a == "--capture") {
                capture::show(app);
            } else {
                main_window::show_main(app);
            }
        }));
    }
    let can_install = update_install::signing_key(context.config()).is_some();
    if can_install {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        .plugin(guard::plugin())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(main_window::remembered())
                .with_filename(main_window::state_file(vault_from_env))
                // Restored while the window is still hidden, in `prepare`.
                .skip_initial_state(closing::MAIN)
                .build(),
        )
        .manage(chat::commands::ChatState::new(std::sync::Arc::new(
            secrets::Keychain,
        )))
        .manage(meaning::MeaningState::default())
        .manage(update_install::Installer::new(can_install))
        .manage(git_host::SignIn::default())
        .manage(guard::Embeds::default())
        .manage(calendars::Calendars::default())
        .manage(browser::Browser::default())
        .manage(extension::Extension::default())
        .manage(diagrams::Editor::default())
        // The installed diagram editor's files, to its frame and nobody else.
        .register_asynchronous_uri_scheme_protocol(
            diagrams::protocol::SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let editor = diagrams::installed_dir(&app);
                    responder.respond(diagrams::protocol::respond(
                        editor.as_deref(),
                        request.method(),
                        request.uri().path(),
                    ));
                });
            },
        )
        .on_window_event(|window, event| {
            closing::on_window_event(window, event);
            capture::on_window_event(window, event);
            presenter::on_window_event(window, event);
        })
        .setup(|app| {
            startup::mark("setup");
            if let Ok(dir) = app.path().app_log_dir() {
                crash::log_to(&dir);
            }
            let settings = app.path().app_config_dir().ok();
            main_window::prepare(app.handle(), settings.as_deref());
            tray::start(app.handle());
            shortcut::start(app.handle());
            // Subscribed calendars are refreshed while the app runs.
            calendars::start(app.handle());
            // Off until the person turns the browser tab on.
            browser::start(app.handle());
            // Shut until the person turns the browser extension's door on.
            extension::start(app.handle());
            if std::env::args().any(|a| a == "--capture") {
                capture::show(app.handle());
            }
            // The vault from KASTEN_VAULT, else the one chosen in the app,
            // opened on a thread of its own so the window never waits.
            let handle = app.handle().clone();
            let chat_settings = settings.clone();
            let vault = open_vault::OpenVault::start(settings, move |kasten| {
                startup::mark("vault");
                let chat = handle.state::<chat::commands::ChatState>();
                chat.know_vault(chat_settings, kasten.root().display().to_string());
                git_host::hand_token(kasten, chat.keys().as_ref());
                backup::finish_on_open(&handle, kasten);
                show_files(&handle, kasten.root());
                let watcher = runtime::start(&handle, std::sync::Arc::clone(kasten));
                // Keep the watcher for the life of the app.
                handle.manage(std::sync::Mutex::new(watcher));
            });
            app.manage(vault);
            Ok(())
        })
        .invoke_handler(guard::commands(tauri::generate_handler![
            closing::pages_written,
            main_window::app_ready,
            startup::startup_marks,
            main_window::remember_theme,
            commands::info::app_info,
            commands::vault::vault_ready,
            commands::vaults::vault_choices,
            commands::vaults::open_vault,
            commands::vaults::folder_synced,
            commands::folders::browse_folders,
            commands::folders::survey_folder,
            commands::notes::list_notes,
            commands::notes::notes_at,
            commands::notes::read_note,
            commands::notes::create_note,
            commands::notes::capture_note,
            commands::notes::save_note_body,
            commands::notes::set_note_meta,
            commands::notes::trash_note,
            commands::notes::journal_day,
            commands::notes::search_notes,
            commands::notes::note_backlinks,
            commands::notes::note_mentions,
            commands::notes::day_mentions,
            commands::notes::related_notes,
            commands::notes::list_tasks,
            commands::notes::apply_template,
            commands::sources::import_source,
            commands::sources::read_source,
            commands::sources::list_sources,
            commands::sources::source_highlights,
            commands::sources::all_highlights,
            commands::sources::add_highlight,
            commands::sources::edit_highlight,
            commands::sources::remove_highlight,
            commands::sources::highlight_card,
            commands::imports::plan_import,
            commands::imports::import_notes,
            commands::imports::undo_commit,
            commands::replace::find_under,
            commands::replace::replace_under,
            commands::graph::vault_graph,
            calendars::commands::calendars_list,
            calendars::commands::calendar_add,
            calendars::commands::calendar_edit,
            calendars::commands::calendar_remove,
            calendars::commands::calendar_refresh,
            calendars::commands::calendar_events,
            clip::clip_url,
            clip::web_title,
            web::open_url,
            updates::check_update,
            update_install::update_prepare,
            update_install::update_install,
            meaning::meaning_status,
            meaning::make_vectors,
            meaning::stop_vectors,
            meaning::search_meaning,
            commands::notes::list_trash,
            commands::notes::read_trashed,
            commands::notes::move_to_inbox,
            reveal::reveal_in_folder,
            drops::stage_drop,
            commands::notes::restore_note,
            commands::notes::rename_note,
            commands::notes::move_note,
            commands::notes::nest_note,
            commands::notes::convert_note,
            commands::notes::duplicate_note,
            commands::vault::vault_status,
            commands::vault::commit_edits,
            commands::vault::start_history,
            commands::vault::push_now,
            commands::vault::note_history,
            commands::vault::note_version,
            commands::vault::restore_version,
            commands::vault::restore_vault,
            commands::vault::get_config,
            commands::vault::set_config,
            commands::vault::verify_vault,
            commands::notes::empty_trash,
            backup::set_backup_folder,
            backup::backup_file_now,
            backup::get_latest,
            backup::get_latest_from_file,
            backup::backup_ahead,
            backup::restore::restore_from_git,
            backup::restore::restore_from_file,
            git_host::github_sign_in_start,
            git_host::github_sign_in_cancel,
            git_host::github_account,
            git_host::github_sign_out,
            git_host::github_backups,
            git_host::github_create_backup,
            git_host::git_token_save,
            git_host::git_token_forget,
            capture::capture_hide,
            capture::capture_done,
            capture::capture_resize,
            presenter::open_presenter,
            presenter::presenter_post,
            presenter::presenter_close,
            guard::allow_embeds,
            shortcut::capture_shortcut,
            shortcut::set_capture_shortcut,
            desktop_prefs::desktop_prefs,
            desktop_prefs::set_desktop_prefs,
            commands::meta::tag_schemas,
            commands::meta::set_tag_views,
            commands::meta::set_tag_properties,
            commands::meta::update_props,
            commands::meta::set_tags,
            commands::meta::note_stats,
            commands::meta::missing_templates,
            commands::meta::add_starter_templates,
            commands::meta::add_tour,
            commands::meta::list_kits,
            commands::meta::add_kit,
            commands::meta::save_as_template,
            commands::meta::replace_section,
            commands::meta::append_note,
            commands::assets::save_asset,
            commands::assets::add_asset,
            commands::assets::list_assets,
            commands::assets::asset_info,
            commands::assets::set_asset_meta,
            commands::assets::asset_thumb,
            commands::assets::asset_usage,
            commands::assets::assets_usage,
            commands::assets::read_asset,
            downloads::save_download,
            commands::boards::list_boards,
            commands::boards::read_board,
            commands::boards::create_board,
            commands::boards::add_to_board,
            commands::boards::add_sticky,
            commands::boards::connect_nodes,
            commands::boards::group_nodes,
            commands::boards::board_apply,
            commands::boards::boards_with,
            commands::boards::restore_board,
            commands::decks::list_decks,
            commands::decks::read_deck,
            commands::decks::references,
            commands::decks::create_deck,
            commands::decks::save_deck,
            commands::decks::restore_deck,
            commands::decks::list_deck_templates,
            commands::decks::create_deck_template,
            commands::diagrams::list_diagrams,
            commands::diagrams::read_diagram,
            commands::diagrams::read_diagram_preview,
            commands::diagrams::create_diagram,
            commands::diagrams::import_diagram,
            commands::diagrams::save_diagram,
            commands::diagrams::save_diagram_preview,
            commands::diagrams::rename_diagram,
            commands::diagrams::move_diagram,
            commands::diagrams::duplicate_diagram,
            commands::diagrams::restore_diagram,
            diagrams::commands::diagram_editor_status,
            diagrams::commands::diagram_editor_install,
            diagrams::commands::diagram_editor_cancel,
            diagrams::commands::diagram_editor_remove,
            commands::agents::mcp_token,
            commands::agents::list_proposals,
            commands::agents::accept_proposal,
            commands::agents::reject_proposal,
            commands::agents::list_sessions,
            commands::agents::undo_session,
            commands::agents::trust_session,
            commands::agents::commit_changes,
            commands::marks::agent_marks,
            commands::marks::agent_marked,
            commands::marks::accept_agent_marks,
            chat::commands::chat_providers,
            chat::commands::save_chat_provider,
            chat::commands::confirm_chat_provider,
            chat::commands::remove_chat_provider,
            chat::commands::test_chat_provider,
            chat::drafts::list_provider_models,
            chat::drafts::test_provider_draft,
            chat::write::ai_write,
            chat::write::ai_write_stop,
            chat::commands::chat_send,
            chat::commands::chat_stop,
            chat::commands::chat_reset,
            chat::chatgpt::commands::chatgpt_sign_in_start,
            chat::chatgpt::commands::chatgpt_sign_in_cancel,
            chat::chatgpt::commands::chatgpt_account,
            chat::chatgpt::commands::chatgpt_sign_out,
            chat::commands::save_chat,
            brainstorm::brainstorm_board,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_hide,
            browser::browser_show,
            browser::browser_close,
            browser::browser_nav,
            browser::browser_enabled,
            browser::set_browser_enabled,
            browser::browser_clear_data,
            browser::flow::browser_capture,
            browser::flow::browser_capture_confirm,
            browser::flow::browser_capture_discard,
            extension::extension_status,
            extension::set_extension_enabled,
            extension::set_extension_port,
            extension::extension_pair_start,
            extension::extension_pair_cancel,
            extension::extension_revoke,
        ]))
        .build(context)
        .expect("error while building the KastenFlow app");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => closing::on_exit_requested(handle, &api, code),
        // Typing is committed on close, not lost to the 30 s wait.
        // Then one last push, if the backup lacks something.
        RunEvent::Exit => {
            if let Some(kasten) = handle.state::<commands::notes::OpenVault>().kasten() {
                let _ = crash::caught(|| kasten.commit_edits().map_err(|e| e.to_string()));
                backup::final_backup(&kasten);
            }
        }
        // Clicking the Dock icon brings a hidden window back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => main_window::show_main(handle),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::mcp_args;

    #[test]
    fn only_a_leading_mcp_flag_starts_the_server() {
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let serve = args(&["--mcp", "--vault", "/v"]);
        assert_eq!(mcp_args(&serve), Some(&serve[1..]));
        assert_eq!(mcp_args(&args(&[])), None);
        assert_eq!(mcp_args(&args(&["--vault", "/v", "--mcp"])), None);
    }
}
