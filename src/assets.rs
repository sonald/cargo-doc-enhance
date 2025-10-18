//! Embedded UI assets for Cargo Doc Viewer.
//!
//! The large CSS/JS payloads are stored as standalone files under
//! `src/assets/` and included at compile time to keep the Rust source
//! manageable while still producing a single self-contained binary.

pub const CDV_CSS: &str = include_str!("assets/cdv.css");
pub const CDV_JS: &str = include_str!("assets/cdv.js");
