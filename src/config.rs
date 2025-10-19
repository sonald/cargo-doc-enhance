use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

static APP_CONFIG: Lazy<AppConfig> = Lazy::new(AppConfig::load);
static BOOTSTRAP_ASSIGNMENT: Lazy<String> = Lazy::new(build_bootstrap_assignment);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub api: ApiConfig,
    pub prompts: PromptConfig,
    pub context: ContextConfig,
    pub ui: UiConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ApiConfig {
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PromptConfig {
    pub system: String,
    pub environment_template: String,
    pub fallback_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ContextConfig {
    pub history_window: usize,
    pub page_tokens_budget: usize,
    pub debounce_ms: u64,
    pub sanitize_patterns: Vec<SanitizePattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SanitizePattern {
    pub regex: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub language: String,
    pub show_context_preview: bool,
    pub allow_prompt_edit: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api: ApiConfig::default(),
            prompts: PromptConfig::default(),
            context: ContextConfig::default(),
            ui: UiConfig::default(),
        }
    }
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            timeout_ms: 15_000,
            headers: BTreeMap::new(),
        }
    }
}

impl Default for PromptConfig {
    fn default() -> Self {
        Self {
            system: "You are Cargo Doc Viewer’s AI assistant. Provide clear, concise answers grounded in the supplied Rust documentation context. If the context is insufficient, ask for clarification instead of guessing.".to_string(),
            environment_template: "Crate: {{crate.name}}\nModule: {{page.module_path}}\nRust Edition: {{environment.edition}}\nAvailable Features: {{environment.features}}\n".to_string(),
            fallback_language: "auto".to_string(),
        }
    }
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            history_window: 6,
            page_tokens_budget: 1_200,
            debounce_ms: 300,
            sanitize_patterns: vec![SanitizePattern::default()],
        }
    }
}

impl Default for SanitizePattern {
    fn default() -> Self {
        Self {
            regex: "(?i)apikey=[A-Za-z0-9_-]+".to_string(),
            replacement: "[redacted]".to_string(),
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            language: "auto".to_string(),
            show_context_preview: true,
            allow_prompt_edit: true,
        }
    }
}

impl AppConfig {
    fn load() -> Self {
        let path = config_path();

        match fs::read_to_string(&path) {
            Ok(raw) => match serde_yaml::from_str::<AppConfig>(&raw) {
                Ok(mut cfg) => {
                    let env_map = EnvSource::new(&path);
                    cfg.resolve_env(&env_map);
                    cfg.normalize();
                    cfg
                }
                Err(err) => {
                    eprintln!(
                        "cargo-doc-viewer: Failed to parse config at {}: {err}",
                        path.display()
                    );
                    AppConfig::default()
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                if let Err(write_err) = write_default_template(&path) {
                    eprintln!(
                        "cargo-doc-viewer: Unable to create default config at {}: {write_err}",
                        path.display()
                    );
                } else {
                    eprintln!(
                        "cargo-doc-viewer: Created AI chat config template at {}",
                        path.display()
                    );
                }
                AppConfig::default()
            }
            Err(err) => {
                eprintln!(
                    "cargo-doc-viewer: Unable to read config at {}: {err}",
                    path.display()
                );
                AppConfig::default()
            }
        }
    }

    fn normalize(&mut self) {
        if self.api.base_url.trim().is_empty() {
            self.api.base_url = ApiConfig::default().base_url;
        } else {
            self.api.base_url = self.api.base_url.trim().to_string();
        }
        if self.api.model.trim().is_empty() {
            self.api.model = ApiConfig::default().model;
        } else {
            self.api.model = self.api.model.trim().to_string();
        }
        if self.api.timeout_ms == 0 {
            self.api.timeout_ms = ApiConfig::default().timeout_ms;
        }

        if self.prompts.system.trim().is_empty() {
            self.prompts.system = PromptConfig::default().system;
        }
        if self.prompts.environment_template.trim().is_empty() {
            self.prompts.environment_template = PromptConfig::default().environment_template;
        }
        if self.prompts.fallback_language.trim().is_empty() {
            self.prompts.fallback_language = PromptConfig::default().fallback_language;
        } else {
            self.prompts.fallback_language = self.prompts.fallback_language.trim().to_string();
        }

        if self.context.history_window == 0 {
            self.context.history_window = ContextConfig::default().history_window;
        }
        if self.context.page_tokens_budget == 0 {
            self.context.page_tokens_budget = ContextConfig::default().page_tokens_budget;
        }
        if self.context.debounce_ms == 0 {
            self.context.debounce_ms = ContextConfig::default().debounce_ms;
        }
        if self.context.sanitize_patterns.is_empty() {
            self.context.sanitize_patterns = ContextConfig::default().sanitize_patterns;
        } else {
            for pattern in &mut self.context.sanitize_patterns {
                if pattern.regex.trim().is_empty() {
                    pattern.regex = SanitizePattern::default().regex;
                }
            }
        }

        if self.ui.language.trim().is_empty() {
            self.ui.language = UiConfig::default().language;
        } else {
            self.ui.language = self.ui.language.trim().to_string();
        }
    }
}

impl AppConfig {
    fn resolve_env(&mut self, source: &EnvSource) {
        resolve_string(&mut self.api.base_url, "api.base_url", source);
        resolve_string(&mut self.api.model, "api.model", source);
        for (key, value) in self.api.headers.iter_mut() {
            resolve_string(value, &format!("api.headers.{key}"), source);
        }

        resolve_string(&mut self.prompts.system, "prompts.system", source);
        resolve_string(
            &mut self.prompts.environment_template,
            "prompts.environment_template",
            source,
        );
        resolve_string(
            &mut self.prompts.fallback_language,
            "prompts.fallback_language",
            source,
        );

        for pattern in &mut self.context.sanitize_patterns {
            resolve_string(
                &mut pattern.regex,
                "context.sanitize_patterns.regex",
                source,
            );
            resolve_string(
                &mut pattern.replacement,
                "context.sanitize_patterns.replacement",
                source,
            );
        }

        resolve_string(&mut self.ui.language, "ui.language", source);
    }
}

pub fn app_config() -> &'static AppConfig {
    &APP_CONFIG
}

pub fn bootstrap_assignment() -> &'static str {
    BOOTSTRAP_ASSIGNMENT.as_str()
}

pub fn config_path() -> PathBuf {
    if let Ok(path) = env::var("CDV_CONFIG_PATH") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }
    default_config_path()
}

fn default_config_path() -> PathBuf {
    dirs::home_dir()
        .map(|mut dir| {
            dir.push(".cargo-doc-viewer");
            dir.push("config.yaml");
            dir
        })
        .unwrap_or_else(|| PathBuf::from(".cargo-doc-viewer/config.yaml"))
}

fn write_default_template(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = File::create(path)?;
    file.write_all(DEFAULT_CONFIG_TEMPLATE.as_bytes())?;
    Ok(())
}

fn build_bootstrap_assignment() -> String {
    let payload = BootstrapPayload {
        version: env!("CARGO_PKG_VERSION"),
        config_path: config_path().display().to_string(),
        config: app_config(),
    };

    let json = match serde_json::to_string(&payload) {
        Ok(data) => data,
        Err(err) => {
            eprintln!("cargo-doc-viewer: Failed to serialise config: {err}");
            "{}".to_string()
        }
    };

    let safe_json = escape_json_for_script(&json);
    format!("window.__CDV_BOOTSTRAP__ = {safe_json};")
}

fn escape_json_for_script(json: &str) -> String {
    json.replace("</", "<\\/")
}

#[derive(Serialize)]
struct BootstrapPayload<'a> {
    version: &'static str,
    config_path: String,
    config: &'a AppConfig,
}

const DEFAULT_CONFIG_TEMPLATE: &str = r#"# Cargo Doc Viewer AI chat configuration
# Automatically generated on first launch. Update the values to match your environment.
# You can reference environment variables via $VAR or ${VAR}. Values are resolved
# from the process environment, a .env file next to this config, then the current
# working directory, and finally $HOME/.env when the tool launches.
api:
  base_url: https://api.openai.com/v1
  model: gpt-4.1-mini
  timeout_ms: 15000
  headers: {}
prompts:
  system: |-
    You are Cargo Doc Viewer’s AI assistant. Provide clear, concise answers grounded in the supplied Rust documentation context. If the context is insufficient, ask for clarification instead of guessing.
  environment_template: |-
    Crate: {{crate.name}}
    Module: {{page.module_path}}
    Rust Edition: {{environment.edition}}
    Available Features: {{environment.features}}
  fallback_language: auto
context:
  history_window: 6
  page_tokens_budget: 1200
  debounce_ms: 300
  sanitize_patterns:
    - regex: "(?i)apikey=[A-Za-z0-9_-]+"
      replacement: "[redacted]"
ui:
  language: auto
  show_context_preview: true
  allow_prompt_edit: true
"#;

struct EnvSource {
    vars: HashMap<String, String>,
}

impl EnvSource {
    fn new(config_path: &Path) -> Self {
        let mut vars: HashMap<String, String> = env::vars().collect();

        Self::merge_env_file(config_path.parent(), &mut vars);
        Self::merge_env_file(env::current_dir().ok().as_deref(), &mut vars);
        Self::merge_env_file(dirs::home_dir().as_deref(), &mut vars);

        Self { vars }
    }

    fn lookup(&self, key: &str) -> Option<&str> {
        self.vars.get(key).map(|s| s.as_str())
    }

    fn merge_env_file(dir: Option<&Path>, vars: &mut HashMap<String, String>) {
        let Some(dir) = dir else {
            return;
        };
        let env_path = dir.join(".env");
        if let Ok(iter) = dotenvy::from_path_iter(&env_path) {
            for item in iter.flatten() {
                if !vars.contains_key(&item.0) {
                    vars.insert(item.0, item.1);
                }
            }
        }
    }
}

fn resolve_string(value: &mut String, field: &str, env: &EnvSource) {
    let trimmed = value.trim();
    if let Some(name) = extract_env_ref(trimmed) {
        if let Some(resolved) = env.lookup(name) {
            *value = resolved.to_string();
        } else {
            eprintln!(
                "cargo-doc-viewer: Environment placeholder ${name} for {field} not found; leaving empty."
            );
            value.clear();
        }
    }
}

fn extract_env_ref(value: &str) -> Option<&str> {
    if let Some(rest) = value.strip_prefix("${") {
        return rest.strip_suffix('}');
    }
    if let Some(rest) = value.strip_prefix('$') {
        if rest.chars().all(is_valid_env_char) && !rest.is_empty() {
            return Some(rest);
        }
    }
    None
}

fn is_valid_env_char(c: char) -> bool {
    matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_json_handles_script_closers() {
        let raw = r#"{"text":"</script><script>"}"#;
        let escaped = escape_json_for_script(raw);
        assert!(escaped.contains("<\\/script>"));
        assert!(!escaped.contains("</script>"));
    }

    #[test]
    fn resolves_env_placeholders() {
        let mut cfg = AppConfig::default();
        cfg.api.base_url = "$API_URL".to_string();
        cfg.api.model = "${API_MODEL}".to_string();
        cfg.api
            .headers
            .insert("Authorization".to_string(), "$TOKEN".to_string());

        let env = EnvSource {
            vars: HashMap::from([
                ("API_URL".to_string(), "https://example.com".to_string()),
                ("API_MODEL".to_string(), "gpt-test".to_string()),
                ("TOKEN".to_string(), "abc123".to_string()),
            ]),
        };

        cfg.resolve_env(&env);

        assert_eq!(cfg.api.base_url, "https://example.com");
        assert_eq!(cfg.api.model, "gpt-test");
        assert_eq!(cfg.api.headers.get("Authorization").unwrap(), "abc123");
    }
}
