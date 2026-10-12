//! The door the browser extension knocks on: HTTP on 127.0.0.1 only, while
//! Kasten runs and the switch in Settings is on. A request gets in only when
//! the Host is exactly this address and port (so a name pointed here by DNS
//! rebinding is refused), the Origin is a browser extension's, and, past
//! pairing, the bearer token is one that was paired from that same origin.
//! No CORS header is ever sent and OPTIONS is refused: the extension has host
//! permission for this address and needs neither, so no web page can read an
//! answer. Each connection serves one request.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use bytes::{Buf, Bytes};
use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Incoming};
use hyper::header::{self, HeaderMap, HeaderValue};
use hyper::http::request::Parts;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

use super::api::{self, Reply};
use super::shared::{Shared, held};

/// The biggest request body: a page's text is cut to this on the way.
pub(super) const MAX_BODY: usize = 2 << 20;
/// What is read of a refused body before replying, so the connection closes
/// cleanly (closed with its body unread, Windows resets it and drops the reply).
const DRAIN: usize = 4 << 20;
/// How long a refused request has to send its body.
const DRAIN_TIME: Duration = Duration::from_secs(5);
/// How long a request has to send its head, and then its body.
const HEAD_TIME: Duration = Duration::from_secs(10);
const BODY_TIME: Duration = Duration::from_secs(15);
/// Connections served at once; the rest wait to be accepted again.
const CONNECTIONS: usize = 16;

/// The server running: stopped by `stop`, which frees the port.
pub(super) struct Server {
    port: u16,
    task: JoinHandle<()>,
}

impl Server {
    /// Listens on 127.0.0.1:`port` (0 for any free port, in tests).
    pub async fn start(port: u16, shared: Arc<Shared>) -> Result<Server, String> {
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = TcpListener::bind(address).await.map_err(|e| {
            format!("KastenFlow cannot listen on 127.0.0.1:{port} for the extension: {e}")
        })?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        let task = tokio::spawn(serve(listener, bound, shared));
        Ok(Server { port: bound, task })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Stops listening; the port is free again when this returns. A request
    /// being answered finishes, and finds the door shut or its token revoked.
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }
}

async fn serve(listener: TcpListener, port: u16, shared: Arc<Shared>) {
    let slots = Arc::new(Semaphore::new(CONNECTIONS));
    let host: Arc<str> = Arc::from(format!("127.0.0.1:{port}"));
    loop {
        // One connection failing must not stop the server.
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        let Ok(permit) = Arc::clone(&slots).try_acquire_owned() else {
            continue;
        };
        let shared = Arc::clone(&shared);
        let host = Arc::clone(&host);
        tokio::spawn(async move {
            let _permit = permit;
            let service =
                service_fn(move |request| handle(request, Arc::clone(&shared), Arc::clone(&host)));
            let _ = hyper::server::conn::http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HEAD_TIME)
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

/// Reads what is left of a body being refused and drops it as it comes; a body
/// over `limit`, or one still coming after `time`, is left unread.
async fn drain<B: Body + Unpin>(mut body: B, limit: usize, time: Duration) {
    let read = async {
        let mut seen = 0usize;
        while let Some(Ok(frame)) = body.frame().await {
            seen += frame.data_ref().map_or(0, |data| data.remaining());
            if seen > limit {
                break;
            }
        }
    };
    let _ = tokio::time::timeout(time, read).await;
}

/// The one value of a header: none when it is missing, repeated or not text.
fn single(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    let mut all = headers.get_all(name).iter();
    let first = all.next()?;
    if all.next().is_some() {
        return None;
    }
    first.to_str().ok()
}

/// Whether `origin` is a browser extension's: Chrome's and Edge's
/// `chrome-extension://` and 32 letters a to p, or Firefox's `moz-extension://`
/// and a UUID.
pub(super) fn extension_origin(origin: &str) -> bool {
    if let Some(id) = origin.strip_prefix("chrome-extension://") {
        return id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b));
    }
    if let Some(id) = origin.strip_prefix("moz-extension://") {
        return id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
    }
    false
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Route {
    Pair,
    Targets,
    Capture,
}

/// A request turned away at the door, and why.
struct Refusal {
    status: StatusCode,
    why: &'static str,
}

fn refuse(status: StatusCode, why: &'static str) -> Refusal {
    Refusal { status, why }
}

/// What got in: the route, and the origin it came from.
struct Admitted {
    route: Route,
    origin: String,
}

/// Every check that needs no body, in the order that costs least and
/// reveals least. Requests that cannot be the extension (the wrong Host or
/// Origin) are turned away before they are counted, so a web page cannot use
/// up the limits; one that fails the token check is counted, and too many of
/// those shut the door for a while.
fn door(parts: &Parts, shared: &Shared, host: &str, now: Instant) -> Result<Admitted, Refusal> {
    use StatusCode as S;
    if !shared.on.load(Ordering::Relaxed) {
        return Err(refuse(
            S::SERVICE_UNAVAILABLE,
            "The browser extension is off in KastenFlow's Settings",
        ));
    }
    let headers = &parts.headers;
    if single(headers, header::HOST) != Some(host) {
        return Err(refuse(
            S::FORBIDDEN,
            "Only 127.0.0.1 and KastenFlow's own port may be the Host",
        ));
    }
    if parts.method == Method::OPTIONS {
        return Err(refuse(
            S::METHOD_NOT_ALLOWED,
            "KastenFlow answers no preflight: the extension needs none",
        ));
    }
    let Some(origin) = single(headers, header::ORIGIN).filter(|o| extension_origin(o)) else {
        return Err(refuse(
            S::FORBIDDEN,
            "Only the KastenFlow browser extension may ask",
        ));
    };
    if !held(&shared.limits).admit(now) {
        return Err(refuse(
            S::TOO_MANY_REQUESTS,
            "Too many requests. Try again in a minute",
        ));
    }
    let route = match (parts.method.as_str(), parts.uri.path()) {
        ("POST", "/v1/pair") => Route::Pair,
        ("GET", "/v1/targets") => Route::Targets,
        ("POST", "/v1/capture") => Route::Capture,
        (_, "/v1/pair" | "/v1/targets" | "/v1/capture") => {
            return Err(refuse(
                S::METHOD_NOT_ALLOWED,
                "That route does not take this method",
            ));
        }
        _ => {
            return Err(refuse(
                S::NOT_FOUND,
                "KastenFlow's extension routes are /v1/pair, /v1/targets and /v1/capture",
            ));
        }
    };
    if route != Route::Targets {
        let json = single(headers, header::CONTENT_TYPE).is_some_and(|t| {
            let kind = t.split(';').next().unwrap_or("").trim();
            kind.eq_ignore_ascii_case("application/json")
        });
        if !json {
            return Err(refuse(S::UNSUPPORTED_MEDIA_TYPE, "Send application/json"));
        }
        let declared =
            single(headers, header::CONTENT_LENGTH).and_then(|n| n.parse::<usize>().ok());
        if declared.is_some_and(|n| n > MAX_BODY) {
            return Err(refuse(
                S::PAYLOAD_TOO_LARGE,
                "That is over the 2 MB a capture may be",
            ));
        }
    }
    if route != Route::Pair {
        let token = single(headers, header::AUTHORIZATION).and_then(|v| v.strip_prefix("Bearer "));
        let known =
            token.and_then(|token| held(&shared.store).find(token).map(|p| p.origin.clone()));
        if known.as_deref() != Some(origin) {
            held(&shared.limits).failed(now);
            return Err(refuse(
                S::UNAUTHORIZED,
                "This extension is not paired, or its pairing was revoked. Pair it again in KastenFlow's Settings",
            ));
        }
    }
    Ok(Admitted {
        route,
        origin: origin.to_owned(),
    })
}

/// What reading a body went wrong with.
enum Unread {
    Big,
    Broken,
    Slow,
}

/// The body, whole, unless it is over `cap` (the rest is then read and dropped
/// up to a limit, so the reply gets through) or too slow.
async fn read_capped(mut body: Incoming, cap: usize, time: Duration) -> Result<Vec<u8>, Unread> {
    let read = async {
        let mut out: Vec<u8> = Vec::new();
        let mut seen = 0usize;
        while let Some(frame) = body.frame().await {
            let Ok(frame) = frame else {
                return Err(Unread::Broken);
            };
            if let Some(data) = frame.data_ref() {
                seen += data.remaining();
                if seen > DRAIN {
                    return Err(Unread::Big);
                }
                if seen <= cap {
                    out.extend_from_slice(data);
                }
            }
        }
        if seen > cap {
            Err(Unread::Big)
        } else {
            Ok(out)
        }
    };
    tokio::time::timeout(time, read)
        .await
        .unwrap_or(Err(Unread::Slow))
}

fn answer(status: StatusCode, body: &Value) -> Response<Full<Bytes>> {
    let bytes = serde_json::to_vec(body).unwrap_or_default();
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn handle(
    request: Request<Incoming>,
    shared: Arc<Shared>,
    host: Arc<str>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let now = Instant::now();
    let (parts, body) = request.into_parts();
    let admitted = match door(&parts, &shared, &host, now) {
        Ok(admitted) => admitted,
        Err(no) => {
            drain(body, DRAIN, DRAIN_TIME).await;
            return Ok(answer(no.status, &json!({ "error": no.why })));
        }
    };
    let reply = match admitted.route {
        Route::Targets => {
            // A listing has no body; one that came anyway is read and dropped.
            drain(body, 64 << 10, Duration::from_secs(1)).await;
            let shared = Arc::clone(&shared);
            blocking(move || api::targets(&shared)).await
        }
        Route::Pair | Route::Capture => match read_capped(body, MAX_BODY, BODY_TIME).await {
            Err(Unread::Big) => Reply::no(
                StatusCode::PAYLOAD_TOO_LARGE,
                "That is over the 2 MB a capture may be",
            ),
            Err(Unread::Slow) => {
                Reply::no(StatusCode::REQUEST_TIMEOUT, "That request was too slow")
            }
            Err(Unread::Broken) => Reply::no(StatusCode::BAD_REQUEST, "That request was cut short"),
            Ok(bytes) if admitted.route == Route::Pair => {
                let at_ms = kasten_core::Instant::now().millis;
                let reply = api::pair(&shared, &admitted.origin, &bytes, now, at_ms);
                if reply.status == StatusCode::FORBIDDEN {
                    held(&shared.limits).failed(now);
                }
                reply
            }
            Ok(bytes) => {
                let shared = Arc::clone(&shared);
                blocking(move || api::capture(&shared, &bytes)).await
            }
        },
    };
    Ok(answer(reply.status, &reply.body))
}

/// Runs `work` on a thread that may block (the vault's ops do file work).
async fn blocking(work: impl FnOnce() -> Reply + Send + 'static) -> Reply {
    tokio::task::spawn_blocking(work).await.unwrap_or_else(|_| {
        Reply::no(
            StatusCode::INTERNAL_SERVER_ERROR,
            "KastenFlow hit a problem it did not expect",
        )
    })
}
