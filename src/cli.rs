use std::env;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

#[derive(Debug)]
pub enum Parsed {
    Help,
    Command(CliOptions),
}

#[derive(Debug)]
pub struct CliOptions {
    pub doc_dir: PathBuf,
    pub doc_dir_was_provided: bool,
    pub command: Command,
}

#[derive(Debug)]
pub enum Command {
    Serve { addr: SocketAddr },
    Enhance,
    Revert,
}

#[derive(Debug)]
pub struct CliError {
    message: String,
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.message.fmt(f)
    }
}

impl std::error::Error for CliError {}

pub fn parse<I>(args: I) -> Result<Parsed, CliError>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter().skip(1);
    let mut doc_dir: Option<PathBuf> = None;
    let mut doc_dir_was_provided = false;
    let mut mode: Option<Mode> = None;
    let mut addr: Option<SocketAddr> = None;
    let mut port: Option<u16> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Parsed::Help),
            "-d" | "--doc-dir" => {
                let value = args
                    .next()
                    .ok_or_else(|| CliError::new("--doc-dir requires a value"))?;
                doc_dir = Some(PathBuf::from(value));
                doc_dir_was_provided = true;
            }
            "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| CliError::new("--port requires a value"))?;
                let parsed = value
                    .parse()
                    .map_err(|_| CliError::new("invalid value for --port"))?;
                port = Some(parsed);
            }
            "--addr" | "--bind" | "--listen" => {
                let value = args
                    .next()
                    .ok_or_else(|| CliError::new("--addr requires a value"))?;
                let parsed = value
                    .parse()
                    .map_err(|_| CliError::new("invalid socket address for --addr"))?;
                addr = Some(parsed);
            }
            "--revert" => {
                mode = Some(Mode::Revert);
            }
            "--enhance" => {
                mode = Some(Mode::Enhance);
            }
            other if other.starts_with('-') => {
                return Err(CliError::new(format!("unrecognized option: {other}")));
            }
            other => match other {
                "serve" | "server" => mode = Some(Mode::Serve),
                "enhance" | "install" => mode = Some(Mode::Enhance),
                "revert" => mode = Some(Mode::Revert),
                _ => {
                    if doc_dir.is_none() {
                        doc_dir = Some(PathBuf::from(other));
                    } else {
                        return Err(CliError::new(format!(
                            "unexpected positional argument: {other}"
                        )));
                    }
                }
            },
        }
    }

    let (doc_dir, doc_dir_was_provided) = match doc_dir {
        Some(path) => (path, doc_dir_was_provided),
        None => {
            let cwd = env::current_dir().map_err(|e| {
                CliError::new(format!("unable to determine current directory: {e}"))
            })?;
            (cwd.join("target/doc"), false)
        }
    };

    let mode = mode.unwrap_or(Mode::Serve);

    match mode {
        Mode::Serve => {
            let addr = finalize_addr(addr, port)?;
            Ok(Parsed::Command(CliOptions {
                doc_dir,
                doc_dir_was_provided,
                command: Command::Serve { addr },
            }))
        }
        Mode::Enhance => {
            if addr.is_some() || port.is_some() {
                return Err(CliError::new(
                    "--addr/--port are only valid with the serve command",
                ));
            }
            Ok(Parsed::Command(CliOptions {
                doc_dir,
                doc_dir_was_provided,
                command: Command::Enhance,
            }))
        }
        Mode::Revert => {
            if addr.is_some() || port.is_some() {
                return Err(CliError::new(
                    "--addr/--port are only valid with the serve command",
                ));
            }
            Ok(Parsed::Command(CliOptions {
                doc_dir,
                doc_dir_was_provided,
                command: Command::Revert,
            }))
        }
    }
}

pub fn usage() -> &'static str {
    "cargo-doc-viewer\n\nUSAGE:\n  cargo-doc-viewer [serve] [-d|--doc-dir <path>] [--addr <ip:port>] [--port <port>]\n  cargo-doc-viewer enhance [-d|--doc-dir <path>]\n  cargo-doc-viewer revert [-d|--doc-dir <path>]\n\nDESCRIPTION:\n  Serve rustdoc HTML with runtime enhancements (default) or statically inject/remove them in place.\n\nEXAMPLES:\n  cargo doc && cargo-doc-viewer\n  cargo-doc-viewer serve --port 4200\n  cargo-doc-viewer enhance --doc-dir target/doc\n  cargo-doc-viewer revert --doc-dir target/doc\n"
}

#[derive(Debug, Copy, Clone)]
enum Mode {
    Serve,
    Enhance,
    Revert,
}

fn finalize_addr(addr: Option<SocketAddr>, port: Option<u16>) -> Result<SocketAddr, CliError> {
    let default_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 7878);
    let mut addr = addr.unwrap_or(default_addr);
    if let Some(p) = port {
        addr.set_port(p);
    }
    Ok(addr)
}

impl CliError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}
