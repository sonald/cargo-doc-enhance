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

    let mut files_processed = 0usize;
    let mut files_skipped = 0usize;
    match walk_and_process(&doc_dir, revert, &mut files_processed, &mut files_skipped) {
        Ok(()) => {
            if revert {
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
            "source-src.html"
        );
    }
    false
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
#cdv-search-host { flex: 1; min-width: 120px; display: flex; align-items: center; position: relative; }
#cdv-search-host rustdoc-search { width: 100%; }
#cdv-search-history { position: absolute; top: 36px; left: 0; right: 0; background: var(--cdv-bg); color: var(--cdv-fg); border: 1px solid var(--cdv-border); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.35); max-height: 50vh; overflow: auto; display: none; z-index: 10000; }
#cdv-search-history.open { display: block; }
#cdv-search-history .cdv-hist-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--cdv-border); font-size: 12px; opacity: 0.9; }
#cdv-hist-clear { background: transparent; border: 1px solid var(--cdv-border); color: var(--cdv-fg); border-radius: 4px; padding: 2px 6px; cursor: pointer; }
#cdv-search-history .cdv-hist-item { padding: 6px 10px; cursor: pointer; }
#cdv-search-history .cdv-hist-item:hover, #cdv-search-history .cdv-hist-item.active { background: rgba(255,255,255,0.08); }
#cdv-search-history .cdv-hist-empty { padding: 8px 10px; opacity: 0.7; }
#cdv-chat-toggle {
  height: 32px; padding: 0 10px; border: 1px solid var(--cdv-border);
  border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--cdv-fg);
  cursor: pointer;
}

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
#cdv-symbols { padding: 8px; }
#cdv-symbols b { display: block; margin-bottom: 6px; font-size: 12px; opacity: 0.8; }
#cdv-symbols a { display: block; color: var(--cdv-fg); text-decoration: none; padding: 4px 6px; border-radius: 4px; }
#cdv-symbols a:hover { background: rgba(255,255,255,0.08); }

/* Fallback overlay for symbols list if no sidebar detected */
#cdv-symbols-overlay {
  position: fixed; left: 0; bottom: 0; width: 320px; height: 35vh; z-index: 9997;
  background: var(--cdv-bg); color: var(--cdv-fg);
  border-top: 1px solid var(--cdv-border); border-right: 1px solid var(--cdv-border);
  box-shadow: 0 -4px 12px rgba(0,0,0,0.25);
}
#cdv-symbols-overlay-header { padding: 8px 10px; border-bottom: 1px solid var(--cdv-border); font-weight: 600; }
#cdv-symbols-overlay-body { height: calc(100% - 40px); overflow: auto; padding: 8px; }
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
        '<div id="cdv-search-host"></div>' +
        '<button id="cdv-chat-toggle" title="Ask AI about this page">AI Chat</button>';
      document.body.appendChild(bar);
    }
    integrateRustdocSearch();
    setupSearchHistory();

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

    // We embed the original rustdoc-search component; no separate input needed.

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
        var input = findRustdocSearchInput();
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
            // Simulate Enter to trigger navigation if rustdoc expects it
            input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
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

    // Throttled rebuild helper to avoid infinite MutationObserver loops
    function installThrottledRebuilder(into) {
      var scheduled = false;
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function(){ scheduled = false; try { buildSymbols(into); } catch(_){} }, 120);
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

    // Try to enhance the existing sidebar (non-destructive)
    (function setupSidebarSymbols(){
      if (CDV_FLAGS.noSymbols) return;
      var side = document.querySelector('nav.sidebar, .sidebar, #sidebar');
      if (side) {
        if (!side.classList.contains('cdv-sidebar-ready')) {
          side.classList.add('cdv-sidebar-ready');
          var bottom = side.querySelector('.cdv-symbols-bottom');
          if (!bottom) {
            bottom = document.createElement('div');
            bottom.className = 'cdv-symbols-bottom';
            bottom.innerHTML = '<div id="cdv-symbols"></div>';
            side.appendChild(bottom);
          }
          var into = bottom.querySelector('#cdv-symbols');
          if (into) buildSymbols(into);
          // Rebuild when hash changes or DOM updates (throttled, ignore our own updates)
          installThrottledRebuilder(into);
          setTimeout(function(){ buildSymbols(into); }, 300);
          return;
        }
      }
      // Fallback overlay
      if (!document.getElementById('cdv-symbols-overlay')) {
        var ov = document.createElement('div');
        ov.id = 'cdv-symbols-overlay';
        ov.innerHTML = '<div id="cdv-symbols-overlay-header">Symbols</div><div id="cdv-symbols-overlay-body"><div id="cdv-symbols"></div></div>';
        document.body.appendChild(ov);
        var into = ov.querySelector('#cdv-symbols');
        if (into) buildSymbols(into);
        installThrottledRebuilder(into);
        setTimeout(function(){ buildSymbols(into); }, 300);
      }
    })();

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
