//! `slides dev [FOLDER]`: a folder of decks, edited in a browser.
//!
//! The program serves the page (the built editor, when it is found) and a
//! small API over the folder. It listens on the loopback address only, and
//! it is made of the standard library alone: a person's own machine, one
//! browser, a handful of requests.

mod api;
mod events;
pub(crate) mod files;
pub(crate) mod folder;
mod http;
pub(crate) mod mime;
mod pictures;
pub(crate) mod stamp;
mod ui;

use std::io::ErrorKind;
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use api::{Context, Reply};
use folder::Folder;
use http::{ReadError, Response};

use crate::args::Args;
use crate::commands::Failure;

const DEFAULT_PORT: u16 = 5175;
/// How many ports past the default to try when it is taken.
const PORT_TRIES: u16 = 20;
const MOST_CONNECTIONS: usize = 64;

fn bind(first: u16, exact: bool) -> Result<TcpListener, Failure> {
    let tries = if exact { 1 } else { PORT_TRIES };
    for port in first..first.saturating_add(tries) {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => return Ok(listener),
            Err(e) if e.kind() == ErrorKind::AddrInUse => {}
            Err(e) => return Err(Failure::Error(format!("cannot listen on port {port}: {e}"))),
        }
    }
    Err(Failure::Error(format!(
        "port {first} is in use; choose another with --port"
    )))
}

fn handle(context: &Context, stream: &TcpStream) {
    let request = match http::read_request(stream) {
        Ok(request) => request,
        Err(ReadError::Closed | ReadError::Io) => return,
        Err(ReadError::Bad(message)) => {
            let _ = Response::error(400, message).write_to(stream);
            return;
        }
        Err(ReadError::TooLarge) => {
            let _ = Response::error(413, "that is too large").write_to(stream);
            return;
        }
    };
    match api::route(context, &request) {
        Reply::Done(response) => {
            let _ = response.write_to(stream);
        }
        Reply::Events => events::serve(stream, &context.hub),
    }
    let _ = stream.shutdown(Shutdown::Both);
}

pub fn run(args: &Args) -> Result<(), Failure> {
    let folder = Arc::new(
        Folder::open(Path::new(
            args.positional.get(1).map_or(".", String::as_str),
        ))
        .map_err(Failure::Error)?,
    );
    let explicit = args.value("port");
    let first = match explicit {
        Some(port) => port
            .parse()
            .map_err(|_| Failure::Usage(format!("`{port}` is not a port")))?,
        None => DEFAULT_PORT,
    };
    let listener = bind(first, explicit.is_some())?;
    let port = listener
        .local_addr()
        .map_err(|e| Failure::Error(e.to_string()))?
        .port();

    let hub = Arc::new(events::Hub::default());
    events::watch(Arc::clone(&folder), Arc::clone(&hub));
    let page = ui::find(args.value("ui"));
    println!(
        "KastenFlow Slides: {} ({} decks)",
        folder.root().display(),
        folder.decks().len()
    );
    println!("  http://127.0.0.1:{port}/");
    if page.is_none() {
        println!(
            "  No built page was found, so only the API answers. Build it with `pnpm --filter @kasten-slides/dev build`, or run `pnpm --filter @kasten-slides/dev dev`, which talks to this server."
        );
    }
    let context = Arc::new(Context { folder, hub, page });

    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        if active.fetch_add(1, Ordering::SeqCst) >= MOST_CONNECTIONS {
            active.fetch_sub(1, Ordering::SeqCst);
            let _ = Response::error(503, "too many pages are open").write_to(&stream);
            continue;
        }
        let (context, active) = (Arc::clone(&context), Arc::clone(&active));
        thread::spawn(move || {
            handle(&context, &stream);
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
    Ok(())
}
