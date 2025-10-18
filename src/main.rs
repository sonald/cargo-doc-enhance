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
            if !options.doc_dir.exists() {
                eprintln!(
                    "Doc directory not found: {}\nHint: run `cargo doc` first or pass --doc-dir",
                    options.doc_dir.display()
                );
                return Err(1);
            }

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
