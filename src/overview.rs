use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct CrateInfo {
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub path: String,
}

pub fn generate_overview_page(doc_dir: &Path) -> io::Result<()> {
    let crates = scan_crates(doc_dir)?;
    let html = generate_overview_html(&crates);
    let overview_path = doc_dir.join("cdv-crate-overview.html");
    let mut file = fs::File::create(overview_path)?;
    file.write_all(html.as_bytes())?;
    Ok(())
}

pub fn remove_overview_page(doc_dir: &Path) -> io::Result<()> {
    let overview_path = doc_dir.join("cdv-crate-overview.html");
    if overview_path.exists() {
        fs::remove_file(overview_path)?;
    }
    Ok(())
}

pub fn scan_crates(doc_dir: &Path) -> io::Result<Vec<CrateInfo>> {
    let mut crates = Vec::new();

    for entry in fs::read_dir(doc_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            let index_path = path.join("index.html");
            if index_path.exists() {
                if let Some(dir_name) = path.file_name().and_then(|s| s.to_str()) {
                    if matches!(
                        dir_name,
                        "static.files" | "src" | "implementors" | "help.html"
                    ) {
                        continue;
                    }

                    let crate_info = extract_crate_info(dir_name, &index_path)?;
                    crates.push(crate_info);
                }
            }
        }
    }

    crates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(crates)
}

fn extract_crate_info(dir_name: &str, index_path: &Path) -> io::Result<CrateInfo> {
    let mut content = String::new();
    fs::File::open(index_path)?.read_to_string(&mut content)?;

    let description =
        extract_description(&content).unwrap_or_else(|| "Rust crate documentation".to_string());
    let version = extract_version(&content);

    Ok(CrateInfo {
        name: dir_name.to_string(),
        description,
        version,
        path: format!("{}/index.html", dir_name),
    })
}

fn extract_description(html: &str) -> Option<String> {
    if let Some(start) = html.find("<meta name=\"description\" content=\"") {
        let content_start = start + "<meta name=\"description\" content=\"".len();
        if let Some(end) = html[content_start..].find('\"') {
            return Some(html[content_start..content_start + end].to_string());
        }
    }

    if let Some(start) = html.find("<div class=\"docblock\">") {
        let content_start = start + "<div class=\"docblock\">".len();
        if let Some(p_start) = html[content_start..].find("<p>") {
            let p_content_start = content_start + p_start + "<p>".len();
            if let Some(p_end) = html[p_content_start..].find("</p>") {
                let text = html[p_content_start..p_content_start + p_end].to_string();
                return Some(strip_html_tags(&text));
            }
        }
    }

    None
}

fn extract_version(html: &str) -> Option<String> {
    if let Some(start) = html.find("<title>") {
        let title_start = start + "<title>".len();
        if let Some(end) = html[title_start..].find("</title>") {
            let title = &html[title_start..title_start + end];
            if let Some(dash_pos) = title.rfind('-') {
                let potential_version = &title[dash_pos + 1..];
                if potential_version
                    .chars()
                    .next()
                    .map_or(false, |c| c.is_ascii_digit())
                {
                    return Some(potential_version.to_string());
                }
            }
        }
    }

    None
}

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

    result
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .trim()
        .to_string()
}

pub fn generate_overview_html(crates: &[CrateInfo]) -> String {
    let cards_html = crates
        .iter()
        .map(generate_crate_card_html)
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<!DOCTYPE html>
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
            </div>"#
                .to_string()
        } else {
            format!(r#"<div class="crates-grid">{}</div>"#, cards_html)
        }
    )
}

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
        version = crate_info
            .version
            .as_ref()
            .map(|v| format!(r#"<span class="crate-version">v{}</span>"#, v))
            .unwrap_or_default(),
        description = if crate_info.description.is_empty() {
            "Rust crate documentation".to_string()
        } else {
            crate_info.description.clone()
        }
    )
}
