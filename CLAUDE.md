# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`cargo-doc-viewer` is a Rust CLI that enhances `cargo doc` output with an interactive overlay. The default experience now runs a lightweight HTTP server that injects CSS/JS at response time, keeping the generated HTML files untouched. A legacy "enhance" flow is still available when you need to modify files in place for offline distribution.

## Development Commands

### Building and Checking
- `cargo fmt` – format before committing
- `cargo check` – fast correctness gate during edits
- `cargo build --release` – optimized binary

### Running the Tool
- `cargo run --` / `cargo run -- serve` – serve docs from `target/doc` at `http://127.0.0.1:7878`
- `cargo run -- serve --addr 127.0.0.1:4200` – custom bind address
- `cargo run -- enhance --doc-dir path/to/docs` – static injection
- `cargo run -- revert --doc-dir path/to/docs` – remove injected assets

### Suggested Workflow
1. `cargo doc` – generate documentation under `target/doc`
2. `cargo run --` – launch the runtime server
3. Open the printed URL in a browser to verify enhancements
4. Optionally run `cargo run -- enhance` / `cargo run -- revert` to test legacy flows

## Architecture

### Module Layout (src/)
- `main.rs` – CLI entrypoint; dispatches to serve/enhance/revert modes
- `cli.rs` – manual argument parsing and defaulting logic
- `assets.rs` – embeds `src/assets/cdv.css` and `src/assets/cdv.js`
- `config.rs` – loads/serialises YAML chat config (`~/.cargo-doc-viewer/config.yaml`)
- `injector.rs` – pure functions for injecting/removing assets from HTML
- `overview.rs` – scans doc directories and renders the crate overview page
- `enhance.rs` – filesystem walker used by enhance/revert flows
- `server.rs` – Hyper-based HTTP server that performs runtime injection

### Runtime Serve Pipeline
1. Resolve the request path within the doc root (guards against traversal)
2. Stream non-HTML assets directly
3. For `.html`, read content and call `injector::inject` before responding
4. `/` and `/cdv-crate-overview.html` render the overview via `overview::scan_crates`
5. `/cdv-sw.js` serves a Service Worker that caches HTML/static assets for offline reuse

### Static Enhance/Revert
- `enhance::enhance_dir` walks all HTML files, skipping rustdoc internals
- Writes `<!-- CDV: injected -->`, `<style id="cdv-style">`, and `<script id="cdv-script">`
- `overview::generate_overview_page` persists `cdv-crate-overview.html`
- `enhance::revert_dir` removes the markers and calls `overview::remove_overview_page`

### JavaScript & UI Systems
The JS bundle (`src/assets/cdv.js`) still powers:
1. Top navigation bar + rustdoc search integration
2. Search filters and quick-search palette
3. Symbols list and breadcrumbs UI
4. Chat panel with layered context builder (system/env/page/selection/history)
5. Focus mode, copy buttons, anchor highlighting, etc.

## Extending the Tool

### Modifying UI Assets
- Update `src/assets/cdv.css` for styling
- Update `src/assets/cdv.js` for behaviors
- Rust-side logic (injection points, runtime routes) lives in `injector.rs` and `server.rs`

### Adding New Features
- Prefer new helper modules instead of growing `main.rs`
- For runtime features, add routes or middleware in `server.rs`
- For static mode, extend `enhance::process_dir` with clear branching
- Document any new UX behavior in `README.md` and here

### Chat Integration
- Configuration lives in YAML (`CDV_CONFIG_PATH` env override, default `~/.cargo-doc-viewer/config.yaml`) and is embedded at runtime via `<script id="cdv-bootstrap">`.
- `src/assets/cdv.js` assembles the request context层次: system prompt → environment template → page summary → pinned selection → bounded history → user prompt. The same structure drives both the API payload and the context preview panel.
- The chat panel supports localStorage overrides (API key, model, custom system prompt) and debounced selection tracking; keep debounce defaults in sync with `config.rs`.
- YAML values may reference environment variables via `$VAR` / `${VAR}`; `config.rs` resolves them using the current process env, `.env` beside the config, `.env` in the CWD, then `$HOME/.env`, so secrets can stay outside version control.
- When extending the chat feature, update both the Rust config schema and the front-end normalisation helpers to keep defaults aligned, and document new knobs in `README.md`.

## Testing Changes
1. Run `cargo check` after Rust edits
2. `cargo doc` then `cargo run --` to validate runtime injection
3. Inspect the browser console for JS errors
4. `cargo run -- enhance` followed by `cargo run -- revert` to ensure legacy idempotency
5. Consider adding unit tests (`injector.rs`, `overview.rs`) when changing parsing heuristics
