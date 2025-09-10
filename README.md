cargo-doc-viewer
=================

An enhancer for cargo doc output that injects a fixed top search bar, a left-side symbols list for the current page, and a right-side chat panel for quick Q&A about the current content.

Why this approach
- No external crates: the binary uses only Rust std, so it builds offline.
- Post-processes generated HTML in-place under `target/doc`, avoiding a custom server.

Features
- Fixed top search bar that remains visible on scroll.
- Left pane split: keeps original sidebar on top and adds a categorized "Symbols on this page" list at the bottom. If no sidebar is detected, a bottom-left overlay panel is shown instead.
- Symbol categorization (heuristic, rustdoc-friendly):
  - 方法 (method.*)
  - Trait 方法 (tymethod.*)
  - 关联函数 (associatedfunction.* / assocfn.*)
  - 关联常量 (associatedconstant.* / assocconst.*)
  - 关联类型 (associatedtype.* / assoctype.*)
  - 字段 (structfield.* / field.*)
  - 变体 (variant.*)
  - 实现 (impl-* / impl.)
  - 章节 (fallback to headings h2/h3/h4)
- LLM chat button in the top bar that toggles a right-side chat panel. The current implementation performs a simple retrieval over the page contents to surface relevant snippets (no network calls). You can wire it to a real backend later.

Search enhancements
- The top bar embeds rustdoc’s native search component for full parity.
- Search history: remembers your recent queries per docs root and crate (localStorage), shows a dropdown when focusing the search; supports arrow navigation, Enter to apply, and clear-all.

Usage
1. Generate docs as usual:
   - `cargo doc` (or `RUSTDOCFLAGS` as you prefer)
2. Enhance docs in place:
   - `cargo run --release --` or just build and run the binary `cargo-doc-viewer`.
   - Optionally specify a docs folder: `cargo-doc-viewer --doc-dir target/doc`
3. Open your docs: `target/doc/<your_crate>/index.html`

How it works
- Recursively finds every `.html` file under the docs directory.
- Injects a small CSS block and a JS block (marked by `<!-- CDV: injected -->`).
- The JS:
  - Adds the top bar and search input. Enter attempts to redirect to `search.html?q=...` or proxies into the existing rustdoc search input if present, with a page-find fallback.
  - Splits the left sidebar (if detected) and adds a symbols section built from page headings. Otherwise, shows an overlay panel in the bottom-left.
  - Adds a chat toggle button and a chat panel on the right. The included retriever surfaces relevant snippets from the current page.

Notes
- If you re-run `cargo doc` after enhancing, you’ll need to run `cargo-doc-viewer` again to re-inject.
- The injector is idempotent and skips files already marked as injected.
- Some rustdoc builds attempt to fetch `locales/locales.json` and can hang when opened via `file://`.
  The injected JS shims `fetch`/`XMLHttpRequest` to return a minimal locales payload offline, preventing hangs.

Extending the chat
- Replace the simple retrieval logic with calls to your backend (e.g., local service or API) by modifying the injected JS string in `src/main.rs` (search for `CDV_JS`).
- Keep in mind that cargo doc pages are static; any client calls must be CORS-permitted by your service.
