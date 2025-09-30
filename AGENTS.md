# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/main.rs`, which owns CLI argument parsing, filesystem traversal, and the embedded CSS/JS strings injected into rustdoc output. Generated documentation and scratch assets stay in `target/doc`; keep it out of version control. Top-level docs (`README.md`, `CLAUDE.md`) capture product context—update them when UX surfaces change so contributors have accurate reference material.

## Build, Test, and Development Commands
Run `cargo fmt` before every commit to enforce the Rust 2024 defaults. `cargo check` is the fastest correctness gate during edits. Follow with `cargo clippy -- -D warnings` to catch regressions in HTML parsing or string handling early. Use `cargo run -- --doc-dir target/doc` after `cargo doc` to validate injections, and `cargo run -- --revert` to ensure clean rollback. For release builds, prefer `cargo build --release` and install locally with `cargo install --path .`.

## Coding Style & Naming Conventions
Stick to idiomatic Rust: four-space indentation, snake_case for functions, UpperCamelCase for types, SCREAMING_SNAKE_CASE for the large raw string constants (`CDV_CSS`, `CDV_JS`). Keep embedded assets self-contained; if you introduce new UI fragments, wrap them in clearly named helper functions before appending to the raw strings. Document non-obvious parsing heuristics with concise comments.

## Testing Guidelines
There is no dedicated test suite yet, so add targeted unit tests in `src/` or integration tests under `tests/` when you modify HTML parsing helpers like `extract_description` or `inject_file`. Name new tests after the behavior under check (e.g., `extract_description_handles_docblock`). Always regenerate docs with `cargo doc` and smoke-test both enhance and revert flows against representative crates, verifying that `<!-- CDV: injected -->` markers behave idempotently.

## Commit & Pull Request Guidelines
Follow the existing history: short, descriptive subject lines starting with a scope when relevant (`chore:`, `refactor:`) or a concise feature phrase. Keep body text to reasoning or follow-up steps. PRs should list the commands you ran, link to any related issues, and include before/after screenshots or screencasts when UI changes affect injected HTML. Call out risks to revert safety or offline behavior so reviewers can focus their validation.
