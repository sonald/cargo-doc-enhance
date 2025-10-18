mod assets;
mod cli;
mod enhance;
mod injector;
mod overview;
mod server;

use std::env;

use cli::{Command, Parsed};

#[tokio::main]
async fn main() {
    if let Err(code) = run().await {
        std::process::exit(code);
    }
}

async fn run() -> Result<(), i32> {
    let parsed = match cli::parse(env::args()) {
        Ok(parsed) => parsed,
        Err(err) => {
            eprintln!("{err}");
            eprintln!();
            eprintln!("{}", cli::usage());
            return Err(1);
        }
    };

    match parsed {
        Parsed::Help => {
            println!("{}", cli::usage());
            Ok(())
        }
        Parsed::Command(options) => {
            ensure_doc_dir(&options)?;

            match options.command {
                Command::Serve { addr } => match server::run(&options.doc_dir, addr).await {
                    Ok(()) => Ok(()),
                    Err(err) => {
                        eprintln!("Error while serving docs: {err}");
                        Err(1)
                    }
                },
                Command::Enhance => {
                    if let Err(e) = overview::generate_overview_page(&options.doc_dir) {
                        eprintln!("Warning: Failed to generate crate overview: {e}");
                    }

                    match enhance::enhance_dir(&options.doc_dir) {
                        Ok(summary) => {
                            println!(
                                "Enhanced docs under {} (modified {} files, skipped {}).",
                                options.doc_dir.display(),
                                summary.modified,
                                summary.skipped
                            );
                            println!(
                                "Open the docs as usual (e.g., target/doc/<crate>/index.html)."
                            );
                            Ok(())
                        }
                        Err(err) => {
                            eprintln!("Error processing docs: {err}");
                            Err(1)
                        }
                    }
                }
                Command::Revert => match enhance::revert_dir(&options.doc_dir) {
                    Ok(summary) => {
                        if let Err(e) = overview::remove_overview_page(&options.doc_dir) {
                            eprintln!("Warning: Failed to remove crate overview: {e}");
                        }
                        println!(
                            "Reverted enhancements under {} (modified {} files, skipped {}).",
                            options.doc_dir.display(),
                            summary.modified,
                            summary.skipped
                        );
                        Ok(())
                    }
                    Err(err) => {
                        eprintln!("Error processing docs: {err}");
                        Err(1)
                    }
                },
            }
        }
    }
}

fn ensure_doc_dir(options: &cli::CliOptions) -> Result<(), i32> {
    if options.doc_dir.exists() {
        return Ok(());
    }

    if should_generate_docs(options) {
        match generate_docs() {
            Ok(()) => {
                if options.doc_dir.exists() {
                    return Ok(());
                }
            }
            Err(code) => return Err(code),
        }
    }

    eprintln!(
        "Doc directory not found: {}\nHint: run `cargo doc` first or pass --doc-dir",
        options.doc_dir.display()
    );
    Err(1)
}

fn should_generate_docs(options: &cli::CliOptions) -> bool {
    !options.doc_dir_was_provided
        && matches!(options.command, Command::Serve { .. })
        && is_rust_project_root()
}

fn is_rust_project_root() -> bool {
    match env::current_dir() {
        Ok(dir) => dir.join("Cargo.toml").is_file(),
        Err(_) => false,
    }
}

fn generate_docs() -> Result<(), i32> {
    let dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("Unable to determine current directory: {err}");
            return Err(1);
        }
    };

    println!(
        "Doc directory not found; running `cargo doc` in {}...",
        dir.display()
    );

    match std::process::Command::new("cargo")
        .arg("doc")
        .current_dir(&dir)
        .status()
    {
        Ok(status) if status.success() => {
            println!("`cargo doc` completed successfully.");
            Ok(())
        }
        Ok(status) => {
            eprintln!("`cargo doc` failed with status: {status}");
            Err(1)
        }
        Err(err) => {
            eprintln!("Failed to run `cargo doc`: {err}");
            Err(1)
        }
    }
}
