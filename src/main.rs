use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

fn main() {
    let mut args = env::args().skip(1);
    let mut doc_dir: Option<PathBuf> = None;
    let mut revert = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_usage();
                return;
            }
            "-d" | "--doc-dir" => {
                if let Some(val) = args.next() {
                    doc_dir = Some(PathBuf::from(val));
                } else {
                    eprintln!("--doc-dir requires a value");
                    std::process::exit(2);
                }
            }
            "--revert" | "revert" => {
                revert = true;
            }
            other => {
                // Allow 'enhance' subcommand but treat any other positional as doc dir
                if other == "enhance" || other == "install" {
                    // ignore; default action
                } else {
                    doc_dir = Some(PathBuf::from(other));
                }
            }
        }
    }

    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let doc_dir = doc_dir.unwrap_or_else(|| cwd.join("target/doc"));

    if !doc_dir.exists() {
        eprintln!(
            "Doc directory not found: {}\nHint: run `cargo doc` first or pass --doc-dir",
            doc_dir.display()
        );
        std::process::exit(1);
    }

    // Generate crate overview page before processing other files
    if !revert {
        if let Err(e) = generate_crate_overview(&doc_dir) {
            eprintln!("Warning: Failed to generate crate overview: {e}");
        }
    }

    let mut files_processed = 0usize;
    let mut files_skipped = 0usize;
    match walk_and_process(&doc_dir, revert, &mut files_processed, &mut files_skipped) {
        Ok(()) => {
            if revert {
                // Clean up crate overview page during revert
                let overview_path = doc_dir.join("cdv-crate-overview.html");
                if overview_path.exists() {
                    let _ = fs::remove_file(overview_path);
                }
                println!(
                    "Reverted enhancements under {} (modified {} files, skipped {}).",
                    doc_dir.display(), files_processed, files_skipped
                );
            } else {
                println!(
                    "Enhanced docs under {} (modified {} files, skipped {}).",
                    doc_dir.display(), files_processed, files_skipped
                );
                println!("Open the docs as usual (e.g., target/doc/<crate>/index.html).");
            }
        }
        Err(e) => {
            eprintln!("Error processing docs: {e}");
            std::process::exit(1);
        }
    }
}

fn print_usage() {
    println!("cargo-doc-viewer\n\nUSAGE:\n  cargo-doc-viewer [enhance] [-d|--doc-dir <path>] [--revert]\n\nDESCRIPTION:\n  Enhance rustdoc HTML in-place (top search, symbols panel, chat).\n  Use --revert to remove previously injected CSS/JS.\n\nEXAMPLES:\n  cargo doc && cargo-doc-viewer\n  cargo-doc-viewer --doc-dir target/doc\n  cargo-doc-viewer --revert --doc-dir target/doc\n");
}

fn walk_and_process(
    root: &Path,
    revert: bool,
    files_processed: &mut usize,
    files_skipped: &mut usize,
) -> io::Result<()> {
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension() == Some(OsStr::new("html")) {
                // Skip rustdoc special pages that are sensitive
                if should_skip_file(&path) { *files_skipped += 1; continue; }
                let res = if revert { revert_file(&path) } else { inject_file(&path) };
                match res {
                    Ok(true) => *files_processed += 1,
                    Ok(false) => *files_skipped += 1,
                    Err(e) => eprintln!("Failed to enhance {}: {e}", path.display()),
                }
            }
        }
    }
    Ok(())
}

fn should_skip_file(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        let name = name.to_lowercase();
        return matches!(name.as_str(),
            "search.html" |
            "settings.html" |
            "source-src.html" |
            "cdv-crate-overview.html"  // Skip our generated overview page
        );
    }
    false
}

/// Generate a crate overview page with cards showing all crates
fn generate_crate_overview(doc_dir: &Path) -> io::Result<()> {
    let crates = scan_crates(doc_dir)?;
    let html = generate_overview_html(&crates);
    
    let overview_path = doc_dir.join("cdv-crate-overview.html");
    let mut file = fs::File::create(overview_path)?;
    file.write_all(html.as_bytes())?;
    
    Ok(())
}

/// Scan the doc directory for crates (subdirectories with index.html)
fn scan_crates(doc_dir: &Path) -> io::Result<Vec<CrateInfo>> {
    let mut crates = Vec::new();
    
    for entry in fs::read_dir(doc_dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.is_dir() {
            // Check if this directory has an index.html (indicating it's a crate)
            let index_path = path.join("index.html");
            if index_path.exists() {
                if let Some(dir_name) = path.file_name().and_then(|s| s.to_str()) {
                    // Skip common rustdoc directories that aren't crates
                    if matches!(dir_name, "static.files" | "src" | "implementors" | "help.html") {
                        continue;
                    }
                    
                    let crate_info = extract_crate_info(dir_name, &index_path)?;
                    crates.push(crate_info);
                }
            }
        }
    }
    
    // Sort crates by name for consistent display
    crates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(crates)
}

/// Extract crate information from its index.html
fn extract_crate_info(dir_name: &str, index_path: &Path) -> io::Result<CrateInfo> {
    let mut content = String::new();
    fs::File::open(index_path)?.read_to_string(&mut content)?;
    
    // Extract description from meta tag or first paragraph
    let description = extract_description(&content)
        .unwrap_or_else(|| "Rust crate documentation".to_string());
    
    // Extract version from title or other sources
    let version = extract_version(&content);
    
    Ok(CrateInfo {
        name: dir_name.to_string(),
        description,
        version,
        path: format!("{}/index.html", dir_name),
    })
}

/// Extract description from HTML content
fn extract_description(html: &str) -> Option<String> {
    // Try to find meta description first
    if let Some(start) = html.find("<meta name=\"description\" content=\"") {
        let content_start = start + "<meta name=\"description\" content=\"".len();
        if let Some(end) = html[content_start..].find("\"") {
            return Some(html[content_start..content_start + end].to_string());
        }
    }
    
    // Fall back to first paragraph in main content
    if let Some(start) = html.find("<div class=\"docblock\">") {
        let content_start = start + "<div class=\"docblock\">".len();
        if let Some(p_start) = html[content_start..].find("<p>") {
            let p_content_start = content_start + p_start + "<p>".len();
            if let Some(p_end) = html[p_content_start..].find("</p>") {
                let text = html[p_content_start..p_content_start + p_end].to_string();
                // Strip HTML tags from the text
                return Some(strip_html_tags(&text));
            }
        }
    }
    
    None
}

/// Extract version information from HTML content
fn extract_version(html: &str) -> Option<String> {
    // Try to find version in title like "crate_name-1.0.0"
    if let Some(start) = html.find("<title>") {
        let title_start = start + "<title>".len();
        if let Some(end) = html[title_start..].find("</title>") {
            let title = &html[title_start..title_start + end];
            // Look for version pattern like "-1.0.0" 
            if let Some(dash_pos) = title.rfind("-") {
                let potential_version = &title[dash_pos + 1..];
                if potential_version.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    return Some(potential_version.to_string());
                }
            }
        }
    }
    
    None
}

/// Strip HTML tags from text
fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => result.push(c),
            _ => {}
        }
    }
    
    // Clean up whitespace and decode common HTML entities
    result
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .trim()
        .to_string()
}

/// Information about a crate
#[derive(Debug)]
struct CrateInfo {
    name: String,
    description: String,
    version: Option<String>,
    path: String,
}

/// Generate the complete HTML for the crate overview page
fn generate_overview_html(crates: &[CrateInfo]) -> String {
    let cards_html = crates.iter()
        .map(|crate_info| generate_crate_card_html(crate_info))
        .collect::<Vec<_>>()
        .join("\n");
    
    format!(r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>所有包概览 - Cargo Doc Viewer</title>
    <style>
        :root {{
            --cdv-bg: rgba(20,22,30,0.95);
            --cdv-fg: #e6e6e6;
            --cdv-accent: #6aa6ff;
            --cdv-border: rgba(255,255,255,0.12);
            --cdv-card-bg: rgba(255,255,255,0.08);
            --cdv-hover: rgba(255,255,255,0.15);
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
            background: linear-gradient(135deg, #1a1d29 0%, #2a2d3a 100%);
            color: var(--cdv-fg);
            min-height: 100vh;
            padding: 2rem;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 3rem;
        }}
        
        .header h1 {{
            font-size: 2.5rem;
            font-weight: 600;
            color: var(--cdv-accent);
            margin-bottom: 0.5rem;
        }}
        
        .header p {{
            font-size: 1.1rem;
            opacity: 0.8;
        }}
        
        .crates-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 1.5rem;
            max-width: 1200px;
            margin: 0 auto;
        }}
        
        .crate-card {{
            background: var(--cdv-card-bg);
            border: 1px solid var(--cdv-border);
            border-radius: 12px;
            padding: 1.5rem;
            transition: all 0.2s ease;
            cursor: pointer;
            text-decoration: none;
            color: inherit;
            backdrop-filter: blur(10px);
        }}
        
        .crate-card:hover {{
            background: var(--cdv-hover);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.25);
        }}
        
        .crate-name {{
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--cdv-accent);
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}
        
        .crate-version {{
            font-size: 0.9rem;
            color: rgba(255,255,255,0.6);
            font-weight: normal;
            background: rgba(255,255,255,0.1);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
        }}
        
        .crate-description {{
            color: rgba(255,255,255,0.8);
            line-height: 1.5;
            font-size: 0.95rem;
        }}
        
        .empty-state {{
            text-align: center;
            padding: 3rem;
            color: rgba(255,255,255,0.6);
        }}
        
        .empty-state h2 {{
            font-size: 1.5rem;
            margin-bottom: 1rem;
        }}
        
        @media (max-width: 768px) {{
            body {{
                padding: 1rem;
            }}
            
            .crates-grid {{
                grid-template-columns: 1fr;
                gap: 1rem;
            }}
            
            .header h1 {{
                font-size: 2rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📦 所有包概览</h1>
        <p>点击任意卡片查看对应包的文档</p>
    </div>
    
    {content}
</body>
</html>"#,
        content = if crates.is_empty() {
            r#"<div class="empty-state">
                <h2>😮 没有找到任何包</h2>
                <p>请确保已经运行了 <code>cargo doc</code> 生成文档</p>
            </div>"#.to_string()
        } else {
            format!(r#"<div class="crates-grid">{}</div>"#, cards_html)
        }
    )
}

/// Generate HTML for a single crate card
fn generate_crate_card_html(crate_info: &CrateInfo) -> String {
    format!(
        r#"<a href="{path}" class="crate-card">
        <div class="crate-name">
            {name}
            {version}
        </div>
        <div class="crate-description">{description}</div>
    </a>"#,
        path = crate_info.path,
        name = crate_info.name,
        version = crate_info.version.as_ref()
            .map(|v| format!(r#"<span class="crate-version">v{}</span>"#, v))
            .unwrap_or_default(),
        description = if crate_info.description.is_empty() {
            "Rust crate documentation".to_string()
        } else {
            crate_info.description.clone()
        }
    )
}

fn inject_file(path: &Path) -> io::Result<bool> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;

    if content.contains("<!-- CDV: injected -->") {
        return Ok(false);
    }

    // Find head/body insertion points
    let head_close = content.rfind("</head>");
    // We'll search for </body> after possible head injection; no need to store it here.

    let mut modified = content.clone();
    let mut did_modify = false;

    if let Some(idx) = head_close {
        let head_inject = format!(
            "<!-- CDV: injected -->\n<style id=\"cdv-style\">\n{}\n</style>\n",
            CDV_CSS
        );
        modified.insert_str(idx, &head_inject);
        did_modify = true;
    }

    if let Some(idx) = modified.rfind("</body>") {
        let body_inject = format!(
            "<script id=\"cdv-script\">\n{}\n</script>\n",
            CDV_JS
        );
        let mut new_content = String::with_capacity(modified.len() + body_inject.len());
        new_content.push_str(&modified[..idx]);
        new_content.push_str(&body_inject);
        new_content.push_str(&modified[idx..]);
        modified = new_content;
        did_modify = true;
    }

    if did_modify {
        let mut f = fs::File::create(path)?;
        f.write_all(modified.as_bytes())?;
    }
    Ok(did_modify)
}

fn revert_file(path: &Path) -> io::Result<bool> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;
    if !content.contains("cdv-style") && !content.contains("cdv-script") {
        return Ok(false);
    }

    let mut modified = content.clone();
    // Remove style block
    if let Some(start) = modified.find("<style id=\"cdv-style\">") {
        if let Some(end_rel) = modified[start..].find("</style>") {
            let end = start + end_rel + "</style>".len();
            modified.replace_range(start..end, "");
        }
    }
    // Remove script block
    if let Some(start) = modified.find("<script id=\"cdv-script\">") {
        if let Some(end_rel) = modified[start..].find("</script>") {
            let end = start + end_rel + "</script>".len();
            modified.replace_range(start..end, "");
        }
    }
    // Remove marker comment
    modified = modified.replace("<!-- CDV: injected -->\n", "");
    modified = modified.replace("<!-- CDV: injected -->", "");

    if modified != content {
        let mut f = fs::File::create(path)?;
        f.write_all(modified.as_bytes())?;
        return Ok(true);
    }
    Ok(false)
}

const CDV_CSS: &str = r#"
:root {
  --cdv-bg: rgba(20,22,30,0.92);
  --cdv-fg: #e6e6e6;
  --cdv-accent: #6aa6ff;
  --cdv-border: rgba(255,255,255,0.12);
}

/* Top bar */
body { padding-top: 56px !important; }
#cdv-topbar {
  position: fixed; inset: 0 0 auto 0; height: 48px; z-index: 9999;
  background: var(--cdv-bg); color: var(--cdv-fg);
  display: flex; align-items: center; gap: 8px; padding: 0 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  backdrop-filter: saturate(1.2) blur(6px);
}
#cdv-brand { font-weight: 600; opacity: 0.9; margin-right: 8px; }
#cdv-search-host { flex: 1; min-width: 120px; display: flex; align-items: center; position: relative; gap: 8px; }
#cdv-search-host rustdoc-search { width: 100%; }
#cdv-fn-select-top { height: 32px; border-radius: 6px; border: 1px solid var(--cdv-border); background: rgba(255,255,255,0.06); color: var(--cdv-fg); padding: 0 6px; }
/* Home dropdown */
#cdv-home-dropdown {
  position: relative; margin-right: 6px;
}
#cdv-home-btn {
  height: 32px; padding: 0 10px; border: 1px solid var(--cdv-border);
  border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg);
  cursor: pointer; display: flex; align-items: center; gap: 4px;
}
#cdv-home-btn:hover {
  background: rgba(255,255,255,0.1);
}
#cdv-home-dropdown-content {
  position: absolute; top: 36px; left: 0; min-width: 160px; z-index: 10001;
  background: var(--cdv-bg); color: var(--cdv-fg); border: 1px solid var(--cdv-border);
  border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.35); display: none;
}
#cdv-home-dropdown.open #cdv-home-dropdown-content { display: block; }
#cdv-home-dropdown-content .home-item {
  padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--cdv-border);
}
#cdv-home-dropdown-content .home-item:last-child { border-bottom: none; }
#cdv-home-dropdown-content .home-item:hover {
  background: rgba(255,255,255,0.1);
}
#cdv-chat-toggle {
  height: 32px; padding: 0 10px; border: 1px solid var(--cdv-border);
  border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg);
  cursor: pointer;
}
#cdv-focus-toggle {
  height: 32px; padding: 0 10px; border: 1px solid var(--cdv-border);
  border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg);
  cursor: pointer;
}
#cdv-filter-btn {
  height: 32px; padding: 0 10px; border: 1px solid var(--cdv-border);
  border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg);
  cursor: pointer;
}
#cdv-filter-popover {
  position: absolute; top: 40px; right: 12px; width: 280px; z-index: 10001;
  background: var(--cdv-bg); color: var(--cdv-fg); border: 1px solid var(--cdv-border);
  border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.35); display: none;
}
#cdv-filter-popover.open { display: block; }
#cdv-filter-popover header { padding: 8px 10px; border-bottom: 1px solid var(--cdv-border); font-weight: 600; }
#cdv-filter-popover .body { padding: 8px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
#cdv-filter-popover footer { padding: 8px 10px; border-top: 1px solid var(--cdv-border); text-align: right; }
#cdv-filter-popover label { user-select: none; }
#cdv-filter-popover button { height: 28px; padding: 0 8px; border: 1px solid var(--cdv-border); border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg); cursor: pointer; }

/* Chat panel */
#cdv-chat-panel {
  position: fixed; top: 56px; right: 0; bottom: 0; width: 380px; z-index: 9998;
  background: var(--cdv-bg); color: var(--cdv-fg);
  border-left: 1px solid var(--cdv-border);
  transform: translateX(100%); transition: transform 0.2s ease-in-out;
  display: flex; flex-direction: column;
}
#cdv-chat-panel.open { transform: translateX(0); }
#cdv-chat-header { padding: 10px; border-bottom: 1px solid var(--cdv-border); font-weight: 600; }
#cdv-chat-messages { flex: 1; overflow: auto; padding: 12px; }
.cdv-msg { margin-bottom: 10px; line-height: 1.4; }
.cdv-msg.user { color: #a5d6ff; }
.cdv-msg.assistant { color: #e6e6e6; }
#cdv-chat-input-row { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--cdv-border); }
#cdv-chat-input { flex: 1; height: 34px; border-radius: 6px; border: 1px solid var(--cdv-border); background: rgba(255,255,255,0.06); color: var(--cdv-fg); padding: 0 10px; }
#cdv-chat-send { height: 34px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--cdv-border); background: rgba(255,255,255,0.08); color: var(--cdv-fg); cursor: pointer; }

/* Left symbols list inside existing sidebar (non-destructive) */
.cdv-symbols-bottom { max-height: 35vh; min-height: 140px; border-top: 1px solid var(--cdv-border); overflow: auto; background: rgba(255,255,255,0.03); }
#cdv-fn-wrap { padding: 8px; }
#cdv-fn-label { display: block; margin-bottom: 6px; font-size: 12px; opacity: 0.8; }
#cdv-fn-select { width: 100%; height: 32px; border-radius: 6px; border: 1px solid var(--cdv-border); background: rgba(255,255,255,0.06); color: var(--cdv-fg); }

/* Fallback overlay for symbols list if no sidebar detected */
#cdv-symbols-overlay {
  position: fixed; left: 0; bottom: 0; width: 320px; height: 35vh; z-index: 9997;
  background: var(--cdv-bg); color: var(--cdv-fg);
  border-top: 1px solid var(--cdv-border); border-right: 1px solid var(--cdv-border);
  box-shadow: 0 -4px 12px rgba(0,0,0,0.25);
}
#cdv-symbols-overlay-header { padding: 8px 10px; border-bottom: 1px solid var(--cdv-border); font-weight: 600; }
#cdv-symbols-overlay-body { height: calc(100% - 40px); overflow: auto; padding: 8px; }

/* Heading anchor copy */
.cdv-copy-anchor { margin-left: 8px; font-size: 12px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--cdv-border); background: rgba(255,255,255,0.06); color: var(--cdv-fg); cursor: pointer; opacity: 0.0; transition: opacity 0.15s; }
h1:hover .cdv-copy-anchor, h2:hover .cdv-copy-anchor, h3:hover .cdv-copy-anchor, h4:hover .cdv-copy-anchor { opacity: 1.0; }
.cdv-anchor-target { animation: cdvFlash 1.5s ease-out 1; }
@keyframes cdvFlash { 0% { background: rgba(106,166,255,0.25); } 100% { background: transparent; } }

/* Code copy */
pre { position: relative; }
.cdv-copy-code { position: absolute; top: 6px; right: 6px; font-size: 12px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--cdv-border); background: rgba(0,0,0,0.35); color: var(--cdv-fg); cursor: pointer; }

/* Focus mode */
.cdv-focus nav.sidebar { display: none !important; }
.cdv-focus .sidebar-resizer { display: none !important; }
.cdv-focus #cdv-chat-panel { display: none !important; }
"#;

const CDV_JS: &str = r#"
(function() {
  try {
    // Install shim to avoid file:// locale fetch hangs on some rustdoc builds
    (function installLocaleShim(){
      try {
        if (String(location.protocol) !== 'file:') return;
        var payload = {available_locales: ['en-US'], default_locale: 'en-US'};
        // fetch shim
        if (window.fetch) {
          var _origFetch = window.fetch;
          window.fetch = function(input, init) {
            try {
              var url = (typeof input === 'string') ? input : (input && input.url) || '';
              if (/(^|\/)locales\/locales\.json(\?|$)/.test(String(url))) {
                return Promise.resolve(new Response(JSON.stringify(payload), {headers: {'Content-Type': 'application/json'}}));
              }
            } catch (_) {}
            return _origFetch.apply(this, arguments);
          };
        }
        // XHR shim
        if (window.XMLHttpRequest) {
          var X = window.XMLHttpRequest;
          var _open = X.prototype.open;
          var _send = X.prototype.send;
          X.prototype.open = function(method, url) {
            this.__cdv_locales_hit = /(^|\/)locales\/locales\.json(\?|$)/.test(String(url));
            this.__cdv_method = method; this.__cdv_url = url;
            if (!this.__cdv_locales_hit) return _open.apply(this, arguments);
            this.__cdv_mock_response = JSON.stringify(payload);
          };
          X.prototype.send = function(body) {
            if (!this.__cdv_locales_hit) return _send.apply(this, arguments);
            var self = this;
            setTimeout(function(){
              try {
                self.readyState = 4; self.status = 200;
                self.responseText = self.__cdv_mock_response; self.response = self.responseText;
                if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                if (typeof self.onload === 'function') self.onload();
              } catch (_) {}
            }, 0);
          };
        }
      } catch(_) {}
    })();

    // Parse feature toggles from URL
    var CDV_FLAGS = (function(){
      try {
        var sp = new URLSearchParams(location.search);
        return {
          noTop: sp.has('cdv-notop'),
          noChat: sp.has('cdv-nochat'),
          noSymbols: sp.has('cdv-nosym')
        };
      } catch(_) { return {noTop:false, noChat:false, noSymbols:false}; }
    })();

    // Create top bar
    if (!CDV_FLAGS.noTop && !document.getElementById('cdv-topbar')) {
      var bar = document.createElement('div');
      bar.id = 'cdv-topbar';
      bar.innerHTML = '<span id="cdv-brand">Doc+ Viewer</span>' +
        '<div id="cdv-home-dropdown">' +
          '<button id="cdv-home-btn" title="导航选项">Home ▾</button>' +
          '<div id="cdv-home-dropdown-content">' +
            '<div class="home-item" data-action="crate" title="返回当前 crate 首页">当前包首页</div>' +
            '<div class="home-item" data-action="overview" title="查看所有包的卡片式概览">所有包概览</div>' +
          '</div>' +
        '</div>' +
        '<div id="cdv-search-host"></div>' +
        '<button id="cdv-filter-btn" title="筛选搜索结果">Filter</button>' +
        '<button id="cdv-focus-toggle" title="专注模式">Focus</button>' +
        '<button id="cdv-chat-toggle" title="Ask AI about this page">AI Chat</button>';
      document.body.appendChild(bar);
    }
    integrateRustdocSearch();
    setupFnDropdownTop();

    // Home navigation dropdown
    (function setupHome(){
      var dropdown = document.getElementById('cdv-home-dropdown');
      var btn = document.getElementById('cdv-home-btn');
      if (!dropdown || !btn) return;
      
      // Toggle dropdown on button click
      btn.addEventListener('click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        dropdown.classList.toggle('open');
      });
      
      // Handle dropdown item clicks
      dropdown.addEventListener('click', function(ev){
        if (ev.target && ev.target.matches('.home-item')) {
          var action = ev.target.getAttribute('data-action');
          var target = null;
          
          if (action === 'crate') {
            // Current crate home (existing functionality)
            target = buildDocsHomeUrl(false);
          } else if (action === 'overview') {
            // Crate overview page with cards
            target = buildCrateOverviewUrl();
          }
          
          if (target) {
            window.location.href = target;
          }
          dropdown.classList.remove('open');
        }
      });
      
      // Close dropdown when clicking elsewhere
      document.addEventListener('click', function(ev){
        if (!dropdown.contains(ev.target)) {
          dropdown.classList.remove('open');
        }
      });
    })();

    // Focus mode toggle
    (function setupFocus(){
      var btn = document.getElementById('cdv-focus-toggle');
      if (!btn) return;
      var key = 'cdv.focus';
      function apply(v){ document.documentElement.classList.toggle('cdv-focus', !!v); }
      try { apply(localStorage.getItem(key)==='1'); } catch(_) {}
      btn.addEventListener('click', function(){
        var v = !document.documentElement.classList.contains('cdv-focus');
        apply(v); try { localStorage.setItem(key, v?'1':'0'); } catch(_) {}
      });
    })();

    // Search result filters
    (function setupSearchFilter(){
      try {
        var btn = document.getElementById('cdv-filter-btn');
        if (!btn) return;
        var host = document.getElementById('cdv-search-host');
        var pop = document.getElementById('cdv-filter-popover');
        if (!pop) {
          pop = document.createElement('div');
          pop.id = 'cdv-filter-popover';
          pop.innerHTML = ''+
            '<header>结果筛选</header>'+
            '<div class="body">'+
              '<label><input type="checkbox" data-k="method" checked> 方法</label>'+
              '<label><input type="checkbox" data-k="fn" checked> 函数</label>'+
              '<label><input type="checkbox" data-k="struct" checked> 结构体</label>'+
              '<label><input type="checkbox" data-k="enum" checked> 枚举</label>'+
              '<label><input type="checkbox" data-k="trait" checked> Trait</label>'+
              '<label><input type="checkbox" data-k="macro" checked> 宏</label>'+
              '<label><input type="checkbox" data-k="const" checked> 常量</label>'+
              '<label><input type="checkbox" data-k="type" checked> 类型</label>'+
              '<label><input type="checkbox" data-k="mod" checked> 模块</label>'+
            '</div>'+
            '<footer>'+
              '<button id="cdv-filter-all">全选</button> '+
              '<button id="cdv-filter-none">清空</button>'+ 
            '</footer>';
          host.appendChild(pop);
        }
        var key = cdvFilterKey();
        function load() {
          try { var raw = localStorage.getItem(key); if (!raw) return null; return JSON.parse(raw); } catch(_) { return null; }
        }
        function save(state) {
          try { localStorage.setItem(key, JSON.stringify(state)); } catch(_) {}
        }
        function readState() {
          var s = {};
          pop.querySelectorAll('input[type="checkbox"]').forEach(function(cb){ s[cb.getAttribute('data-k')] = cb.checked; });
          return s;
        }
        function writeState(s) {
          pop.querySelectorAll('input[type="checkbox"]').forEach(function(cb){ var k = cb.getAttribute('data-k'); cb.checked = s[k] !== false; });
        }
        function apply() {
          var s = readState();
          save(s);
          applyResultFilter(s);
        }
        var saved = load(); if (saved) writeState(saved);
        pop.addEventListener('change', function(ev){ if (ev.target && ev.target.matches('input[type="checkbox"]')) apply(); });
        var btnAll = pop.querySelector('#cdv-filter-all');
        var btnNone = pop.querySelector('#cdv-filter-none');
        if (btnAll) btnAll.addEventListener('click', function(){ pop.querySelectorAll('input[type="checkbox"]').forEach(function(cb){ cb.checked = true; }); apply(); });
        if (btnNone) btnNone.addEventListener('click', function(){ pop.querySelectorAll('input[type="checkbox"]').forEach(function(cb){ cb.checked = false; }); apply(); });
        btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); pop.classList.toggle('open'); });
        document.addEventListener('click', function(ev){ if (!pop.contains(ev.target) && ev.target !== btn) pop.classList.remove('open'); });
        // Observe search results
        installSearchResultsObserver(function(){ var s = load() || readState(); applyResultFilter(s); });
        // Initial attempt
        setTimeout(function(){ var s = load() || readState(); applyResultFilter(s); }, 300);
      } catch(_) {}
    })();
    

    // Chat panel
    if (!CDV_FLAGS.noChat && !document.getElementById('cdv-chat-panel')) {
      var panel = document.createElement('div');
      panel.id = 'cdv-chat-panel';
      panel.innerHTML = ''+
        '<div id="cdv-chat-header">LLM Chat</div>'+
        '<div id="cdv-chat-messages"></div>'+
        '<div id="cdv-chat-input-row">'+
          '<input id="cdv-chat-input" type="text" placeholder="Ask about this page…" />'+
          '<button id="cdv-chat-send">Send</button>'+
        '</div>';
      document.body.appendChild(panel);
    }

    var chatToggle = document.getElementById('cdv-chat-toggle');
    var chatPanel = document.getElementById('cdv-chat-panel');
    if (!CDV_FLAGS.noChat && chatToggle && chatPanel) {
      chatToggle.addEventListener('click', function() {
        chatPanel.classList.toggle('open');
      });
    }

    // We embed rustdoc's own search component inside the top bar

    function tryRustdocSearchRedirect(q) {
      // Attempt to find a link to search.html to compute root
      var a = document.querySelector('a[href$="search.html"], link[href$="search.html"]');
      if (a) {
        try {
          var href = a.getAttribute('href');
          var url = new URL(href, document.location.href);
          url.searchParams.set('q', q);
          window.location.href = url.href;
          return true;
        } catch (_) {}
      }
      // Try common relative locations
      var guesses = ['search.html', './search.html', '../search.html', '../../search.html'];
      for (var i=0;i<guesses.length;i++) {
        var g = guesses[i] + '?q=' + encodeURIComponent(q);
        // We cannot preflight without fetch; just navigate
        window.location.href = g;
        return true;
      }
      return false;
    }

    function tryProxyIntoExistingSearch(q) {
      // Find an existing search input from rustdoc
      var candidates = Array.prototype.slice.call(document.querySelectorAll('input[type="search"], #search, .search-input'));
      candidates = candidates.filter(function(el) { return !el.closest('#cdv-topbar'); });
      if (candidates.length > 0) {
        var el = candidates[0];
        try {
          var input = el.tagName.toLowerCase() === 'input' ? el : el.querySelector('input');
          if (input) {
            input.focus();
            input.value = q;
            input.dispatchEvent(new Event('input', {bubbles: true}));
            input.dispatchEvent(new Event('change', {bubbles: true}));
            // Some rustdoc requires opening the search UI via keybinding
            document.dispatchEvent(new KeyboardEvent('keydown', {key: 's', code: 'KeyS'}));
            return true;
          }
        } catch (_) {}
      }
      return false;
    }

    function pageFindFallback(q) {
      // Basic in-page find: jump to first occurrence
      var re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (re.test(node.nodeValue || '')) {
          var range = document.createRange();
          range.selectNodeContents(node.parentElement);
          var rect = range.getBoundingClientRect();
          window.scrollTo({top: window.scrollY + rect.top - 100, behavior: 'smooth'});
          return;
        }
      }
      alert('No matches found for: ' + q);
    }

    function integrateRustdocSearch() {
      try {
        if (CDV_FLAGS.noTop) return;
        var host = document.getElementById('cdv-search-host');
        if (!host) return;
        // Prefer existing rustdoc-search element
        var existing = document.querySelector('rustdoc-search');
        if (existing && existing.parentElement !== host) {
          host.appendChild(existing);
          return;
        }
        // Create one if missing
        if (!existing) {
          var rs = document.createElement('rustdoc-search');
          host.appendChild(rs);
        }
      } catch(_) {}
      // Retry after scripts initialize custom elements
      setTimeout(function(){
        try {
          var host = document.getElementById('cdv-search-host');
          if (!host) return;
          var existing = document.querySelector('rustdoc-search');
          if (existing && existing.parentElement !== host) host.appendChild(existing);
        } catch(_) {}
      }, 50);
    }

    function buildDocsHomeUrl(toCrate) {
      try {
        var meta = document.querySelector('meta[name="rustdoc-vars"]');
        var root = (meta && meta.dataset && meta.dataset.rootPath) || './';
        var crate = (meta && meta.dataset && meta.dataset.currentCrate) || '';
        // Prefer current crate index as "home" to avoid missing root index.html
        var primary = crate ? crate + '/index.html' : 'index.html';
        var fallback = 'index.html';
        var rel = toCrate ? primary : primary; // both default to crate index
        var url = new URL(root + rel, location.href);
        return url.href;
      } catch(_) {
        try { return new URL('index.html', location.href).href; } catch(_) { return null; }
      }
    }

    function buildCrateOverviewUrl() {
      try {
        var meta = document.querySelector('meta[name="rustdoc-vars"]');
        var root = (meta && meta.dataset && meta.dataset.rootPath) || './';
        // Navigate to our generated crate overview page
        var url = new URL(root + 'cdv-crate-overview.html', location.href);
        return url.href;
      } catch(_) {
        // If it fails for any reason, fall back to the crate home.
        return buildDocsHomeUrl(false);
      }
    }

    function cdvFilterKey() {
      try {
        var meta = document.querySelector('meta[name="rustdoc-vars"]');
        var root = (meta && meta.dataset && meta.dataset.rootPath) || './';
        var base = new URL(root, location.href);
        return 'cdv.search.filter::' + base.pathname;
      } catch(_) { return 'cdv.search.filter::' + location.pathname; }
    }

    function installSearchResultsObserver(cb) {
      try {
        var rs = document.querySelector('rustdoc-search'); if (!rs) return;
        var root = rs.shadowRoot || rs;
        var target = root; // observe entire component
        var mo = new MutationObserver(function(){ try { cb(); } catch(_) {} });
        mo.observe(target, {subtree:true, childList:true});
      } catch(_) {}
    }

    function applyResultFilter(state) {
      try {
        var rs = document.querySelector('rustdoc-search'); if (!rs) return;
        var root = rs.shadowRoot || rs;
        var anchors = root.querySelectorAll('a[href]');
        anchors.forEach(function(a){
          var href = a.getAttribute('href')||'';
          var kind = kindFromHref(href);
          var ok = !!state[kind];
          var li = a.closest('li') || a.parentElement;
          if (li) li.style.display = ok ? '' : 'none';
        });
      } catch(_) {}
    }

    function kindFromHref(href) {
      try {
        var u = new URL(href, location.href);
        var p = u.pathname.toLowerCase();
        var h = (u.hash||'').toLowerCase();
        if (/\/fn\./.test(p)) return 'fn';
        if (/\/struct\./.test(p)) return 'struct';
        if (/\/enum\./.test(p)) return 'enum';
        if (/\/trait\./.test(p)) return 'trait';
        if (/\/macro\./.test(p)) return 'macro';
        if (/\/constant\./.test(p)) return 'const';
        if (/\/type\./.test(p)) return 'type';
        if (/\/mod\./.test(p)) return 'mod';
        if (/#(method\.|tymethod\.|associatedfunction\.)/.test(h)) return 'method';
        return 'fn'; // default bucket
      } catch(_) { return 'fn'; }
    }

    // Add copy buttons to headings and highlight anchor targets
    (function setupAnchorsAndCopy(){
      try {
        var main = document.querySelector('main') || document.body;
        var hs = main.querySelectorAll('h1[id], h2[id], h3[id], h4[id]');
        hs.forEach(function(h){
          if (h.querySelector('.cdv-copy-anchor')) return;
          var id = h.getAttribute('id'); if (!id) return;
          var btn = document.createElement('button');
          btn.className = 'cdv-copy-anchor';
          btn.textContent = '复制链接';
          btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); copyAnchor(id); });
          h.appendChild(btn);
        });
        if (location.hash) markAnchorTarget(location.hash.slice(1));
        window.addEventListener('hashchange', function(){ markAnchorTarget(location.hash.slice(1)); });
      } catch(_) {}
      function copyAnchor(id){
        try {
          var url = new URL('#'+id, location.href).href;
          navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : document.execCommand('copy');
        } catch(_) {}
      }
      function markAnchorTarget(id){
        try {
          var el = document.getElementById(id); if (!el) return;
          el.classList.add('cdv-anchor-target');
          setTimeout(function(){ el.classList.remove('cdv-anchor-target'); }, 1500);
        } catch(_) {}
      }
    })();

    // Add copy buttons to code blocks
    (function setupCodeCopy(){
      try {
        var blocks = document.querySelectorAll('pre > code');
        blocks.forEach(function(code){
          var pre = code.parentElement; if (!pre) return;
          if (pre.querySelector('.cdv-copy-code')) return;
          var btn = document.createElement('button');
          btn.className = 'cdv-copy-code';
          btn.textContent = '复制';
          btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation();
            var text = code.innerText || code.textContent || '';
            try { navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : document.execCommand('copy'); } catch(_) {}
          });
          pre.appendChild(btn);
        });
      } catch(_) {}
    })();

    // Restore scroll position when returning, unless on a hash
    (function setupScrollMemory(){
      try {
        var key = 'cdv.scroll::' + location.pathname;
        if (!location.hash) {
          var y = parseInt(sessionStorage.getItem(key) || '0', 10);
          if (y > 0) setTimeout(function(){ window.scrollTo(0, y); }, 0);
        }
        var scheduled = false;
        window.addEventListener('scroll', function(){
          if (scheduled) return; scheduled=true;
          setTimeout(function(){ scheduled=false; try { sessionStorage.setItem(key, String(window.scrollY||window.pageYOffset||0)); } catch(_){} }, 200);
        });
      } catch(_) {}
    })();

    // Keyboard: previous/next section by headings
    (function setupHeadingNav(){
      function isTypingTarget(e){ var t = e.target; var n = (t && t.tagName||'').toLowerCase(); return n==='input'||n==='textarea'||t.isContentEditable; }
      function list(){ var m = document.querySelector('main')||document.body; return Array.prototype.slice.call(m.querySelectorAll('h2[id],h3[id],h4[id]')); }
      document.addEventListener('keydown', function(ev){
        if (isTypingTarget(ev)) return;
        if (ev.key === '[' || ev.key === ']') {
          var L = list(); if (!L.length) return;
          var curr = location.hash ? document.getElementById(location.hash.slice(1)) : null;
          var idx = curr ? L.indexOf(curr) : -1;
          if (ev.key === '[') idx = Math.max(0, idx-1); else idx = Math.min(L.length-1, idx+1);
          var target = L[idx]; if (!target) return;
          target.scrollIntoView({behavior:'smooth', block:'start'});
          var h = '#' + target.getAttribute('id');
          try { history.replaceState(null,'',h); } catch(_) { location.hash = h; }
          ev.preventDefault();
        }
      });
    })();

    function setupSearchHistory() {
      try {
        if (CDV_FLAGS.noTop) return;
        var host = document.getElementById('cdv-search-host');
        if (!host) return;
        var dropdown = document.getElementById('cdv-search-history');
        if (!dropdown) {
          dropdown = document.createElement('div');
          dropdown.id = 'cdv-search-history';
          host.appendChild(dropdown);
        }
        var input = document.getElementById('cdv-search-input');
        if (!input) { setTimeout(setupSearchHistory, 80); return; }

        function render(list, activeIdx) {
          var html = '';
          html += '<div class="cdv-hist-header"><span>搜索历史</span><button id="cdv-hist-clear" title="清空历史">清空</button></div>';
          if (!list || list.length === 0) {
            html += '<div class="cdv-hist-empty">暂无历史</div>';
          } else {
            for (var i=0;i<list.length;i++) {
              var cls = 'cdv-hist-item' + (i===activeIdx?' active':'');
              html += '<div class="'+cls+'" data-idx="'+i+'">'+escapeHtml(list[i])+'</div>';
            }
          }
          dropdown.innerHTML = html;
          var btn = dropdown.querySelector('#cdv-hist-clear');
          if (btn) btn.addEventListener('click', function(ev){ ev.preventDefault(); saveHistoryList([]); update(''); input.focus(); });
          dropdown.querySelectorAll('.cdv-hist-item').forEach(function(el){
            el.addEventListener('click', function(){ var i = +el.getAttribute('data-idx'); var list = loadHistoryList(); applyQuery(list[i]); });
          });
        }

        function applyQuery(q) {
          if (!input) return;
          try {
            input.focus();
            input.value = q;
            input.dispatchEvent(new Event('input', {bubbles:true}));
            // Trigger search via same flow as Enter
            saveHistory(q);
            if (!tryRustdocSearchRedirect(q)) {
              if (!tryProxyIntoExistingSearch(q)) {
                pageFindFallback(q);
              }
            }
          } catch(_) {}
          hide();
        }

        function update(filter) {
          var list = loadHistoryList();
          if (filter) {
            var f = filter.toLowerCase();
            list = list.filter(function(x){ return x.toLowerCase().indexOf(f) >= 0; });
          }
          render(list, -1);
        }

        function show() { dropdown.classList.add('open'); }
        function hide() { dropdown.classList.remove('open'); }

        var activeIdx = -1;
        function move(delta) {
          var items = dropdown.querySelectorAll('.cdv-hist-item');
          if (!items.length) return;
          activeIdx = (activeIdx + delta + items.length) % items.length;
          items.forEach(function(el, idx){ el.classList.toggle('active', idx===activeIdx); });
        }

        input.addEventListener('focus', function(){
          if (!input.value) { update(''); show(); }
        });
        input.addEventListener('input', function(){
          if (!input.value) { update(''); show(); }
          else { update(input.value); show(); }
        });
        input.addEventListener('keydown', function(ev){
          if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); return; }
          if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); return; }
          if (ev.key === 'Enter') {
            var items = dropdown.querySelectorAll('.cdv-hist-item');
            if (activeIdx >= 0 && activeIdx < items.length) {
              ev.preventDefault();
              var i = +items[activeIdx].getAttribute('data-idx');
              var list = loadHistoryList();
              applyQuery(list[i]);
              return;
            }
            // Save current query to history
            var q = (input.value || '').trim();
            if (q) saveHistory(q);
            hide();
          }
          if (ev.key === 'Escape') { hide(); }
        });

        document.addEventListener('click', function(ev){
          if (!dropdown.contains(ev.target) && ev.target !== input) hide();
        });

        // Initial render
        update('');
      } catch(_) {}
    }

    function findRustdocSearchInput() {
      try {
        var rs = document.querySelector('rustdoc-search');
        if (!rs) return null;
        var root = rs.shadowRoot || rs;
        var input = root.querySelector('input[type="search"], input');
        return input || null;
      } catch(_) { return null; }
    }

    function cdvHistoryKey() {
      try {
        var meta = document.querySelector('meta[name="rustdoc-vars"]');
        var rootPath = (meta && meta.dataset && meta.dataset.rootPath) || './';
        var crate = (meta && meta.dataset && meta.dataset.currentCrate) || '';
        var base = new URL(rootPath, location.href);
        return 'cdv.search.history::' + base.pathname + '::' + crate;
      } catch(_) { return 'cdv.search.history::' + location.pathname; }
    }

    function loadHistoryList() {
      try {
        var raw = localStorage.getItem(cdvHistoryKey());
        if (!raw) return [];
        var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; return [];
      } catch(_) { return []; }
    }

    function saveHistoryList(list) {
      try { localStorage.setItem(cdvHistoryKey(), JSON.stringify(list)); } catch(_) {}
    }

    function saveHistory(q) {
      var list = loadHistoryList();
      var idx = list.indexOf(q);
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(q);
      if (list.length > 20) list = list.slice(0, 20);
      saveHistoryList(list);
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[c]; });
    }

    // Build symbols list with categories
    function buildSymbols(into) {
      var cats = collectSymbols();
      var container = document.createElement('div');
      var header = document.createElement('b');
      header.textContent = '本页符号';
      container.appendChild(header);

      var order = [
        '方法', '必需方法', '提供的方法', 'Trait 方法', '关联函数', '关联常量', '关联类型',
        '字段', '变体', '实现', '章节'
      ];

      var totalItems = 0;
      order.forEach(function(catName) {
        var items = cats[catName] || [];
        if (!items.length) return;
        totalItems += items.length;
        var b = document.createElement('b');
        b.textContent = catName;
        container.appendChild(b);
        items.forEach(function(it) {
          var a = document.createElement('a');
          a.href = it.href;
          a.textContent = it.title;
          container.appendChild(a);
        });
      });

      if (totalItems === 0) {
        // Fallback to headings if no recognized symbols
        var main = document.querySelector('main') || document.querySelector('article') || document.body;
        var hs = main.querySelectorAll('h2[id], h3[id], h4[id]');
        if (hs.length === 0) {
          var p = document.createElement('div');
          p.style.opacity = '0.8';
          p.textContent = 'No symbols or headings found';
          container.appendChild(p);
        } else {
          var b = document.createElement('b');
          b.textContent = 'Sections';
          container.appendChild(b);
          hs.forEach(function(h) {
            var id = h.getAttribute('id');
            var a = document.createElement('a');
            a.href = '#' + id;
            a.textContent = h.textContent || id;
            container.appendChild(a);
          });
        }
      }

      into.innerHTML = '';
      into.appendChild(container);
    }

    function collectSymbols() {
      var map = {
        '方法': [],
        '必需方法': [],
        '提供的方法': [],
        'Trait 方法': [],
        '关联函数': [],
        '关联常量': [],
        '关联类型': [],
        '字段': [],
        '变体': [],
        '实现': [],
        '章节': []
      };

      var rules = [
        {cat: '方法', prefixes: ['method.']},
        // tymethod.* will be classified into required/provided by context later
        {cat: 'Trait 方法', prefixes: ['tymethod.']},
        {cat: '关联函数', prefixes: ['associatedfunction.', 'assocfn.', 'assoc-fn.']},
        {cat: '关联常量', prefixes: ['associatedconstant.', 'assocconst.', 'assoc-const.']},
        {cat: '关联类型', prefixes: ['associatedtype.', 'assoctype.', 'assoc-type.']},
        {cat: '字段', prefixes: ['structfield.', 'field.']},
        {cat: '变体', prefixes: ['variant.']},
        {cat: '实现', prefixes: ['impl-', 'impl.']}
      ];

      var seen = new Set();
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[id]'));
      nodes.forEach(function(n) {
        var id = n.id || '';
        if (!id) return;
        var idLower = id.toLowerCase();
        for (var i=0;i<rules.length;i++) {
          var prefList = rules[i].prefixes;
          for (var j=0;j<prefList.length;j++) {
            var pref = prefList[j];
            if (idLower.indexOf(pref) === 0) {
              var title = deriveTitleFromId(id, pref);
              if (!seen.has(id)) {
                map[rules[i].cat].push({href: '#' + id, title: title});
                seen.add(id);
              }
              return; // matched one category; skip others
            }
          }
        }
      });

      // Reclassify trait methods into required/provided when possible
      (function reclassifyTraitMethods(){
        var list = map['Trait 方法'].slice();
        map['Trait 方法'] = [];
        list.forEach(function(item){
          var id = (item.href || '').replace(/^#/, '');
          var cls = classifyTraitMethodByContext(id);
          if (cls === 'required') {
            map['必需方法'].push(item);
          } else if (cls === 'provided') {
            map['提供的方法'].push(item);
          } else {
            map['Trait 方法'].push(item);
          }
        });
      })();

      // Also collect headed sections as a distinct category
      var main = document.querySelector('main') || document.querySelector('article') || document.body;
      var hs = Array.prototype.slice.call(main.querySelectorAll('h2[id], h3[id], h4[id]'));
      hs.forEach(function(h) {
        var id = h.getAttribute('id');
        if (!id || seen.has(id)) return;
        var title = (h.textContent || id).trim();
        map['章节'].push({href: '#' + id, title: title});
        seen.add(id);
      });

      // Sort alphabetical within each category for predictability
      Object.keys(map).forEach(function(cat){
        map[cat].sort(function(a,b){ return a.title.localeCompare(b.title); });
      });
      return map;
    }

    function classifyTraitMethodByContext(id) {
      try {
        var el = document.getElementById(id);
        if (!el) return 'unknown';
        // Direct ancestor class hint
        var anc = el.closest && el.closest('.provided, .required');
        if (anc) {
          if (anc.classList.contains('provided')) return 'provided';
          if (anc.classList.contains('required')) return 'required';
        }
        // Nearest heading above
        var h = nearestHeadingAbove(el);
        var t = (h && (h.textContent || h.innerText) || '').toLowerCase();
        if (t.indexOf('required') >= 0 || t.indexOf('必需') >= 0) return 'required';
        if (t.indexOf('provided') >= 0 || t.indexOf('提供') >= 0 || t.indexOf('默认') >= 0) return 'provided';
        // Walk up a bit more to find a heading nearby
        var h2 = nearestHeadingAbove(el.parentElement || el);
        var t2 = (h2 && (h2.textContent || h2.innerText) || '').toLowerCase();
        if (t2.indexOf('required') >= 0 || t2.indexOf('必需') >= 0) return 'required';
        if (t2.indexOf('provided') >= 0 || t2.indexOf('提供') >= 0 || t2.indexOf('默认') >= 0) return 'provided';
      } catch(_) {}
      return 'unknown';
    }

    function nearestHeadingAbove(node) {
      var el = node;
      while (el) {
        var p = el;
        while (p.previousElementSibling) {
          p = p.previousElementSibling;
          if (/^H[1-6]$/i.test(p.tagName)) return p;
          if (p.querySelector) {
            var h = p.querySelector('h1,h2,h3,h4,h5,h6');
            if (h) return h;
          }
        }
        el = el.parentElement;
      }
      return null;
    }

    function deriveTitleFromId(id, prefix) {
      try {
        var rest = id.slice(prefix.length);
        var seg = rest.split(/[.]/)[0] || rest;
        try { seg = decodeURIComponent(seg); } catch(_) {}
        var nice = seg.replace(/_/g, '_');
        if (prefix.indexOf('impl') === 0) {
          nice = 'impl ' + rest;
        }
        return nice;
      } catch (_) {
        return id;
      }
    }

    // Build a compact function selector in the sidebar
    function buildFnSelect(into) {
      var items = collectFunctions();
      var wrap = document.createElement('div');
      wrap.id = 'cdv-fn-wrap';
      var label = document.createElement('span');
      label.id = 'cdv-fn-label';
      label.textContent = '本页函数';
      wrap.appendChild(label);
      var sel = document.createElement('select');
      sel.id = 'cdv-fn-select';
      var opts = '<option value="">选择函数…</option>';
      items.forEach(function(it){ opts += '<option value="'+it.href+'">'+it.title+'</option>'; });
      sel.innerHTML = opts;
      sel.addEventListener('change', function(){
        var v = sel.value; if (!v) return;
        try {
          var id = v.replace(/^#/, '');
          var el = document.getElementById(id);
          if (el) el.scrollIntoView({behavior:'smooth', block:'start'});
          if (location.hash !== v) {
            try { history.replaceState(null, '', v); } catch(_) { location.hash = v; }
          }
        } catch(_) {}
      });
      into.innerHTML = '';
      into.appendChild(wrap);
      wrap.appendChild(sel);
      if (items.length === 0) {
        label.textContent = '未找到本页函数';
        sel.style.display = 'none';
      }
    }

    function collectFunctions() {
      var picks = [];
      var seen = new Set();
      var rules = ['method.', 'tymethod.', 'associatedfunction.', 'function.', 'fn.'];
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[id]'));
      nodes.forEach(function(n){
        var id = n.id || ''; if (!id) return; var idLower = id.toLowerCase();
        for (var i=0;i<rules.length;i++) {
          var pref = rules[i];
          if (idLower.indexOf(pref) === 0) {
            if (!seen.has(id)) {
              picks.push({href:'#'+id, title: deriveTitleFromId(id, pref)});
              seen.add(id);
            }
            return;
          }
        }
      });
      picks.sort(function(a,b){ return a.title.localeCompare(b.title); });
      return picks;
    }

    // Build a compact function selector near the top search
    function setupFnDropdownTop() {
      try {
        if (CDV_FLAGS.noTop) return;
        var host = document.getElementById('cdv-search-host');
        if (!host) return;
        var sel = document.getElementById('cdv-fn-select-top');
        if (!sel) {
          sel = document.createElement('select');
          sel.id = 'cdv-fn-select-top';
          host.appendChild(sel);
          sel.addEventListener('change', function(){
            var v = sel.value; if (!v) return;
            try {
              var id = v.replace(/^#/, '');
              var el = document.getElementById(id);
              if (el) el.scrollIntoView({behavior:'smooth', block:'start'});
              location.hash = v;
            } catch(_) {}
          });
        }
        rebuildFnDropdownTop();
        installThrottledTopRebuilder();
      } catch(_) {}
    }

    function rebuildFnDropdownTop() {
      var sel = document.getElementById('cdv-fn-select-top');
      if (!sel) return;
      var items = collectFunctions();
      var opts = '<option value="">本页函数…</option>';
      items.forEach(function(it){ opts += '<option value="'+it.href+'">'+it.title+'</option>'; });
      sel.innerHTML = opts;
      sel.disabled = (items.length === 0);
    }

    function installThrottledTopRebuilder() {
      var scheduled = false;
      var host = document.getElementById('cdv-search-host');
      var topbar = document.getElementById('cdv-topbar');
      function schedule(){ if (scheduled) return; scheduled = true; setTimeout(function(){ scheduled=false; rebuildFnDropdownTop(); }, 120); }
      window.addEventListener('hashchange', schedule);
      try {
        var mo = new MutationObserver(function(muts){
          for (var i=0;i<muts.length;i++) {
            var t = muts[i].target;
            if ((host && host.contains(t)) || (topbar && topbar.contains(t))) return; // ignore our own UI changes
          }
          schedule();
        });
        mo.observe(document.body, {subtree:true, childList:true});
      } catch(_) {}
      window.addEventListener('load', schedule);
    }

    // Throttled rebuild helper to avoid infinite MutationObserver loops
    function installThrottledRebuilder(into) {
      var scheduled = false;
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function(){ scheduled = false; try { buildFnSelect(into); } catch(_){} }, 120);
      }
      window.addEventListener('hashchange', schedule);
      try {
        var mo = new MutationObserver(function(muts){
          // Ignore changes inside our own symbols container
          for (var i=0;i<muts.length;i++) {
            var t = muts[i].target;
            if (into.contains && into.contains(t)) return; // skip our own updates
          }
          schedule();
        });
        mo.observe(document.body, {subtree: true, childList: true});
      } catch(_) {}
      window.addEventListener('load', schedule);
    }

    // Sidebar injection is disabled; function dropdown moved next to top search
    (function setupSidebarSymbols(){ return; })();

    // Chat: simple retrieval over page content
    (function setupChat(){
      var sendBtn = document.getElementById('cdv-chat-send');
      var input = document.getElementById('cdv-chat-input');
      var messages = document.getElementById('cdv-chat-messages');
      if (!sendBtn || !input || !messages) return;

      function addMsg(text, who) {
        var div = document.createElement('div');
        div.className = 'cdv-msg ' + (who || 'assistant');
        div.textContent = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }

      function answer(q) {
        var main = document.querySelector('main') || document.body;
        var textNodes = [];
        var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          var t = (node.nodeValue || '').trim();
          if (t.length > 40) textNodes.push(t);
        }
        var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        function score(s) { return terms.reduce((acc, t) => acc + (s.toLowerCase().includes(t) ? 1 : 0), 0); }
        var best = textNodes.map(s => ({s, sc: score(s)})).filter(x => x.sc > 0).sort((a,b)=>b.sc-a.sc).slice(0,3);
        if (best.length === 0) {
          addMsg('I could not find relevant snippets. Try a different query.', 'assistant');
        } else {
          var reply = 'Based on this page, relevant snippets:\n\n' + best.map(x => '- ' + x.s.slice(0,240) + (x.s.length>240?'…':'')).join('\n');
          addMsg(reply, 'assistant');
        }
      }

      function send() {
        var q = input.value.trim();
        if (!q) return;
        addMsg(q, 'user');
        input.value = '';
        setTimeout(function(){ answer(q); }, 50);
      }

      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') send(); });
    })();
  } catch (e) {
    console && console.warn && console.warn('CDV inject error', e);
  }
})();
"#;
