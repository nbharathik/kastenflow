//! Streamable HTTP on 127.0.0.1 for clients other than Claude Code. Every
//! request needs the bearer token made at first run; the Host must be the
//! loopback address and a request from a web page (one with an Origin header)
//! is refused, so no website can reach the vault.

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::{Buf, Bytes};
use http_body_util::{BodyExt, Full, combinators::BoxBody};
use hyper::body::{Body, Incoming};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use kasten_core::Kasten;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use tokio::net::TcpListener;
use tower_service::Service;

use crate::say;
use crate::server::KastenServer;

/// Compares without stopping at the first difference.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The most of a refused request's body that is read before replying:
/// rmcp's own limit for the requests it serves.
const DRAIN: usize = 4 << 20;

/// How long a refused request has to send its body.
const DRAIN_TIME: Duration = Duration::from_secs(10);

/// Reads what is left of a request being refused, so the connection closes
/// cleanly after the reply. Closed with its body unread, the connection is
/// reset, and Windows then drops the reply before the client reads it.
/// What is read is dropped as it comes; a body over `limit`, or one still
/// coming after `time`, is left unread.
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

/// Why a request is refused before it reaches MCP, if it is: no token, a
/// Host that is not this loopback server (DNS rebinding), a web page's
/// Origin, or a path other than `/mcp`.
fn refusal(
    request: &Request<Incoming>,
    expected: &str,
    hosts: &[String],
) -> Option<(StatusCode, &'static str)> {
    let headers = request.headers();
    let token = headers.get(hyper::header::AUTHORIZATION);
    if !token.is_some_and(|v| same(v.as_bytes(), expected.as_bytes())) {
        return Some((StatusCode::UNAUTHORIZED, "A bearer token is required\n"));
    }
    let host = headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok());
    if !host.is_some_and(|h| hosts.iter().any(|allowed| allowed == h)) {
        return Some((
            StatusCode::FORBIDDEN,
            "Only 127.0.0.1 or localhost may be the Host\n",
        ));
    }
    if headers.contains_key(hyper::header::ORIGIN) {
        return Some((StatusCode::FORBIDDEN, "Web pages may not reach the vault\n"));
    }
    if request.uri().path() != "/mcp" {
        return Some((StatusCode::NOT_FOUND, "KastenFlow serves MCP at /mcp\n"));
    }
    None
}

fn refuse(status: StatusCode, text: &'static str) -> Response<BoxBody<Bytes, Infallible>> {
    let mut response = Response::new(Full::new(Bytes::from_static(text.as_bytes())).boxed());
    *response.status_mut() = status;
    if status == StatusCode::UNAUTHORIZED {
        response.headers_mut().insert(
            "www-authenticate",
            hyper::header::HeaderValue::from_static("Bearer"),
        );
    }
    response
}

pub async fn serve(kasten: Arc<Kasten>, port: u16) -> Result<(), String> {
    let token =
        crate::token::token(kasten.root()).map_err(|e| format!("cannot make the token: {e}"))?;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(address)
        .await
        .map_err(|e| format!("cannot listen on {address}: {e}"))?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?;
    say(&format!(
        "kasten-mcp: serving {} at http://{bound}/mcp\n  token: {} (send it as `Authorization: Bearer <token>`)\n",
        kasten.root().display(),
        kasten.root().join(crate::token::TOKEN).display()
    ));
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let hosts: Arc<[String]> = Arc::from([
        format!("127.0.0.1:{}", bound.port()),
        format!("localhost:{}", bound.port()),
        "127.0.0.1".to_owned(),
        "localhost".to_owned(),
    ]);
    // rmcp checks Host and Origin as well, behind the checks below.
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(hosts.iter().cloned())
        .enforce_origin_validation();
    let factory_kasten = Arc::clone(&kasten);
    let mcp = StreamableHttpService::new(
        move || {
            Ok(KastenServer::shared(
                Arc::clone(&factory_kasten),
                Arc::clone(&sessions),
            ))
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let expected = format!("Bearer {token}");
    loop {
        // One connection failing (reset before it was taken, too many open
        // files for a moment) must not stop the server.
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(err) => {
                say(&format!("kasten-mcp: a connection failed: {err}\n"));
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let mcp = mcp.clone();
        let expected = expected.clone();
        let hosts = Arc::clone(&hosts);
        tokio::spawn(async move {
            let handle = service_fn(move |request: Request<Incoming>| {
                let mut mcp = mcp.clone();
                let refused = refusal(&request, &expected, &hosts);
                async move {
                    if let Some((status, why)) = refused {
                        drain(request.into_body(), DRAIN, DRAIN_TIME).await;
                        return Ok::<_, Infallible>(refuse(status, why));
                    }
                    mcp.call(request).await
                }
            });
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), handle)
                .await;
        });
    }
}

#[cfg(test)]
mod tests {
    use std::pin::Pin;
    use std::task::{Context, Poll};

    use hyper::body::Frame;

    use super::*;

    #[test]
    fn compares_tokens_whole() {
        assert!(same(b"abc", b"abc") && !same(b"abc", b"abd") && !same(b"abc", b"ab"));
    }

    /// A body that never ends: kilobyte after kilobyte, or nothing ever.
    struct Endless {
        silent: bool,
    }

    impl Body for Endless {
        type Data = Bytes;
        type Error = Infallible;

        fn poll_frame(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
            if self.silent {
                return Poll::Pending;
            }
            Poll::Ready(Some(Ok(Frame::data(Bytes::from_static(&[0; 1024])))))
        }
    }

    #[tokio::test]
    async fn stops_reading_a_refused_body_at_the_limit_or_the_time() {
        let started = std::time::Instant::now();
        drain(Endless { silent: false }, 64 << 10, Duration::from_secs(30)).await;
        drain(Endless { silent: true }, DRAIN, Duration::from_millis(50)).await;
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
