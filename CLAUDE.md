# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cargo-doc-viewer is a Rust CLI tool that enhances `cargo doc` HTML output by injecting interactive UI components directly into generated HTML files. The entire application is contained in a single `main.rs` file (~1700 lines) that uses primarily the Rust standard library plus the `bytes` crate for efficient string handling.

## Development Commands

### Building and Testing
- `cargo build --release` - Build optimized binary
- `cargo run -- --help` - Show usage options
- `cargo check` - Quick compilation check (configured in codebuff.json)

### Running the Tool
- `cargo run --` - Enhance docs in default `target/doc` directory
- `cargo run -- --doc-dir path/to/docs` - Enhance custom doc directory  
- `cargo run -- --revert` - Remove previously injected enhancements

### Development Workflow
1. Generate documentation: `cargo doc`
2. Enhance the docs: `cargo run --`
3. Open enhanced docs: `target/doc/<crate>/index.html`

## Architecture

### Core Design Principles
- **Post-processing approach**: Modifies existing rustdoc HTML in-place rather than serving custom content
- **Idempotent injection**: Uses `<!-- CDV: injected -->` markers to safely run multiple times
- **Minimal dependencies**: Uses primarily Rust std + bytes crate for reliability and offline builds
- **File-based operation**: No servers, works with static HTML files

### Main Components

**File Processing Pipeline** (`main.rs`):
- `walk_and_process()`: Recursively walks directory tree looking for `.html` files
- `should_skip_file()`: Skips rustdoc special files (search.html, settings.html, source-src.html)
- `inject_file()`: Injects CSS and JavaScript into `<head>` and before `</body>`
- `revert_file()`: Removes injected content by finding and removing marked blocks

**UI Enhancement Assets**:
- `CDV_CSS`: Complete stylesheet for top bar, chat panel, symbols list, and responsive features
- `CDV_JS`: JavaScript that creates and manages all interactive UI components

### JavaScript Architecture

The injected JavaScript creates several independent systems:

1. **Top Navigation Bar**: Fixed search bar with rustdoc search integration, function dropdown, filters
2. **Search Enhancements**: History persistence, filter popover for result types
3. **Symbol Navigation**: Categorized list of page symbols (methods, traits, functions, etc.)
4. **Chat Panel**: Simple LLM-style interface with text retrieval from current page
5. **UX Improvements**: Copy buttons, anchor highlighting, keyboard navigation, focus mode

## File Structure

- `src/main.rs`: Complete application in single file
- `Cargo.toml`: Minimal dependencies (`bytes = "1.10.1"`, `tokio` listed but unused)
- `README.md`: User-facing documentation and feature overview

## Key Implementation Details

### HTML Injection Strategy
- Searches for `</head>` and `</body>` tags as injection points
- CSS goes in head, JavaScript goes before body close
- Uses unique IDs (`cdv-style`, `cdv-script`) for clean removal during revert
- Checks for existing markers to prevent double-injection

### UI Localization
- All UI strings are in Chinese for better localization
- Symbol categories use Chinese terms: 方法 (methods), Trait 方法 (trait methods), etc.
- Fallback to English for technical terms and edge cases

### Browser Compatibility
- Includes shim for file:// protocol locale issues in rustdoc
- Works without network connectivity
- Progressive enhancement - degrades gracefully if features fail

### Data Persistence
- Uses localStorage for search history, filter preferences, focus mode state  
- Keys are scoped by documentation root path and crate name
- Handles localStorage failures gracefully

## Extending the Tool

### Modifying UI Components
- Edit `CDV_CSS` constant for styling changes
- Edit `CDV_JS` constant for functionality changes
- Both assets are embedded as string literals in main.rs

### Adding New Features  
- Follow the existing pattern of self-contained JavaScript modules
- Use feature flags (CDV_FLAGS) for optional components
- Implement graceful fallbacks for feature detection

### Chat Integration
The chat system currently uses simple text retrieval. To integrate with real LLM backends:
1. Modify the `answer()` function in the chat setup code
2. Replace text snippet matching with API calls to your service
3. Handle CORS requirements for static file serving

## Testing Your Changes

1. Make changes to CSS/JS constants in main.rs
2. Test with a real cargo doc output:
   ```
   cargo doc  # Generate test documentation
   cargo run -- # Apply your changes
   open target/doc/cargo_doc_viewer/index.html  # Verify results
   ```
3. Test revert functionality: `cargo run -- --revert`
4. Verify idempotent behavior by running enhancement twice