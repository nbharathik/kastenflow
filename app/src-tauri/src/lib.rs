//! Kasten desktop app. Every Tauri command is a thin wrapper over a kasten-core
//! op; the frontend never touches the filesystem.

mod app_settings;
mod backup;
mod brainstorm;
mod bridge;
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
mod handlers;
mod launch;
mod main_window;
mod meaning;
mod notify;
mod open_vault;
mod plugins;
mod presenter;
mod presenter_move;
mod presenter_screen;
mod rehearsals;
mod reveal;
mod runtime;
mod secrets;
mod shortcut;
mod smart;
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
                // The presenter's window is placed on the display the show leaves free, never where it was last left.
                .with_denylist(&[presenter::PRESENTER])
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
        .manage(plugins::Payloads::default())
        .manage(smart::Runtime::default())
        // A smart page's folder and the kit, to the page's sandboxed frame and nobody else.
        .register_asynchronous_uri_scheme_protocol(
            smart::protocol::SCHEME,
            smart::protocol::handler,
        )
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
            browser::on_window_event(window, event);
        })
        .setup(|app| {
            startup::mark("setup");
            if let Ok(dir) = app.path().app_log_dir() {
                crash::log_to(&dir);
            }
            let settings = app.path().app_config_dir().ok();
            // What the chat learns about a connection (the connection report, the
            // models a plan lists, what a model turns down) is kept in the cache
            // folder, never in the vault.
            if let Ok(dir) = app.path().app_cache_dir() {
                chat::cache::use_folder(dir.join("chat"));
            }
            main_window::prepare(app.handle(), settings.as_deref());
            tray::start(app.handle());
            shortcut::start(app.handle());
            // Subscribed calendars are refreshed while the app runs.
            calendars::start(app.handle());
            // Off until the person turns the browser tab on.
            browser::start(app.handle());
            // Shut until the person turns the browser extension's door on.
            extension::start(app.handle());
            // The diagram editor an earlier version kept in its own folder moves under plugins/, once.
            plugins::migrate_payloads(app.handle());
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
                // Saved chats and their attachments live in the app's data, not in the vault.
                chat.open_threads(kasten, handle.path().app_local_data_dir().ok().as_deref());
                git_host::hand_token(kasten, chat.keys().as_ref());
                backup::finish_on_open(&handle, kasten);
                show_files(&handle, kasten.root());
                // Agents on MCP can ask the app to build a LaTeX document or keep its PDF.
                bridge::start_for_app(&handle, kasten);
                let watcher = runtime::start(&handle, std::sync::Arc::clone(kasten));
                // Keep the watcher for the life of the app.
                handle.manage(std::sync::Mutex::new(watcher));
            });
            app.manage(vault);
            Ok(())
        })
        .invoke_handler(handlers::invoke_handler())
        .build(context)
        .expect("error while building the KastenFlow app");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested { api, code, .. } => closing::on_exit_requested(handle, &api, code),
        // Typing is committed on close, not lost to the 30 s wait.
        // Then one last push, if the backup lacks something.
        RunEvent::Exit => {
            // A LaTeX engine still building does not outlive the app.
            plugins::latex::proc::kill_all();
            // Agents are told the app is closed.
            bridge::stop(handle);
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
