use std::path::Path;

use crate::assets::{CDV_CSS, CDV_JS};

pub fn inject(content: &str) -> Option<String> {
    if content.contains("<!-- CDV: injected -->") {
        return None;
    }

    let mut modified = content.to_string();
    let mut did_modify = false;

    if let Some(idx) = modified.rfind("</head>") {
        let head_inject = format!(
            "<!-- CDV: injected -->\n<style id=\"cdv-style\">\n{}\n</style>\n",
            CDV_CSS
        );
        modified.insert_str(idx, &head_inject);
        did_modify = true;
    }

    if let Some(idx) = modified.rfind("</body>") {
        let body_inject = format!("<script id=\"cdv-script\">\n{}\n</script>\n", CDV_JS);
        let mut buffer = String::with_capacity(modified.len() + body_inject.len());
        buffer.push_str(&modified[..idx]);
        buffer.push_str(&body_inject);
        buffer.push_str(&modified[idx..]);
        modified = buffer;
        did_modify = true;
    }

    if did_modify { Some(modified) } else { None }
}

pub fn revert(content: &str) -> Option<String> {
    if !content.contains("cdv-style") && !content.contains("cdv-script") {
        return None;
    }

    let mut modified = content.to_string();
    if let Some(start) = modified.find("<style id=\"cdv-style\">") {
        if let Some(end_rel) = modified[start..].find("</style>") {
            let end = start + end_rel + "</style>".len();
            let end_with_newline = if modified.as_bytes().get(end).copied() == Some(b'\n') {
                end + 1
            } else {
                end
            };
            modified.replace_range(start..end_with_newline, "");
        }
    }

    if let Some(start) = modified.find("<script id=\"cdv-script\">") {
        if let Some(end_rel) = modified[start..].find("</script>") {
            let end = start + end_rel + "</script>".len();
            let end_with_newline = if modified.as_bytes().get(end).copied() == Some(b'\n') {
                end + 1
            } else {
                end
            };
            modified.replace_range(start..end_with_newline, "");
        }
    }

    let modified = modified
        .replace("<!-- CDV: injected -->\n", "")
        .replace("<!-- CDV: injected -->", "");

    if modified != content {
        Some(modified)
    } else {
        None
    }
}

pub fn should_skip_file(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        let name = name.to_lowercase();
        return matches!(
            name.as_str(),
            "search.html" | "settings.html" | "source-src.html" | "cdv-crate-overview.html"
        );
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_adds_assets_once() {
        let original = "<html><head><title>demo</title></head><body><h1>Hi</h1></body></html>";
        let first = inject(original).expect("first injection should modify");
        assert!(first.contains("<!-- CDV: injected -->"));
        assert!(first.contains("id=\"cdv-style\""));
        assert!(first.contains("id=\"cdv-script\""));

        assert!(
            inject(&first).is_none(),
            "second injection should be skipped"
        );
    }

    #[test]
    fn revert_restores_original_content() {
        let original = "<html><head></head><body></body></html>";
        let injected = inject(original).expect("should inject");
        let reverted = revert(&injected).expect("should revert");
        assert_eq!(reverted, original);
    }
}
