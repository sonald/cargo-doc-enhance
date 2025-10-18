use std::convert::Infallible;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use hyper::header;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Method, Request, Response, Server, StatusCode};
use mime_guess::MimeGuess;
use percent_encoding::percent_decode_str;
use tokio::fs;
use tokio::task;
use tokio_util::io::ReaderStream;

use crate::injector;
use crate::overview;

const SERVICE_WORKER_JS: &str = r#"const CACHE_VERSION = 'v1';
const HTML_CACHE = 'cdv-html-' + CACHE_VERSION;
const STATIC_CACHE = 'cdv-static-' + CACHE_VERSION;
const OFFLINE_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>离线模式</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family: sans-serif; padding: 24px; background: #111; color: #f0f0f0;"><h1>📡 无法连接到 Cargo Doc Viewer</h1><p>当前处于离线状态，且没有缓存的页面可以展示。</p><p>重新连接后刷新页面即可恢复。</p></body></html>';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) {
        return !key.startsWith('cdv-html-') && !key.startsWith('cdv-static-');
      }).map(function(key) { return caches.delete(key); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

function isHtmlRequest(request) {
  var accept = request.headers.get('accept') || '';
  return accept.indexOf('text/html') !== -1;
}

function shouldCacheStatic(pathname) {
  return /\.(?:css|js|wasm|json|png|jpe?g|svg|gif|ico|woff2?|ttf)$/.test(pathname);
}

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname === '/cdv-sw.js') {
    return;
  }

  if (isHtmlRequest(request)) {
    event.respondWith(
      fetch(request).then(function(response) {
        var copy = response.clone();
        caches.open(HTML_CACHE).then(function(cache) {
          cache.put(request, copy);
        });
        return response;
      }).catch(function() {
        return caches.open(HTML_CACHE).then(function(cache) {
          return cache.match(request).then(function(cached) {
            if (cached) return cached;
            return new Response(OFFLINE_HTML, {
              headers: {'Content-Type': 'text/html; charset=utf-8'}
            });
          });
        });
      })
    );
    return;
  }

  if (!shouldCacheStatic(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.match(request).then(function(cached) {
        if (cached) {
          fetch(request).then(function(response) {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
          }).catch(function(){});
          return cached;
        }
        return fetch(request).then(function(response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function() {
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      });
    })
  );
});
"#;

pub async fn run(doc_dir: &Path, addr: SocketAddr) -> io::Result<()> {
    let state = Arc::new(ServerState::new(doc_dir).await?);

    println!(
        "Serving docs from {} at http://{}",
        state.doc_root.display(),
        addr
    );
    println!("Press Ctrl+C to stop.");

    let make_service = make_service_fn(move |_conn| {
        let state = state.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                let state = state.clone();
                async move { handle_request(state, req).await }
            }))
        }
    });

    Server::bind(&addr)
        .serve(make_service)
        .await
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err))
}

struct ServerState {
    doc_root: PathBuf,
    canonical_root: PathBuf,
}

impl ServerState {
    async fn new(doc_dir: &Path) -> io::Result<Self> {
        let canonical_root = fs::canonicalize(doc_dir).await?;
        Ok(Self {
            doc_root: doc_dir.to_path_buf(),
            canonical_root,
        })
    }

    fn join(&self, uri_path: &str) -> Option<PathBuf> {
        let mut buf = self.doc_root.clone();

        for segment in uri_path.split('/') {
            if segment.is_empty() || segment == "." {
                continue;
            }
            let decoded = percent_decode_str(segment).decode_utf8().ok()?;
            if decoded.contains('\\') || decoded.contains('\0') {
                return None;
            }
            if decoded == ".." {
                return None;
            }
            buf.push(decoded.as_ref());
        }

        Some(buf)
    }

    async fn locate(&self, uri_path: &str) -> io::Result<Option<PathBuf>> {
        let mut candidate = match self.join(uri_path) {
            Some(path) => path,
            None => return Ok(None),
        };

        let mut metadata = match fs::metadata(&candidate).await {
            Ok(meta) => meta,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err),
        };

        if metadata.is_dir() {
            candidate.push("index.html");
            metadata = match fs::metadata(&candidate).await {
                Ok(meta) => meta,
                Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(err) => return Err(err),
            };
        }

        if !metadata.is_file() {
            return Ok(None);
        }

        let canonical = fs::canonicalize(&candidate).await?;
        if !canonical.starts_with(&self.canonical_root) {
            return Ok(None);
        }

        Ok(Some(candidate))
    }
}

async fn handle_request(
    state: Arc<ServerState>,
    req: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    let method = req.method().clone();

    let mut response = match method {
        Method::GET | Method::HEAD => match dispatch(state, req.uri().path()).await {
            Ok(resp) => resp,
            Err(err) => err.into_response(),
        },
        _ => method_not_allowed(),
    };

    if method == Method::HEAD {
        response = response.map(|_| Body::empty());
    }

    Ok(response)
}

async fn dispatch(state: Arc<ServerState>, path: &str) -> Result<Response<Body>, ServerError> {
    match path {
        "/" | "/index.html" => serve_overview(state).await,
        "/cdv-crate-overview.html" => serve_overview(state).await,
        "/cdv-sw.js" => serve_service_worker().await,
        _ => serve_path(state, path).await,
    }
}

async fn serve_overview(state: Arc<ServerState>) -> Result<Response<Body>, ServerError> {
    let root = state.doc_root.clone();
    let crates = task::spawn_blocking(move || overview::scan_crates(&root))
        .await
        .map_err(ServerError::internal)?
        .map_err(ServerError::from)?;
    let html = overview::generate_overview_html(&crates);

    Ok(text_response(StatusCode::OK, html))
}

async fn serve_path(state: Arc<ServerState>, path: &str) -> Result<Response<Body>, ServerError> {
    let resolved = state
        .locate(path)
        .await
        .map_err(ServerError::from)?
        .ok_or(ServerError::NotFound)?;

    let extension = resolved
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();

    if extension.eq_ignore_ascii_case("html") {
        serve_html(&resolved).await
    } else {
        serve_file(&resolved).await
    }
}

async fn serve_html(path: &Path) -> Result<Response<Body>, ServerError> {
    let content = fs::read_to_string(path).await.map_err(ServerError::from)?;
    let modified = injector::inject(&content).unwrap_or(content);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(modified))
        .expect("valid HTML response"))
}

async fn serve_file(path: &Path) -> Result<Response<Body>, ServerError> {
    let file = fs::File::open(path).await.map_err(ServerError::from)?;
    let stream = ReaderStream::new(file);

    let mime = MimeGuess::from_path(path).first_or_octet_stream();

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .body(Body::wrap_stream(stream))
        .map_err(|err| ServerError::Internal(err.to_string()))?;

    Ok(response)
}

async fn serve_service_worker() -> Result<Response<Body>, ServerError> {
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header("Service-Worker-Allowed", "/")
        .body(Body::from(SERVICE_WORKER_JS))
        .map_err(|err| ServerError::Internal(err.to_string()))
}

#[derive(Debug)]
enum ServerError {
    NotFound,
    Internal(String),
    Io(io::Error),
}

impl ServerError {
    fn internal(err: task::JoinError) -> Self {
        Self::Internal(err.to_string())
    }

    fn into_response(self) -> Response<Body> {
        match self {
            ServerError::NotFound => simple_text(StatusCode::NOT_FOUND, "Not Found"),
            ServerError::Io(err) => match err.kind() {
                io::ErrorKind::NotFound => simple_text(StatusCode::NOT_FOUND, "Not Found"),
                io::ErrorKind::PermissionDenied => {
                    simple_text(StatusCode::FORBIDDEN, "Permission Denied")
                }
                _ => simple_text(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            },
            ServerError::Internal(message) => {
                simple_text(StatusCode::INTERNAL_SERVER_ERROR, message)
            }
        }
    }
}

impl From<io::Error> for ServerError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

fn text_response(status: StatusCode, body: String) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(body))
        .expect("valid text response")
}

fn simple_text(status: StatusCode, body: impl Into<String>) -> Response<Body> {
    let body = body.into();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(body))
        .expect("valid simple response")
}

fn method_not_allowed() -> Response<Body> {
    simple_text(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed")
}
