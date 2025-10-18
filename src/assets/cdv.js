
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

    (function registerServiceWorker(){
      try {
        if (!('serviceWorker' in navigator)) return;
        var proto = String(location.protocol || '');
        if (proto !== 'http:' && proto !== 'https:') return;
        var swUrl = new URL('cdv-sw.js', location.href);
        navigator.serviceWorker.register(swUrl.href, {scope: './'}).catch(function(err){
          console.warn('[CDV] Failed to register service worker:', err);
        });
      } catch (err) {
        console.warn('[CDV] Service worker registration error:', err);
      }
    })();

    var CDV_REFRESH_QUICK = function(){};
    var CDV_OUTLINE_STATE = {
      items: [],
      linkMap: Object.create(null),
      activeId: null,
      parentMap: Object.create(null),
      groupMap: Object.create(null),
      expandedMap: null
    };

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
      document.body.classList.add('cdv-has-topbar');
    }
    integrateRustdocSearch();
    setupFnDropdownTop();
    setupBreadcrumbs();
    setupOutline();
    setupQuickSearch();

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
        var nowOpen = !chatPanel.classList.contains('open');
        chatPanel.classList.toggle('open', nowOpen);
        document.body.classList.toggle('cdv-chat-open', nowOpen);
      });
      document.body.classList.toggle('cdv-chat-open', chatPanel.classList.contains('open'));
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

    function setupBreadcrumbs() {
      try {
        var source = document.querySelector('.main-heading .rustdoc-breadcrumbs');
        var titleEl = document.querySelector('.main-heading h1');
        if (!source && !titleEl) return;
        var host = document.getElementById('cdv-breadcrumbs');
        if (!host) {
          host = document.createElement('div');
          host.id = 'cdv-breadcrumbs';
          host.innerHTML = '<div class="cdv-breadcrumbs-inner"></div>';
          document.body.appendChild(host);
        }
        var inner = host.querySelector('.cdv-breadcrumbs-inner');
        if (!inner) {
          inner = document.createElement('div');
          inner.className = 'cdv-breadcrumbs-inner';
          host.appendChild(inner);
        }
        inner.innerHTML = '';
        var appended = false;
        if (source) {
          var links = Array.prototype.slice.call(source.querySelectorAll('a[href]'));
          links.forEach(function(link, idx){
            var text = (link.textContent || '').trim();
            if (!text) return;
            var a = document.createElement('a');
            a.href = link.href || link.getAttribute('href');
            a.textContent = text;
            inner.appendChild(a);
            appended = true;
            if (idx !== links.length - 1 || titleEl) {
              var sep = document.createElement('span');
              sep.className = 'cdv-sep';
              sep.textContent = '›';
              inner.appendChild(sep);
            }
          });
        }
        var currentTitle = extractHeadingTitle(titleEl);
        if (currentTitle) {
          var span = document.createElement('span');
          span.className = 'cdv-crumb-current';
          span.textContent = currentTitle;
          inner.appendChild(span);
          appended = true;
        }
        if (!appended) {
          host.remove();
        }
      } catch(_) {}
    }

    function setupOutline() {
      try {
        var outline = document.getElementById('cdv-outline');
        if (!outline) {
          outline = document.createElement('div');
          outline.id = 'cdv-outline';
          outline.innerHTML = ''+
            '<div id="cdv-outline-header">'+
              '<span>页面提纲</span>'+
              '<button id="cdv-outline-collapse">收起</button>'+ 
            '</div>'+
            '<div id="cdv-outline-content"></div>';
          document.body.appendChild(outline);
          var collapse = outline.querySelector('#cdv-outline-collapse');
          if (collapse) {
            collapse.addEventListener('click', function(){
              outline.classList.toggle('collapsed');
              collapse.textContent = outline.classList.contains('collapsed') ? '展开' : '收起';
            });
          }
        }
        rebuildOutline();
        installOutlineObservers(outline);
      } catch(_) {}
    }

    function setupQuickSearch() {
      try {
        var overlay = document.getElementById('cdv-quick-search');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'cdv-quick-search';
          overlay.innerHTML = ''+
            '<div id="cdv-quick-search-panel">'+
              '<input id="cdv-quick-search-input" type="search" placeholder="搜索本页 (Ctrl+K)" autocomplete="off" spellcheck="false" />'+
              '<div class="cdv-qs-hint">Esc 关闭 · ↑↓ 选择 · Enter 跳转</div>'+
              '<div id="cdv-quick-search-results"></div>'+
            '</div>';
          document.body.appendChild(overlay);
        }
        var panel = overlay.querySelector('#cdv-quick-search-panel');
        var input = overlay.querySelector('#cdv-quick-search-input');
        var resultsHost = overlay.querySelector('#cdv-quick-search-results');
        if (!panel || !input || !resultsHost) return;

        var activeIdx = -1;
        var searchIndex = buildQuickSearchIndex();

        function render(list) {
          resultsHost.innerHTML = '';
          if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'cdv-qs-empty';
            empty.textContent = input.value.trim() ? '未找到匹配项' : '输入关键字快速定位本页章节或函数';
            resultsHost.appendChild(empty);
            activeIdx = -1;
            return;
          }
          var frag = document.createDocumentFragment();
          list.forEach(function(entry, idx){
            var item = document.createElement('div');
            item.className = 'cdv-qs-item' + (idx === activeIdx ? ' active' : '');
            item.setAttribute('data-id', entry.id);
            item.innerHTML = '<strong>'+escapeHtml(entry.title)+'</strong>'+
              '<span>'+escapeHtml(entry.hint)+'</span>';
            item.addEventListener('click', function(){
              navigateToId(entry.id);
              closePalette();
            });
            frag.appendChild(item);
          });
          resultsHost.appendChild(frag);
        }

        var currentItems = [];

        function applyFilter(q) {
          q = (q || '').trim();
          activeIdx = -1;
          var list = searchEntries(searchIndex, q);
          render(list);
          currentItems = list;
        }

        function openPalette() {
          overlay.classList.add('open');
          document.body.classList.add('cdv-quick-search-open');
          applyFilter('');
          input.value = '';
          setTimeout(function(){ input.focus(); }, 10);
        }

        function closePalette() {
          overlay.classList.remove('open');
          document.body.classList.remove('cdv-quick-search-open');
          activeIdx = -1;
        }

        overlay.addEventListener('click', function(ev){ if (ev.target === overlay) closePalette(); });

        input.addEventListener('input', function(){ applyFilter(input.value); });
        input.addEventListener('keydown', function(ev){
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            if (!currentItems.length) return;
            activeIdx = (activeIdx + 1) % currentItems.length;
            updateActive();
            return;
          }
          if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (!currentItems.length) return;
            activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length;
            updateActive();
            return;
          }
          if (ev.key === 'Enter') {
            if (activeIdx >= 0 && activeIdx < currentItems.length) {
              ev.preventDefault();
              navigateToId(currentItems[activeIdx].id);
              closePalette();
            } else if (currentItems.length === 1) {
              navigateToId(currentItems[0].id);
              closePalette();
            }
            return;
          }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            closePalette();
          }
        });

        function updateActive() {
          var items = resultsHost.querySelectorAll('.cdv-qs-item');
          items.forEach(function(el, idx){ el.classList.toggle('active', idx === activeIdx); });
          if (activeIdx >= 0) {
            var activeEl = items[activeIdx];
            if (activeEl && activeEl.scrollIntoView) {
              activeEl.scrollIntoView({block:'nearest'});
            }
          }
        }

        document.addEventListener('keydown', function(ev){
          if (overlay.classList.contains('open')) {
            if (ev.key === 'Escape') { closePalette(); return; }
            if (ev.key === 'k' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); closePalette(); }
            return;
          }
          if (ev.defaultPrevented) return;
          if (ev.key === 'k' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            openPalette();
          } else if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
            var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement.isContentEditable) return;
            ev.preventDefault();
            openPalette();
          }
        });

        CDV_REFRESH_QUICK = function(){
          searchIndex = buildQuickSearchIndex();
          if (overlay.classList.contains('open')) {
            applyFilter(input.value);
          }
        };

        render([]);

      } catch(_) {}
    }

    function navigateToId(id) {
      try {
        if (!id) return;
        var el = document.getElementById(id);
        if (!el) return;
        scrollWithOffset(el);
        try {
          if (history.replaceState) {
            history.replaceState(null, '', '#' + id);
          } else {
            location.hash = id;
          }
        } catch(_) {
          location.hash = id;
        }
        highlightAnchorTarget(id);
      } catch(_) {}
    }

    function scrollWithOffset(el) {
      try {
        var rect = el.getBoundingClientRect();
        var topbarOffset = document.body.classList.contains('cdv-has-topbar') ? 70 : 32;
        var target = window.scrollY + rect.top - topbarOffset;
        if (target < 0) target = 0;
        window.scrollTo({top: target, behavior: 'smooth'});
      } catch(_) {
        try { el.scrollIntoView({behavior:'smooth', block:'start'}); } catch(__) {}
      }
    }

    function buildQuickSearchIndex() {
      var list = [];
      var seen = Object.create(null);
      var outlineItems = (CDV_OUTLINE_STATE.items && CDV_OUTLINE_STATE.items.length) ? CDV_OUTLINE_STATE.items : collectOutlineData();
      outlineItems.forEach(function(item){
        if (!item || !item.id) return;
        if (seen[item.id]) return;
        seen[item.id] = true;
        var hint = '章节 · H' + (item.level || 2);
        list.push(makeSearchEntry(item.id, item.title, hint));
      });
      try {
        collectFunctions().forEach(function(fn){
          if (!fn || !fn.href) return;
          var id = fn.href.replace(/^#/, '');
          if (!id || seen[id]) return;
          seen[id] = true;
          list.push(makeSearchEntry(id, fn.title || id, '函数'));
        });
      } catch(_) {}
      return list;
    }

    function makeSearchEntry(id, title, hint) {
      title = (title || '').trim();
      hint = (hint || '').trim();
      var entry = {
        id: id,
        title: title || id,
        hint: hint ? hint + ' · #' + id : '#' + id
      };
      entry.titleLower = entry.title.toLowerCase();
      entry.hintLower = entry.hint.toLowerCase();
      entry.searchText = entry.titleLower + ' ' + entry.hintLower + ' ' + id.toLowerCase();
      return entry;
    }

    function searchEntries(source, query) {
      if (!query) return source.slice(0, 40);
      var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return source.slice(0, 40);
      var scored = [];
      for (var i=0; i<source.length; i++) {
        var entry = source[i];
        var score = 0;
        for (var j=0; j<terms.length; j++) {
          var term = terms[j];
          if (entry.titleLower.startsWith(term)) score += 6;
          if (entry.titleLower.indexOf(term) >= 0) score += 4;
          if (entry.hintLower.indexOf(term) >= 0) score += 2;
          if (entry.searchText.indexOf(term) >= 0) score += 1;
        }
        if (score > 0) {
          scored.push({entry: entry, score: score});
        }
      }
      scored.sort(function(a, b){ return b.score - a.score; });
      return scored.slice(0, 40).map(function(x){ return x.entry; });
    }

    function collectOutlineData() {
      try {
        var main = document.querySelector('main') || document.body;
        if (!main) return [];
        var nodes = Array.prototype.slice.call(main.querySelectorAll('h1[id], h2[id], h3[id], h4[id]'));
        var seen = Object.create(null);
        var list = [];
        nodes.forEach(function(node){
          var id = node.getAttribute('id');
          if (!id || seen[id]) return;
          seen[id] = true;
          var title = extractHeadingTitle(node);
          if (!title) return;
          var level = parseInt(node.tagName.slice(1), 10);
          if (!level || level < 1) level = 2;
          list.push({ id: id, title: title, level: level, element: node });
        });
        return list;
      } catch(_) { return []; }
    }

    function extractHeadingTitle(node) {
      if (!node) return '';
      try {
        var clone = node.cloneNode(true);
        Array.prototype.slice.call(clone.querySelectorAll('button, .cdv-copy-anchor, #copy-path, rustdoc-toolbar, svg, .since, .out-of-band')).forEach(function(el){
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      } catch(_) {
        return (node.textContent || '').replace(/\s+/g, ' ').trim();
      }
    }

    function highlightAnchorTarget(id) {
      try {
        if (!id) return;
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add('cdv-anchor-target');
        setTimeout(function(){ try { el.classList.remove('cdv-anchor-target'); } catch(_) {} }, 1500);
      } catch(_) {}
    }

    function rebuildOutline() {
      try {
        var outline = document.getElementById('cdv-outline');
        if (!outline) return;
        var content = outline.querySelector('#cdv-outline-content');
        if (!content) return;
        var data = collectOutlineData();
        var map = Object.create(null);
        var parentMap = Object.create(null);
        var groupMap = Object.create(null);
        content.innerHTML = '';
        if (!data.length) {
          outline.style.display = 'none';
          CDV_OUTLINE_STATE.items = [];
          CDV_OUTLINE_STATE.linkMap = map;
          CDV_OUTLINE_STATE.activeId = null;
          CDV_OUTLINE_STATE.parentMap = parentMap;
          CDV_OUTLINE_STATE.groupMap = groupMap;
          CDV_REFRESH_QUICK();
          return;
        }
        outline.style.display = '';
        var tree = buildOutlineTree(data, parentMap);
        var expanded = getOutlineExpandedState();
        renderOutlineTree(tree, content, map, groupMap, expanded);
        CDV_OUTLINE_STATE.items = data;
        CDV_OUTLINE_STATE.linkMap = map;
        CDV_OUTLINE_STATE.parentMap = parentMap;
        CDV_OUTLINE_STATE.groupMap = groupMap;
        refreshOutlineActive(true);
        CDV_REFRESH_QUICK();
      } catch(_) {}
    }

    function refreshOutlineActive(force) {
      try {
        if (!CDV_OUTLINE_STATE.items || !CDV_OUTLINE_STATE.items.length) return;
        var threshold = window.scrollY + (document.body.classList.contains('cdv-has-topbar') ? 90 : 50);
        var current = CDV_OUTLINE_STATE.items[0];
        for (var i=0; i<CDV_OUTLINE_STATE.items.length; i++) {
          var item = CDV_OUTLINE_STATE.items[i];
          if (!item.element) continue;
          var top = item.element.getBoundingClientRect().top + window.scrollY;
          if (top - threshold <= 1) {
            current = item;
          } else {
            break;
          }
        }
        if (!current) current = CDV_OUTLINE_STATE.items[0];
        if (!current) return;
        if (!force && CDV_OUTLINE_STATE.activeId === current.id) return;
        CDV_OUTLINE_STATE.activeId = current.id;
        var map = CDV_OUTLINE_STATE.linkMap || {};
        for (var key in map) {
          if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
          var link = map[key];
          if (link && link.classList) link.classList.toggle('active', key === current.id);
        }
        ensureOutlineAncestorsExpanded(current.id);
      } catch(_) {}
    }

    var outlineObserverInstalled = false;
    function installOutlineObservers(outline) {
      if (outlineObserverInstalled) return;
      outlineObserverInstalled = true;
      try {
        var scheduled = false;
        function schedule() {
          if (scheduled) return;
          scheduled = true;
          setTimeout(function(){ scheduled = false; rebuildOutline(); }, 160);
        }
        var mo = new MutationObserver(function(muts){
          for (var i=0; i<muts.length; i++) {
            var target = muts[i].target;
            if (outline.contains(target)) continue;
            schedule();
            return;
          }
        });
        mo.observe(document.body, {subtree: true, childList: true});
      } catch(_) {}
      var scrollTick = false;
      window.addEventListener('scroll', function(){
        if (!CDV_OUTLINE_STATE.items.length) return;
        if (scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(function(){ scrollTick = false; refreshOutlineActive(false); });
      });
      window.addEventListener('hashchange', function(){ refreshOutlineActive(true); });
      window.addEventListener('load', function(){ refreshOutlineActive(true); });
      setTimeout(function(){ refreshOutlineActive(true); }, 200);
    }

    function buildOutlineTree(items, parentMap) {
      var roots = [];
      var stack = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var level = item.level;
        if (level < 2) level = 2;
        if (level > 4) level = 4;
        item.level = level;
        var node = { item: item, children: [] };
        while (stack.length && level <= stack[stack.length - 1].item.level) {
          stack.pop();
        }
        if (stack.length) {
          stack[stack.length - 1].children.push(node);
          parentMap[item.id] = stack[stack.length - 1].item.id;
        } else {
          roots.push(node);
        }
        stack.push(node);
      }
      return roots;
    }

    function renderOutlineTree(nodes, container, linkMap, groupMap, expandedState) {
      var frag = document.createDocumentFragment();
      nodes.forEach(function(node){
        var level = node.item.level;
        var hasChildren = node.children && node.children.length;
        if (hasChildren) {
          var group = document.createElement('div');
          group.className = 'cdv-outline-group level-' + level;
          var expanded = isOutlineExpanded(expandedState, node.item.id);
          if (expanded) {
            group.classList.add('expanded');
          } else {
            group.classList.add('collapsed');
          }
          var header = document.createElement('div');
          header.className = 'cdv-outline-group-header';
          var toggle = document.createElement('button');
          toggle.className = 'cdv-outline-toggle';
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          header.appendChild(toggle);
          var link = document.createElement('a');
          link.className = 'cdv-outline-item level-' + level;
          link.textContent = node.item.title;
          link.href = '#' + node.item.id;
          link.addEventListener('click', function(ev){
            ev.preventDefault();
            if (group.classList.contains('collapsed')) {
              group.classList.add('expanded');
              group.classList.remove('collapsed');
              toggle.setAttribute('aria-expanded', 'true');
              setOutlineExpanded(expandedState, node.item.id, true);
              saveOutlineExpanded(expandedState);
            }
            navigateToId(node.item.id);
          });
          header.appendChild(link);
          group.appendChild(header);
          var childrenContainer = document.createElement('div');
          childrenContainer.className = 'cdv-outline-children';
          renderOutlineTree(node.children, childrenContainer, linkMap, groupMap, expandedState);
          group.appendChild(childrenContainer);
          frag.appendChild(group);
          linkMap[node.item.id] = link;
          groupMap[node.item.id] = group;
          toggle.addEventListener('click', function(ev){
            ev.preventDefault();
            ev.stopPropagation();
            var nowExpanded = !group.classList.contains('expanded');
            group.classList.toggle('expanded', nowExpanded);
            group.classList.toggle('collapsed', !nowExpanded);
            toggle.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
            setOutlineExpanded(expandedState, node.item.id, nowExpanded);
            saveOutlineExpanded(expandedState);
          });
        } else {
          var link = document.createElement('a');
          link.className = 'cdv-outline-item level-' + level;
          link.textContent = node.item.title;
          link.href = '#' + node.item.id;
          link.addEventListener('click', function(ev){
            ev.preventDefault();
            navigateToId(node.item.id);
          });
          frag.appendChild(link);
          linkMap[node.item.id] = link;
        }
      });
      container.appendChild(frag);
    }

    function outlineExpandStorageKey() {
      try {
        var meta = document.querySelector('meta[name=\"rustdoc-vars\"]');
        var root = (meta && meta.dataset && meta.dataset.rootPath) || './';
        var crate = (meta && meta.dataset && meta.dataset.currentCrate) || '';
        return 'cdv.outline.expand::' + root + '::' + crate;
      } catch(_) {
        return 'cdv.outline.expand::' + location.pathname;
      }
    }

    function loadOutlineExpanded() {
      var map = Object.create(null);
      try {
        var raw = localStorage.getItem(outlineExpandStorageKey());
        if (!raw) return map;
        var list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) {
            var id = list[i];
            if (typeof id === 'string' && id) {
              map[id] = 1;
            }
          }
        }
      } catch(_) {}
      return map;
    }

    function saveOutlineExpanded(map) {
      try {
        var list = [];
        for (var key in map) {
          if (Object.prototype.hasOwnProperty.call(map, key)) {
            list.push(key);
          }
        }
        localStorage.setItem(outlineExpandStorageKey(), JSON.stringify(list));
      } catch(_) {}
    }

    function getOutlineExpandedState() {
      if (!CDV_OUTLINE_STATE.expandedMap) {
        CDV_OUTLINE_STATE.expandedMap = loadOutlineExpanded();
      }
      return CDV_OUTLINE_STATE.expandedMap;
    }

    function isOutlineExpanded(map, id) {
      return !!(map && Object.prototype.hasOwnProperty.call(map, id));
    }

    function setOutlineExpanded(map, id, expanded) {
      if (!map) return;
      if (expanded) {
        map[id] = 1;
      } else {
        delete map[id];
      }
    }

    function ensureOutlineAncestorsExpanded(id) {
      try {
        if (!id) return;
        var parentMap = CDV_OUTLINE_STATE.parentMap || {};
        var groupMap = CDV_OUTLINE_STATE.groupMap || {};
        var expanded = getOutlineExpandedState();
        var changed = false;
        var current = parentMap[id];
        var guard = 0;
        while (current && guard++ < 32) {
          if (!isOutlineExpanded(expanded, current)) {
            setOutlineExpanded(expanded, current, true);
            changed = true;
          }
          var group = groupMap[current];
          if (group && group.classList) {
            if (!group.classList.contains('expanded')) {
              group.classList.add('expanded');
              group.classList.remove('collapsed');
              var toggle = group.querySelector('.cdv-outline-toggle');
              if (toggle) toggle.setAttribute('aria-expanded', 'true');
            }
          }
          current = parentMap[current];
        }
        if (changed) {
          saveOutlineExpanded(expanded);
        }
      } catch(_) {}
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
      function markAnchorTarget(id){ highlightAnchorTarget(id); }
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
          navigateToId(id);
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
              navigateToId(id);
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
          var outline = document.getElementById('cdv-outline');
          var crumbs = document.getElementById('cdv-breadcrumbs');
          var quick = document.getElementById('cdv-quick-search');
          for (var i=0;i<muts.length;i++) {
            var t = muts[i].target;
            if ((host && host.contains(t)) || (topbar && topbar.contains(t))) continue;
            if (outline && outline.contains(t)) continue;
            if (crumbs && crumbs.contains(t)) continue;
            if (quick && quick.contains(t)) continue;
            schedule();
            return;
          }
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
