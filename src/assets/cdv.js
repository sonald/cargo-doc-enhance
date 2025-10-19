
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

    var CDV_BOOTSTRAP = (function(){
      try {
        var data = window.__CDV_BOOTSTRAP__ || {};
        if (!data || typeof data !== 'object') data = {};
        if (!data.config || typeof data.config !== 'object') data.config = {};
        if (!('config_path' in data) && typeof data.configPath === 'string') {
          data.config_path = data.configPath;
        }
        if (typeof data.version !== 'string') {
          data.version = '0.0.0';
        }
        return data;
      } catch (_) {
        return {config:{}, version:'0.0.0', config_path:''};
      }
    })();

    (function registerServiceWorker(){
      try {
        if (!('serviceWorker' in navigator)) return;
        var proto = String(location.protocol || '');
        if (proto !== 'http:' && proto !== 'https:') return;
        var swUrl = location.origin + '/cdv-sw.js';
        navigator.serviceWorker.register(swUrl, {scope: location.origin + '/'}).catch(function(err){
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

    var CDV_ANCHOR_HISTORY = (function(){
      var entries = [];
      var index = -1;
      var maxEntries = 80;
      var backBtn = null;
      var forwardBtn = null;
      var suppressHash = false;
      var initialized = false;

      function ensureButtons() {
        var maybeBack = document.getElementById('cdv-anchor-back');
        var maybeForward = document.getElementById('cdv-anchor-forward');
        if (maybeBack && maybeBack !== backBtn) {
          backBtn = maybeBack;
          if (!backBtn.__cdvAnchorInit) {
            backBtn.__cdvAnchorInit = true;
            backBtn.addEventListener('click', function(ev){
              ev.preventDefault();
              go(-1);
            });
          }
        }
        if (maybeForward && maybeForward !== forwardBtn) {
          forwardBtn = maybeForward;
          if (!forwardBtn.__cdvAnchorInit) {
            forwardBtn.__cdvAnchorInit = true;
            forwardBtn.addEventListener('click', function(ev){
              ev.preventDefault();
              go(1);
            });
          }
        }
      }

      function updateButtons() {
        ensureButtons();
        var canBack = index > 0;
        var canForward = index >= 0 && index < entries.length - 1;
        if (backBtn) {
          backBtn.disabled = !canBack;
        }
        if (forwardBtn) {
          forwardBtn.disabled = !canForward;
        }
      }

      function push(id) {
        if (!id) return;
        if (index >= 0 && entries[index] === id) {
          updateButtons();
          return;
        }
        if (index < entries.length - 1) {
          entries.splice(index + 1);
        }
        entries.push(id);
        if (entries.length > maxEntries) {
          entries.splice(0, entries.length - maxEntries);
        }
        index = entries.length - 1;
        updateButtons();
      }

      function go(delta) {
        if (!entries.length) return;
        var next = index + delta;
        if (next < 0 || next >= entries.length) return;
        index = next;
        updateButtons();
        var target = entries[index];
        if (target) {
          suppressHash = true;
          navigateToId(target, { skipHistory: true });
        }
      }

      function onHashChange() {
        if (suppressHash) {
          suppressHash = false;
          return;
        }
        var id = location.hash ? location.hash.slice(1) : '';
        if (id) {
          push(id);
        }
      }

      function onKeyDown(ev) {
        if (ev.defaultPrevented) return;
        var mod = ev.metaKey || ev.ctrlKey;
        if (!mod) return;
        var tag = (ev.target && ev.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || ev.target && ev.target.isContentEditable) return;
        if (ev.key === '[' || ev.key === 'ArrowLeft') {
          ev.preventDefault();
          go(-1);
        } else if (ev.key === ']' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          go(1);
        }
      }

      function init() {
        if (!initialized) {
          initialized = true;
          window.addEventListener('hashchange', onHashChange);
          document.addEventListener('keydown', onKeyDown, true);
          if (location.hash) {
            var id = location.hash.slice(1);
            if (id) {
              push(id);
            }
          }
        }
        updateButtons();
      }

      return {
        init: init,
        record: function(id) {
          init();
          if (suppressHash) {
            suppressHash = false;
          }
          push(id);
        },
        goBack: function(){ go(-1); },
        goForward: function(){ go(1); },
        suppressNextHash: function(){ suppressHash = true; },
        ensureButtons: function(){ updateButtons(); }
      };
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
        '<div id="cdv-anchor-history" role="group" aria-label="锚点导航">' +
          '<button id="cdv-anchor-back" title="上一锚点 (⌘[, Ctrl+[)">←</button>' +
          '<button id="cdv-anchor-forward" title="下一锚点 (⌘], Ctrl])">→</button>' +
        '</div>' +
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
    setupAnchorHistoryControls();

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
      var widthKey = 'cdv.focusWidth';
      var progressBar = null;
      var focusActive = false;
      var rafId = 0;
      var widthControl = null;
      var currentWidthId = null;
      var widthOptions = [
        {
          id: 'compact',
          label: '紧凑',
          width: 'min(960px, 92vw)',
          padding: 'clamp(24px, 4vw, 44px)'
        },
        {
          id: 'comfort',
          label: '标准',
          width: 'min(1180px, 96vw)',
          padding: 'clamp(26px, 5vw, 52px)'
        },
        {
          id: 'expanded',
          label: '宽屏',
          width: 'min(1480px, 98vw)',
          padding: 'clamp(28px, 6vw, 58px)'
        }
      ];
      var defaultWidthId = 'comfort';

      var onScroll = function(){ scheduleProgress(); };
      var onResize = function(){ scheduleProgress(); };

      function ensureProgressBar() {
        if (progressBar && document.body.contains(progressBar)) return;
        progressBar = document.createElement('div');
        progressBar.id = 'cdv-focus-progress';
        progressBar.setAttribute('aria-hidden', 'true');
        progressBar.style.width = '0%';
        document.body.appendChild(progressBar);
      }

      function destroyProgressBar() {
        if (progressBar && progressBar.parentNode) {
          progressBar.parentNode.removeChild(progressBar);
        }
        progressBar = null;
      }

      function updateButton(active) {
        btn.textContent = active ? 'Exit Focus' : 'Focus';
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.setAttribute('title', active ? '退出专注模式' : '专注模式');
        if (active) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }

      function getWidthOption(id) {
        for (var i = 0; i < widthOptions.length; i += 1) {
          if (widthOptions[i].id === id) {
            return widthOptions[i];
          }
        }
        return null;
      }

      function loadWidthPreference() {
        try {
          var saved = localStorage.getItem(widthKey);
          if (saved && getWidthOption(saved)) {
            return saved;
          }
        } catch (_) {}
        return defaultWidthId;
      }

      function ensureWidthControl() {
        if (widthControl && document.body.contains(widthControl)) {
          return widthControl;
        }
        var bar = document.getElementById('cdv-topbar');
        if (!bar) return null;
        widthControl = document.createElement('div');
        widthControl.id = 'cdv-focus-width-control';
        var label = document.createElement('span');
        label.textContent = '宽度';
        widthControl.appendChild(label);

        widthOptions.forEach(function(opt){
          var button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('data-width-id', opt.id);
          button.textContent = opt.label;
          button.addEventListener('click', function(){
            applyWidthSetting(opt.id, true);
          });
          widthControl.appendChild(button);
        });

        var focusToggle = document.getElementById('cdv-focus-toggle');
        if (focusToggle && focusToggle.parentElement === bar) {
          bar.insertBefore(widthControl, focusToggle.nextSibling);
        } else {
          bar.appendChild(widthControl);
        }

        return widthControl;
      }

      function updateWidthButtons(activeId) {
        if (!widthControl) return;
        var buttons = widthControl.querySelectorAll('button[data-width-id]');
        buttons.forEach(function(button){
          if (button.getAttribute('data-width-id') === activeId) {
            button.classList.add('active');
          } else {
            button.classList.remove('active');
          }
        });
      }

      function applyWidthSetting(id, persist) {
        var opt = getWidthOption(id) || getWidthOption(defaultWidthId);
        if (!opt) return;
        currentWidthId = opt.id;
        document.body.style.setProperty('--cdv-focus-width', opt.width);
        document.body.style.setProperty('--cdv-focus-padding', opt.padding);
        updateWidthButtons(currentWidthId);
        if (persist) {
          try {
            localStorage.setItem(widthKey, currentWidthId);
          } catch (_) {}
        }
      }

      function clearWidthSetting() {
        document.body.style.removeProperty('--cdv-focus-width');
        document.body.style.removeProperty('--cdv-focus-padding');
      }

      function updateProgress() {
        if (!progressBar) return;
        var doc = document.scrollingElement || document.documentElement || document.body;
        var max = Math.max(1, doc.scrollHeight - doc.clientHeight);
        var pct = doc.scrollTop / max;
        if (pct < 0) pct = 0;
        if (pct > 1) pct = 1;
        progressBar.style.width = (pct * 100).toFixed(3) + '%';
      }

      function scheduleProgress() {
        if (!focusActive || !progressBar) return;
        if (rafId) return;
        rafId = window.requestAnimationFrame ? window.requestAnimationFrame(function(){
          rafId = 0;
          updateProgress();
        }) : (updateProgress(), 0);
      }

      function attachListeners() {
        window.addEventListener('scroll', onScroll, false);
        window.addEventListener('resize', onResize, false);
        scheduleProgress();
      }

      function detachListeners() {
        window.removeEventListener('scroll', onScroll, false);
        window.removeEventListener('resize', onResize, false);
        if (rafId && window.cancelAnimationFrame) {
          window.cancelAnimationFrame(rafId);
        }
        rafId = 0;
      }

      function apply(state) {
        var active = !!state;
        if (focusActive === active) {
          updateButton(active);
          if (active) {
            scheduleProgress();
            if (!currentWidthId) {
              currentWidthId = loadWidthPreference();
            }
            ensureWidthControl();
            applyWidthSetting(currentWidthId, false);
          }
          return;
        }
        focusActive = active;
        document.documentElement.classList.toggle('cdv-focus', active);
        updateButton(active);

        if (active) {
          ensureProgressBar();
          attachListeners();
          updateProgress();
          currentWidthId = loadWidthPreference();
          ensureWidthControl();
          applyWidthSetting(currentWidthId, false);
        } else {
          detachListeners();
          destroyProgressBar();
          clearWidthSetting();
        }
      }

      var initial = false;
      try { initial = localStorage.getItem(key) === '1'; } catch (_) {}
      apply(initial);

      btn.addEventListener('click', function(){
        var next = !focusActive;
        apply(next);
        try { localStorage.setItem(key, next ? '1' : '0'); } catch (_) {}
      });

      // Allow width preference to be changed even if focus was active via storage
      if (document.documentElement.classList.contains('cdv-focus')) {
        focusActive = true;
        ensureProgressBar();
        attachListeners();
        updateProgress();
        currentWidthId = loadWidthPreference();
        ensureWidthControl();
        applyWidthSetting(currentWidthId, false);
      }
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
      panel.innerHTML = '' +
        '<div id="cdv-chat-header">' +
          '<div class="cdv-chat-title">' +
            '<span class="cdv-chat-name">AI Chart</span>' +
            '<span class="cdv-chat-model" id="cdv-chat-model-label"></span>' +
          '</div>' +
          '<div class="cdv-chat-actions">' +
            '<span class="cdv-chat-tokens" id="cdv-chat-token-indicator"></span>' +
            '<button id="cdv-chat-context-toggle" title="查看当前请求上下文">Context</button>' +
            '<button id="cdv-chat-cancel" title="停止当前请求" disabled>Stop</button>' +
            '<button id="cdv-chat-close" title="关闭面板">×</button>' +
          '</div>' +
        '</div>' +
        '<div id="cdv-chat-context" class="collapsed"></div>' +
        '<div id="cdv-chat-messages" aria-live="polite"></div>' +
        '<div id="cdv-chat-input-row">' +
          '<textarea id="cdv-chat-input" rows="1" placeholder="Ask about this page…"></textarea>' +
          '<button id="cdv-chat-send">Send</button>' +
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

    function setupAnchorHistoryControls() {
      try {
        CDV_ANCHOR_HISTORY.init();
      } catch(_) {}
    }

    function navigateToId(id, options) {
      options = options || {};
      try {
        if (!id) return;
        var el = document.getElementById(id);
        if (!el) return;
        scrollWithOffset(el);
        try {
          if (history.replaceState) {
            history.replaceState(null, '', '#' + id);
          } else {
            CDV_ANCHOR_HISTORY.suppressNextHash();
            location.hash = id;
          }
        } catch(_) {
          CDV_ANCHOR_HISTORY.suppressNextHash();
          location.hash = id;
        }
        highlightAnchorTarget(id);
        if (!options.skipHistory) {
          CDV_ANCHOR_HISTORY.record(id);
        } else {
          CDV_ANCHOR_HISTORY.ensureButtons();
        }
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
        var nodes = Array.prototype.slice.call(main.querySelectorAll('h1, h2, h3, h4'));
        var seen = Object.create(null);
        var list = [];
        nodes.forEach(function(node){
          var targetId = node.getAttribute('id');
          var targetElement = node;

          if (!targetId) {
            var section = node.closest && node.closest('[id]');
            if (section && section.getAttribute('id')) {
              targetId = section.getAttribute('id');
              targetElement = section;
            }
          }

          if (!targetId) {
            var anchor = node.querySelector && node.querySelector('a[href^=\"#\"]');
            if (anchor) {
              var href = anchor.getAttribute('href') || '';
              if (href.charAt(0) === '#') {
                var candidate = href.slice(1);
                if (candidate) {
                  var actual = document.getElementById(candidate);
                  if (actual) {
                    targetId = candidate;
                    targetElement = actual;
                  } else {
                    targetId = candidate;
                  }
                }
              }
            }
          }

          if (!targetId || seen[targetId]) return;
          seen[targetId] = true;
          var title = extractHeadingTitle(node);
          if (!title) return;
          var level = parseInt(node.tagName.slice(1), 10);
          if (!level || level < 1) level = 2;
          list.push({ id: targetId, title: title, level: level, element: targetElement });
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
          group.dataset.outlineId = node.item.id;
          group.dataset.outlineLevel = String(level);
          var expanded = isOutlineExpanded(expandedState, node.item.id);
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
          header.appendChild(link);
          group.appendChild(header);
          var childrenContainer = document.createElement('div');
          childrenContainer.className = 'cdv-outline-children';
          renderOutlineTree(node.children, childrenContainer, linkMap, groupMap, expandedState);
          group.appendChild(childrenContainer);
          frag.appendChild(group);
          linkMap[node.item.id] = link;
          groupMap[node.item.id] = group;
          applyGroupExpanded(group, node.item.id, expanded, expandedState, level, { persist: false });
          link.addEventListener('click', function(ev){
            ev.preventDefault();
            if (group.classList.contains('collapsed')) {
              applyGroupExpanded(group, node.item.id, true, expandedState, level, { expandDescendants: true });
              saveOutlineExpanded(expandedState);
            }
            navigateToId(node.item.id);
          });
          toggle.addEventListener('click', function(ev){
            ev.preventDefault();
            ev.stopPropagation();
            var nowExpanded = !group.classList.contains('expanded');
            applyGroupExpanded(group, node.item.id, nowExpanded, expandedState, level, {
              expandDescendants: nowExpanded,
              collapseDescendants: !nowExpanded
            });
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

    function outlineLevelFromGroup(group) {
      if (!group || !group.dataset) return 2;
      var lvl = parseInt(group.dataset.outlineLevel || '2', 10);
      if (!isFinite(lvl)) lvl = 2;
      if (lvl < 2) lvl = 2;
      if (lvl > 4) lvl = 4;
      return lvl;
    }

    function applyGroupExpanded(group, id, expanded, state, level, opts) {
      opts = opts || {};
      group.classList.toggle('expanded', !!expanded);
      group.classList.toggle('collapsed', !expanded);
      var toggle = group.querySelector(':scope > .cdv-outline-group-header .cdv-outline-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      if (opts.persist !== false && id) {
        setOutlineExpanded(state, id, !!expanded);
      }
      if (expanded && opts.expandDescendants) {
        autoExpandChildren(group, state, level <= 2 ? 2 : 1);
      } else if (!expanded && opts.collapseDescendants) {
        collapseDescendants(group, state);
      }
    }

    function autoExpandChildren(group, state, depth) {
      if (!depth || depth <= 0) return;
      var children = Array.prototype.slice.call(
        group.querySelectorAll(':scope > .cdv-outline-children > .cdv-outline-group')
      );
      children.forEach(function(child){
        var childId = child.dataset && child.dataset.outlineId;
        var childLevel = outlineLevelFromGroup(child);
        applyGroupExpanded(child, childId, true, state, childLevel, {
          expandDescendants: depth > 1,
          collapseDescendants: false
        });
      });
    }

    function collapseDescendants(group, state) {
      var descendants = Array.prototype.slice.call(group.querySelectorAll('.cdv-outline-group'));
      descendants.forEach(function(child){
        var childId = child.dataset && child.dataset.outlineId;
        child.classList.remove('expanded');
        child.classList.add('collapsed');
        var toggle = child.querySelector(':scope > .cdv-outline-group-header .cdv-outline-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (childId) {
          setOutlineExpanded(state, childId, false);
        }
      });
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
          var group = groupMap[current];
          if (!group) break;
          if (!group.classList.contains('expanded')) {
            applyGroupExpanded(group, current, true, expanded, outlineLevelFromGroup(group), { expandDescendants: true });
            changed = true;
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

    // Chat: AI context assistant
    var CDV_CHAT = (function(){
      var STORAGE_KEYS = {
        apiKey: 'cdv.ai.api_key',
        model: 'cdv.ai.model',
        systemPrompt: 'cdv.ai.system_prompt'
      };
      var TOTAL_TOKEN_BUDGET = 6000;
      var DEFAULT_CONFIG = {
        api: {
          base_url: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          timeout_ms: 15000,
          headers: {}
        },
        prompts: {
          system: 'You are Cargo Doc Viewer’s AI assistant. Provide clear, concise answers grounded in the supplied Rust documentation context. If the context is insufficient, ask for clarification instead of guessing.',
          environment_template: 'Crate: {{crate.name}}\nModule: {{page.module_path}}\nRust Edition: {{environment.edition}}\nAvailable Features: {{environment.features}}\n',
          fallback_language: 'auto'
        },
        context: {
          history_window: 6,
          page_tokens_budget: 1200,
          debounce_ms: 300,
          sanitize_patterns: [
            { regex: '(?i)apikey=[A-Za-z0-9_-]+', replacement: '[redacted]' }
          ]
        },
        ui: {
          language: 'auto',
          show_context_preview: true,
          allow_prompt_edit: true
        }
      };
      var dom = {
        panel: null,
        sendBtn: null,
        input: null,
        messages: null,
        contextHost: null,
        modelLabel: null,
        tokenIndicator: null,
        cancelBtn: null,
        contextToggle: null,
        closeBtn: null,
        envPreview: null,
        selectionPreview: null,
        selectionMeta: null,
        budget: null,
        systemInput: null,
        resetSystem: null,
        modelInput: null,
        apiKeyInput: null,
        copyContextBtn: null,
        contextStatus: null,
        pinSelectionBtn: null
      };
      var state = createInitialState();
      var scheduleSelectionUpdate = debounce(handleSelectionChange, Math.max(120, state.config.context.debounce_ms || DEFAULT_CONFIG.context.debounce_ms));
      var scheduleSummaryUpdate = debounce(recomputeSummary, 700);

      function maskSecret(value) {
        if (!value) return value;
        var str = String(value);
        if (str.length <= 8) return '***';
        return str.slice(0, 4) + '…' + str.slice(-4);
      }

      function debugLogRequest(url, headers) {
        try {
          var preview = {};
          Object.keys(headers || {}).forEach(function(key){
            var value = headers[key];
            if (String(key).toLowerCase() === 'authorization') {
              preview[key] = maskSecret(value);
            } else {
              preview[key] = value;
            }
          });
          console.info('[CDV][request] POST', url, preview);
        } catch (err) {
          console.warn('[CDV] Failed to log request preview:', err);
        }
      }

      function debugLogConfig() {
        try {
          var headers = {};
          var src = state.config.api.headers || {};
          Object.keys(src).forEach(function(key){
            headers[key] = (String(key).toLowerCase() === 'authorization') ? maskSecret(src[key]) : src[key];
          });
          var keyPreview = state.apiKey ? maskSecret(state.apiKey) : '(none)';
          console.groupCollapsed('[CDV][config] AI chat configuration');
          console.log('configPath:', state.configPath || '(default)');
          console.log('resolved base_url:', state.config.api.base_url);
          console.log('resolved model:', state.config.api.model);
          console.log('configured headers:', headers);
          console.log('localStorage apiKey override:', keyPreview);
          console.groupEnd();
        } catch (err) {
          console.warn('[CDV] Failed to emit config debug info:', err);
        }
      }

      function createInitialState() {
        var cfg = normalizeConfig(CDV_BOOTSTRAP.config || {});
        var defaults = normalizeConfig(null);
        var st = {
          config: cfg,
          defaults: defaults,
          version: typeof CDV_BOOTSTRAP.version === 'string' ? CDV_BOOTSTRAP.version : '0.0.0',
          configPath: typeof CDV_BOOTSTRAP.config_path === 'string' ? CDV_BOOTSTRAP.config_path : '',
          pending: false,
          abort: null,
          history: [],
          selection: null,
          pinnedSelection: null,
          selectionPinned: false,
          summary: '',
          tokens: {
            total: 0,
            system: 0,
            environment: 0,
            page: 0,
            selection: 0,
            history: 0,
            user: 0,
            budget: TOTAL_TOKEN_BUDGET,
            pageBudget: cfg.context.page_tokens_budget || DEFAULT_CONFIG.context.page_tokens_budget
          },
          contextOpen: !!(cfg.ui && cfg.ui.show_context_preview),
          sanitizers: compileSanitizers(cfg.context.sanitize_patterns || []),
          systemPrompt: '',
          envTemplate: cfg.prompts.environment_template || DEFAULT_CONFIG.prompts.environment_template,
          modelOverride: '',
          apiKey: '',
          lastContextLayers: null
        };
        st.systemPrompt = loadSystemPromptOverride(cfg.prompts.system || DEFAULT_CONFIG.prompts.system);
        st.apiKey = loadFromStorage(STORAGE_KEYS.apiKey) || '';
        st.modelOverride = loadFromStorage(STORAGE_KEYS.model) || '';
        if (st.modelOverride) {
          st.config.api.model = st.modelOverride;
        }
        return st;
      }

      function init() {
        if (CDV_FLAGS.noChat) return;
        dom.panel = document.getElementById('cdv-chat-panel');
        dom.sendBtn = document.getElementById('cdv-chat-send');
        dom.input = document.getElementById('cdv-chat-input');
        dom.messages = document.getElementById('cdv-chat-messages');
        dom.contextHost = document.getElementById('cdv-chat-context');
        dom.modelLabel = document.getElementById('cdv-chat-model-label');
        dom.tokenIndicator = document.getElementById('cdv-chat-token-indicator');
        dom.cancelBtn = document.getElementById('cdv-chat-cancel');
        dom.contextToggle = document.getElementById('cdv-chat-context-toggle');
        dom.closeBtn = document.getElementById('cdv-chat-close');
        if (!dom.sendBtn || !dom.input || !dom.messages || !dom.panel) return;

        buildContextPanel();
        updateModelLabel();
        updateContextVisibility();
        attachEvents();
        autoResizeTextarea(dom.input);
        state.summary = buildSummaryText();
        updateContextPreview();
        debugLogConfig();
      }

      function attachEvents() {
        if (dom.sendBtn) dom.sendBtn.addEventListener('click', send);
        if (dom.input) {
          dom.input.addEventListener('keydown', function(ev){
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
              ev.preventDefault();
              send();
            }
          });
          dom.input.addEventListener('input', function(){ autoResizeTextarea(dom.input); });
        }
        if (dom.cancelBtn) dom.cancelBtn.addEventListener('click', cancelRequest);
        if (dom.contextToggle) dom.contextToggle.addEventListener('click', function(){
          state.contextOpen = !state.contextOpen;
          updateContextVisibility();
        });
        if (dom.closeBtn) dom.closeBtn.addEventListener('click', function(){
          dom.panel.classList.remove('open');
          document.body.classList.remove('cdv-chat-open');
        });
        document.addEventListener('selectionchange', scheduleSelectionUpdate);
        document.addEventListener('mouseup', function(){ setTimeout(scheduleSelectionUpdate, 0); });
        window.addEventListener('hashchange', function(){
          state.selection = null;
          state.selectionPinned = false;
          state.pinnedSelection = null;
          state.summary = '';
          updateSelectionControls();
          scheduleSummaryUpdate();
        });
        installSummaryObserver();
      }

      function updateContextVisibility() {
        if (!dom.contextHost) return;
        dom.contextHost.classList.toggle('collapsed', !state.contextOpen);
        dom.contextHost.classList.toggle('expanded', state.contextOpen);
        if (dom.contextToggle) {
          dom.contextToggle.classList.toggle('active', state.contextOpen);
        }
      }

      function buildContextPanel() {
        if (!dom.contextHost) return;
        var allowEdit = !!(state.config.ui && state.config.ui.allow_prompt_edit);
        var configSource = state.configPath ? ('Config: ' + state.configPath) : 'Config: embedded defaults';
        dom.contextHost.innerHTML =
          '<section class="cdv-context-section" data-section="system">' +
            '<header><span>System Prompt</span>' +
              (allowEdit ? '<button type="button" id="cdv-chat-reset-system">Reset</button>' : '') +
            '</header>' +
            '<textarea id="cdv-chat-system-input" ' + (allowEdit ? '' : 'readonly') + '></textarea>' +
          '</section>' +
          '<section class="cdv-context-section" data-section="environment">' +
            '<header>Environment</header>' +
            '<pre id="cdv-chat-env"></pre>' +
          '</section>' +
          '<section class="cdv-context-section" data-section="selection">' +
            '<header><span>Selection</span><span id="cdv-chat-selection-meta"></span></header>' +
            '<pre id="cdv-chat-selection"></pre>' +
            '<div class="cdv-chat-selection-actions">' +
              '<button type="button" id="cdv-chat-pin-selection">Pin selection</button>' +
            '</div>' +
          '</section>' +
          '<section class="cdv-context-section" data-section="budget">' +
            '<header>Token Budget</header>' +
            '<div id="cdv-chat-budget"></div>' +
          '</section>' +
          '<section class="cdv-context-section" data-section="api">' +
            '<header>API Settings</header>' +
            '<label class="cdv-field"><span>Model</span><input id="cdv-chat-model-input" type="text" /></label>' +
            '<label class="cdv-field"><span>API Key</span><input id="cdv-chat-api-key" type="password" autocomplete="off" /></label>' +
            '<div class="cdv-chat-config-meta">' + configSource + '</div>' +
            '<div class="cdv-chat-actions-row">' +
              '<button type="button" id="cdv-chat-copy-context">Copy context</button>' +
              '<span id="cdv-chat-context-status" class="cdv-chat-status"></span>' +
            '</div>' +
          '</section>';

        dom.envPreview = document.getElementById('cdv-chat-env');
        dom.selectionPreview = document.getElementById('cdv-chat-selection');
        dom.selectionMeta = document.getElementById('cdv-chat-selection-meta');
        dom.budget = document.getElementById('cdv-chat-budget');
        dom.systemInput = document.getElementById('cdv-chat-system-input');
        dom.resetSystem = document.getElementById('cdv-chat-reset-system');
        dom.modelInput = document.getElementById('cdv-chat-model-input');
        dom.apiKeyInput = document.getElementById('cdv-chat-api-key');
        dom.copyContextBtn = document.getElementById('cdv-chat-copy-context');
        dom.contextStatus = document.getElementById('cdv-chat-context-status');
        dom.pinSelectionBtn = document.getElementById('cdv-chat-pin-selection');

        if (dom.systemInput) {
          dom.systemInput.value = state.systemPrompt;
          if (!allowEdit) {
            dom.systemInput.setAttribute('readonly', 'readonly');
            dom.systemInput.classList.add('readonly');
          } else {
            dom.systemInput.addEventListener('input', function(){
              state.systemPrompt = dom.systemInput.value;
              updateContextPreview();
            });
            dom.systemInput.addEventListener('blur', function(){
              saveSystemPromptOverride(dom.systemInput.value);
            });
          }
        }
        if (dom.resetSystem) {
          dom.resetSystem.addEventListener('click', function(){
            saveSystemPromptOverride('');
            notifyContext('System prompt reset.');
          });
        }
        if (dom.modelInput) {
          dom.modelInput.value = state.config.api.model || DEFAULT_CONFIG.api.model;
          dom.modelInput.addEventListener('change', function(){
            var next = dom.modelInput.value.trim();
            state.config.api.model = next || DEFAULT_CONFIG.api.model;
            saveToStorage(STORAGE_KEYS.model, next);
            updateModelLabel();
            updateContextPreview();
            notifyContext('Model updated.');
          });
        }
        if (dom.apiKeyInput) {
          dom.apiKeyInput.value = state.apiKey;
          dom.apiKeyInput.addEventListener('change', function(){
            state.apiKey = dom.apiKeyInput.value.trim();
            saveToStorage(STORAGE_KEYS.apiKey, state.apiKey);
            notifyContext(state.apiKey ? 'API key saved locally.' : 'API key cleared.');
          });
        }
        if (dom.copyContextBtn) {
          dom.copyContextBtn.addEventListener('click', copyContext);
        }
        if (dom.pinSelectionBtn) {
          dom.pinSelectionBtn.addEventListener('click', togglePinSelection);
        }
      }

      function updateModelLabel() {
        if (!dom.modelLabel) return;
        dom.modelLabel.textContent = state.config.api.model ? ('Model: ' + state.config.api.model) : '';
      }

      function updateTokenIndicator() {
        if (!dom.tokenIndicator) return;
        var t = state.tokens || {};
        if (!t.total) {
          dom.tokenIndicator.textContent = '';
          dom.tokenIndicator.removeAttribute('title');
          return;
        }
        dom.tokenIndicator.textContent = '≈ ' + t.total + ' tok';
        dom.tokenIndicator.title = 'system ' + t.system +
          ', env ' + t.environment +
          ', page ' + t.page +
          ', selection ' + t.selection +
          ', history ' + t.history +
          ', user ' + t.user;
      }

      function updateSelectionControls() {
        if (dom.pinSelectionBtn) {
          dom.pinSelectionBtn.classList.toggle('active', !!state.selectionPinned);
          dom.pinSelectionBtn.textContent = state.selectionPinned ? 'Unpin selection' : 'Pin selection';
        }
        if (dom.selectionMeta) {
          var sel = state.selectionPinned ? state.pinnedSelection : state.selection;
          if (sel && sel.text) {
            dom.selectionMeta.textContent = (state.selectionPinned ? '[pinned] ' : '') + sel.text.length + ' chars';
          } else if (state.selectionPinned) {
            dom.selectionMeta.textContent = '[pinned] (empty)';
          } else {
            dom.selectionMeta.textContent = 'None';
          }
        }
      }

      function togglePinSelection() {
        if (state.selectionPinned) {
          state.selectionPinned = false;
          state.pinnedSelection = null;
          updateSelectionControls();
          updateContextPreview();
          notifyContext('Selection unpinned.');
          return;
        }
        if (!state.selection || !state.selection.text) {
          notifyContext('Select content on the page first.');
          return;
        }
        state.selectionPinned = true;
        state.pinnedSelection = state.selection;
        updateSelectionControls();
        updateContextPreview();
        notifyContext('Selection pinned for upcoming requests.');
      }

      function send() {
        if (state.pending) return;
        if (!dom.input) return;
        var raw = dom.input.value || '';
        var trimmed = raw.trim();
        if (!trimmed) return;
        var sanitizedQuestion = sanitizeText(trimmed);
        dom.input.value = '';
        autoResizeTextarea(dom.input);
        appendMessage('user', sanitizedQuestion);
        pushHistory('user', sanitizedQuestion);
        var request = buildRequestPayload(sanitizedQuestion);
        state.lastContextLayers = request.layers;
        updateTokenIndicator();
        var placeholder = appendMessage('assistant', 'Thinking…', { pending: true });
        setPending(true);
        var controller = new AbortController();
        state.abort = controller;
        var url = buildEndpoint(state.config.api.base_url);
        var headers = buildHeaders();
        if (!hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
        debugLogRequest(url, headers);
        fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(request.payload),
          signal: controller.signal
        }).then(function(resp){
          if (!resp.ok) {
            return resp.text().then(function(text){
              throw buildHttpError(resp.status, text);
            });
          }
          return resp.json();
        }).then(function(data){
          var answer = extractAssistantContent(data);
          if (!answer) {
            answer = 'No response received.';
          }
          answer = sanitizeText(answer);
          placeholder.classList.remove('pending');
          placeholder.textContent = answer;
          placeholder.classList.remove('error');
          pushHistory('assistant', answer);
        }).catch(function(err){
          if (err && err.name === 'AbortError') {
            placeholder.classList.remove('pending');
            placeholder.classList.add('error');
            placeholder.textContent = 'Request cancelled.';
            return;
          }
          placeholder.classList.remove('pending');
          placeholder.classList.add('error');
          var message = (err && err.message) ? err.message : String(err);
          placeholder.textContent = 'Error: ' + message;
          notifyContext('Request failed; copy context to try elsewhere.');
        }).finally(function(){
          setPending(false);
          state.abort = null;
          updateContextPreview();
        });
      }

      function cancelRequest() {
        if (state.abort) {
          state.abort.abort();
          state.abort = null;
        }
      }

      function setPending(pending) {
        state.pending = pending;
        if (dom.sendBtn) dom.sendBtn.disabled = pending;
        if (dom.input) dom.input.disabled = pending;
        if (dom.cancelBtn) dom.cancelBtn.disabled = !pending;
        if (dom.panel) dom.panel.classList.toggle('pending', pending);
      }

      function buildRequestPayload(question) {
        var layers = computeContextLayers(question);
        state.tokens = layers.tokens;
        var messages = [];
        if (layers.system) messages.push({ role: 'system', content: layers.system });
        if (layers.environment) messages.push({ role: 'system', content: 'Environment context:\n' + layers.environment });
        if (layers.summary) messages.push({ role: 'system', content: 'Page summary:\n' + layers.summary });
        if (layers.selection) messages.push({ role: 'system', content: 'User selection:\n' + layers.selection });
        if (layers.history && layers.history.length) {
          layers.history.forEach(function(entry){
            messages.push({ role: entry.role, content: entry.content });
          });
        }
        messages.push({ role: 'user', content: layers.question || question });
        var payload = {
          model: state.config.api.model || DEFAULT_CONFIG.api.model,
          messages: messages,
          metadata: {
            cdv_version: state.version,
            doc_path: layers.metadata && layers.metadata.location || '',
            crate: layers.metadata && layers.metadata.crate || '',
            module: layers.metadata && layers.metadata.module_path || ''
          }
        };
        return { payload: payload, layers: layers };
      }

      function computeContextLayers(question) {
        var sanitizedQuestion = sanitizeText(question || '');
        var meta = gatherMetadata();
        var features = collectEnabledFeatures();
        var environmentText = renderEnvironmentPrompt(state.envTemplate, meta, features);
        var summary = ensureSummary();
        var summarySanitized = limitTextByTokens(sanitizeText(summary), state.config.context.page_tokens_budget);
        var selection = state.selectionPinned && state.pinnedSelection ? state.pinnedSelection : state.selection;
        var selectionText = selection && selection.text ? limitTextByTokens(sanitizeText(selection.text), state.config.context.page_tokens_budget) : '';
        var historyMessages = sliceHistory();
        var historyTokens = 0;
        for (var i = 0; i < historyMessages.length; i++) {
          historyTokens += estimateTokens(historyMessages[i].content);
        }
        var fallback = state.config.prompts && state.config.prompts.fallback_language;
        var systemPrompt = (state.systemPrompt || DEFAULT_CONFIG.prompts.system).trim();
        if (fallback && fallback !== 'auto') {
          systemPrompt = systemPrompt + '\nRespond in ' + fallback + '.';
        }
        systemPrompt = systemPrompt.trim();
        var tokens = {
          system: systemPrompt ? estimateTokens(systemPrompt) : 0,
          environment: environmentText ? estimateTokens(environmentText) : 0,
          page: summarySanitized ? estimateTokens(summarySanitized) : 0,
          selection: selectionText ? estimateTokens(selectionText) : 0,
          history: historyTokens,
          user: sanitizedQuestion ? estimateTokens(sanitizedQuestion) : 0,
          budget: TOTAL_TOKEN_BUDGET,
          pageBudget: state.config.context.page_tokens_budget || DEFAULT_CONFIG.context.page_tokens_budget
        };
        tokens.total = tokens.system + tokens.environment + tokens.page + tokens.selection + tokens.history + tokens.user;
        return {
          system: systemPrompt,
          environment: environmentText,
          summary: summarySanitized,
          selection: selectionText,
          selectionMeta: selection,
          history: historyMessages,
          question: sanitizedQuestion,
          metadata: {
            crate: meta.crate,
            crate_version: meta.crateVersion,
            module_path: meta.modulePath,
            edition: meta.edition,
            features: features,
            location: meta.location,
            language: meta.language,
            title: meta.title
          },
          tokens: tokens
        };
      }

      function updateContextPreview() {
        if (!dom.contextHost) return;
        var layers = computeContextLayers('');
        state.tokens = layers.tokens;
        state.lastContextLayers = layers;
        if (dom.envPreview) {
          dom.envPreview.textContent = renderEnvironmentPreview(layers);
        }
        if (dom.selectionPreview) {
          dom.selectionPreview.textContent = layers.selection || '(none)';
        }
        if (dom.budget) {
          dom.budget.innerHTML = renderBudgetHtml(layers.tokens);
        }
        updateSelectionControls();
        updateTokenIndicator();
      }

      function renderBudgetHtml(tokens) {
        if (!tokens) return '';
        var rows = [
          '<div class="cdv-budget-total">≈ ' + tokens.total + ' / ' + tokens.budget + ' tokens</div>',
          '<div class="cdv-budget-item">System: ' + tokens.system + '</div>',
          '<div class="cdv-budget-item">Environment: ' + tokens.environment + '</div>',
          '<div class="cdv-budget-item">Page summary: ' + tokens.page + ' / ' + tokens.pageBudget + '</div>',
          '<div class="cdv-budget-item">Selection: ' + tokens.selection + '</div>',
          '<div class="cdv-budget-item">History: ' + tokens.history + '</div>',
          '<div class="cdv-budget-item">User: ' + tokens.user + '</div>'
        ];
        return rows.join('');
      }

      function renderEnvironmentPreview(layers) {
        var meta = layers.metadata || {};
        var lines = [];
        if (meta.crate) {
          var line = 'Crate: ' + meta.crate;
          if (meta.crate_version) line += ' v' + meta.crate_version;
          lines.push(line);
        }
        if (meta.module_path) lines.push('Module: ' + meta.module_path);
        if (meta.title) lines.push('Title: ' + meta.title);
        if (meta.location) lines.push('Path: ' + meta.location);
        if (meta.edition) lines.push('Edition: ' + meta.edition);
        if (meta.features && meta.features.length) lines.push('Features: ' + meta.features.join(', '));
        lines.push('Language: ' + (meta.language || 'en'));
        if (layers.environment) {
          lines.push('');
          lines.push('Template output:');
          lines.push(layers.environment);
        }
        return lines.join('\n');
      }

      function copyContext() {
        var layers = state.lastContextLayers || computeContextLayers('');
        var text = formatContextForCopy(layers);
        if (!text) {
          notifyContext('No context to copy.');
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function(){
            notifyContext('Context copied to clipboard.');
          }).catch(function(err){
            console.warn('[CDV] Clipboard write failed:', err);
            fallbackCopy(text);
          });
        } else {
          fallbackCopy(text);
        }
      }

      function fallbackCopy(text) {
        try {
          var temp = document.createElement('textarea');
          temp.value = text;
          temp.setAttribute('readonly', '');
          temp.style.position = 'fixed';
          temp.style.top = '-9999px';
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          document.body.removeChild(temp);
          notifyContext('Context copied to clipboard.');
        } catch (err) {
          notifyContext('Copy failed: ' + err.message);
        }
      }

      function formatContextForCopy(layers) {
        if (!layers) return '';
        var lines = [];
        lines.push('System Prompt:\n' + (layers.system || '(none)'));
        lines.push('\nEnvironment:\n' + (layers.environment || '(none)'));
        lines.push('\nPage Summary:\n' + (layers.summary || '(none)'));
        lines.push('\nSelection:\n' + (layers.selection || '(none)'));
        if (layers.history && layers.history.length) {
          lines.push('\nHistory:');
          for (var i = 0; i < layers.history.length; i++) {
            var entry = layers.history[i];
            lines.push('- ' + entry.role + ': ' + entry.content);
          }
        }
        if (layers.metadata) {
          lines.push('\nMetadata:\n' + JSON.stringify(layers.metadata, null, 2));
        }
        return lines.join('\n');
      }

      function notifyContext(message) {
        if (!dom.contextStatus) return;
        dom.contextStatus.textContent = message || '';
        if (message) {
          dom.contextStatus.classList.add('show');
          setTimeout(function(){
            if (dom.contextStatus.textContent === message) {
              dom.contextStatus.textContent = '';
              dom.contextStatus.classList.remove('show');
            }
          }, 3000);
        }
      }

      function gatherMetadata() {
        var metaTag = document.querySelector('meta[name="rustdoc-vars"]');
        var ds = metaTag && metaTag.dataset ? metaTag.dataset : {};
        var language = (document.documentElement && document.documentElement.getAttribute('lang')) || '';
        if (!language && state.config.ui && state.config.ui.language && state.config.ui.language !== 'auto') {
          language = state.config.ui.language;
        }
        return {
          crate: ds.currentCrate || ds.crate || ds.rootCrate || '',
          crateVersion: ds.currentVersion || ds.crateVersion || '',
          modulePath: ds.currentModule || ds.modulePath || '',
          edition: ds.edition || '',
          language: language || 'en',
          location: (location.pathname || '') + (location.search || '') + (location.hash || ''),
          title: document.title || ''
        };
      }

      function collectEnabledFeatures() {
        var features = [];
        try {
          var meta = document.querySelector('meta[name="cdv-crate-features"]');
          if (meta && meta.content) {
            features = meta.content.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
          }
        } catch (_) {}
        if (!features.length && document.body) {
          var attr = document.body.getAttribute('data-enabled-features') || document.body.getAttribute('data-features');
          if (attr) {
            features = attr.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
          }
        }
        return features;
      }

      function renderEnvironmentPrompt(template, meta, features) {
        var ctx = {
          crate: {
            name: meta.crate || '(unknown crate)',
            version: meta.crateVersion || ''
          },
          page: {
            module_path: meta.modulePath || '',
            title: meta.title || '',
            location: meta.location || ''
          },
          environment: {
            edition: meta.edition || '',
            features: features && features.length ? features.join(', ') : 'none',
            language: meta.language || 'en'
          }
        };
        return renderTemplate(template || DEFAULT_CONFIG.prompts.environment_template, ctx).trim();
      }

      function renderTemplate(template, context) {
        if (!template) return '';
        return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, function(_, path){
          var parts = path.split('.');
          var value = context;
          for (var i = 0; i < parts.length; i++) {
            if (!value || typeof value !== 'object') {
              value = '';
              break;
            }
            value = value[parts[i]];
          }
          if (value === undefined || value === null) return '';
          if (Array.isArray(value)) return value.join(', ');
          return String(value);
        });
      }

      function installSummaryObserver() {
        try {
          var main = document.querySelector('main');
          if (!main) return;
          var observer = new MutationObserver(function(mutations){
            for (var i = 0; i < mutations.length; i++) {
              var m = mutations[i];
              if (m.type === 'childList' || m.type === 'characterData') {
                state.summary = '';
                scheduleSummaryUpdate();
                break;
              }
            }
          });
          observer.observe(main, { subtree: true, childList: true, characterData: true });
        } catch (_) {}
      }

      function recomputeSummary() {
        state.summary = buildSummaryText();
        updateContextPreview();
      }

      function ensureSummary() {
        if (!state.summary) {
          state.summary = buildSummaryText();
        }
        return state.summary || '';
      }

      function buildSummaryText() {
        var main = document.querySelector('main') || document.body;
        if (!main) return '';
        var parts = [];
        var titleEl = document.querySelector('.main-heading h1');
        if (titleEl) {
          var title = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
          if (title) parts.push('Title: ' + title);
        }
        var paragraphs = main.querySelectorAll('p');
        for (var i = 0; i < paragraphs.length; i++) {
          var text = (paragraphs[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 60) continue;
          parts.push(text);
          if (estimateTokens(parts.join('\n\n')) >= (state.config.context.page_tokens_budget || DEFAULT_CONFIG.context.page_tokens_budget) * 2) {
            break;
          }
        }
        if (!parts.length) {
          var fallback = (main.textContent || '').replace(/\s+/g, ' ').trim();
          if (fallback.length > 0) {
            parts.push(fallback.slice(0, 600));
          }
        }
        return parts.join('\n\n');
      }

      function sliceHistory() {
        var maxPairs = state.config.context.history_window || DEFAULT_CONFIG.context.history_window;
        var limit = Math.max(0, maxPairs) * 2;
        if (!limit) return [];
        var slice = state.history.slice(-limit);
        return slice.map(function(entry){
          return { role: entry.role, content: entry.content };
        });
      }

      function pushHistory(role, content) {
        state.history.push({ role: role, content: content });
        var maxPairs = state.config.context.history_window || DEFAULT_CONFIG.context.history_window;
        var limit = Math.max(0, maxPairs) * 2;
        if (limit > 0 && state.history.length > limit) {
          state.history = state.history.slice(-limit);
        }
      }

      function handleSelectionChange() {
        if (state.selectionPinned && state.pinnedSelection) {
          return;
        }
        state.selection = captureSelection();
        updateSelectionControls();
        updateContextPreview();
      }

      function captureSelection() {
        try {
          var sel = window.getSelection();
          if (!sel || sel.isCollapsed) return null;
          var text = String(sel.toString() || '').trim();
          if (!text) return null;
          var range = sel.getRangeAt(0);
          var container = range.commonAncestorContainer;
          var main = document.querySelector('main') || document.body;
          if (main && container && !main.contains(container)) return null;
          if (text.length > 4000) {
            text = text.slice(0, 4000) + '…';
          }
          return {
            text: text,
            start: describeNode(range.startContainer),
            end: describeNode(range.endContainer),
            timestamp: Date.now()
          };
        } catch (_) {
          return null;
        }
      }

      function describeNode(node) {
        if (!node) return '';
        var path = [];
        var current = node.nodeType === 1 ? node : node.parentNode;
        var depth = 0;
        while (current && current !== document.body && depth < 40) {
          var parent = current.parentNode;
          if (!parent) break;
          var index = Array.prototype.indexOf.call(parent.childNodes, current);
          path.push(index);
          current = parent;
          depth++;
        }
        return path.reverse().join('.');
      }

      function appendMessage(role, text, opts) {
        opts = opts || {};
        var node = document.createElement('div');
        node.className = 'cdv-msg ' + role + (opts.pending ? ' pending' : '');
        node.setAttribute('data-role', role);
        node.textContent = text;
        dom.messages.appendChild(node);
        dom.messages.scrollTop = dom.messages.scrollHeight;
        return node;
      }

      function saveSystemPromptOverride(value) {
        var defaultPrompt = state.config.prompts.system || DEFAULT_CONFIG.prompts.system;
        var trimmed = (value || '').trim();
        if (!trimmed) {
          try { localStorage.removeItem(STORAGE_KEYS.systemPrompt); } catch (_) {}
          state.systemPrompt = defaultPrompt;
        } else {
          state.systemPrompt = trimmed;
          if (trimmed === defaultPrompt) {
            try { localStorage.removeItem(STORAGE_KEYS.systemPrompt); } catch (_) {}
          } else {
            saveToStorage(STORAGE_KEYS.systemPrompt, trimmed);
          }
        }
        if (dom.systemInput && dom.systemInput.value !== state.systemPrompt) {
          dom.systemInput.value = state.systemPrompt;
        }
        updateContextPreview();
      }

      function loadSystemPromptOverride(defaultPrompt) {
        var stored = loadFromStorage(STORAGE_KEYS.systemPrompt);
        if (stored && stored.trim()) return stored;
        return defaultPrompt || DEFAULT_CONFIG.prompts.system;
      }

      function normalizeConfig(raw) {
        if (!raw || typeof raw !== 'object') raw = {};
        var cfg = mergeObjects(DEFAULT_CONFIG, raw);
        if (!cfg.context || typeof cfg.context !== 'object') {
          cfg.context = mergeObjects(DEFAULT_CONFIG.context, null);
        }
        if (!Array.isArray(cfg.context.sanitize_patterns) || !cfg.context.sanitize_patterns.length) {
          cfg.context.sanitize_patterns = DEFAULT_CONFIG.context.sanitize_patterns.slice();
        } else {
          cfg.context.sanitize_patterns = cfg.context.sanitize_patterns.map(function(item){
            if (!item || typeof item !== 'object') {
              return { regex: DEFAULT_CONFIG.context.sanitize_patterns[0].regex, replacement: DEFAULT_CONFIG.context.sanitize_patterns[0].replacement };
            }
            return {
              regex: String(item.regex != null ? item.regex : DEFAULT_CONFIG.context.sanitize_patterns[0].regex),
              replacement: String(item.replacement != null ? item.replacement : DEFAULT_CONFIG.context.sanitize_patterns[0].replacement)
            };
          });
        }
        if (!cfg.api || typeof cfg.api !== 'object') {
          cfg.api = mergeObjects(DEFAULT_CONFIG.api, null);
        }
        if (!cfg.api.headers || typeof cfg.api.headers !== 'object') {
          cfg.api.headers = {};
        }
        if (!cfg.prompts || typeof cfg.prompts !== 'object') {
          cfg.prompts = mergeObjects(DEFAULT_CONFIG.prompts, null);
        }
        if (!cfg.ui || typeof cfg.ui !== 'object') {
          cfg.ui = mergeObjects(DEFAULT_CONFIG.ui, null);
        }
        return cfg;
      }

      function mergeObjects(base, extra) {
        var out = {};
        if (base && typeof base === 'object') {
          Object.keys(base).forEach(function(key){
            var value = base[key];
            if (Array.isArray(value)) {
              out[key] = value.slice();
            } else if (value && typeof value === 'object') {
              out[key] = mergeObjects(value, null);
            } else {
              out[key] = value;
            }
          });
        }
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function(key){
            var value = extra[key];
            if (value === undefined || value === null) return;
            if (Array.isArray(value)) {
              out[key] = value.slice();
            } else if (value && typeof value === 'object') {
              var baseValue = out[key] && typeof out[key] === 'object' && !Array.isArray(out[key]) ? out[key] : {};
              out[key] = mergeObjects(baseValue, value);
            } else {
              out[key] = value;
            }
          });
        }
        return out;
      }

      function compileSanitizers(patterns) {
        var compiled = [];
        for (var i = 0; i < patterns.length; i++) {
          var pattern = patterns[i];
          if (!pattern || typeof pattern.regex !== 'string') continue;
          var src = pattern.regex;
          var flags = 'g';
          var inline = src.match(/^\(\?([a-z]+)\)/i);
          if (inline) {
            src = src.slice(inline[0].length);
            var set = inline[1].toLowerCase();
            if (set.indexOf('i') >= 0 && flags.indexOf('i') === -1) flags += 'i';
            if (set.indexOf('m') >= 0 && flags.indexOf('m') === -1) flags += 'm';
          }
          try {
            var re = new RegExp(src, flags);
            compiled.push({ regex: re, replacement: String(pattern.replacement != null ? pattern.replacement : '') });
          } catch (err) {
            console.warn('[CDV] Failed to compile sanitize regex:', pattern.regex, err);
          }
        }
        return compiled;
      }

      function sanitizeText(text) {
        if (!text) return '';
        var value = String(text);
        for (var i = 0; i < state.sanitizers.length; i++) {
          try {
            value = value.replace(state.sanitizers[i].regex, state.sanitizers[i].replacement);
          } catch (_) {}
        }
        return value;
      }

      function limitTextByTokens(text, maxTokens) {
        if (!text) return '';
        if (!maxTokens || maxTokens <= 0) return text;
        var tokens = estimateTokens(text);
        if (tokens <= maxTokens) return text;
        var ratio = maxTokens / tokens;
        var targetChars = Math.max(120, Math.floor(text.length * ratio));
        return text.slice(0, targetChars) + '…';
      }

      function estimateTokens(text) {
        if (!text) return 0;
        var clean = String(text);
        return Math.max(1, Math.ceil(clean.length / 4));
      }

      function buildEndpoint(base) {
        var url = base || DEFAULT_CONFIG.api.base_url;
        if (!url) return '/chat/completions';
        var trimmed = String(url).trim().replace(/\/+$/, '');
        if (!trimmed) trimmed = DEFAULT_CONFIG.api.base_url;
        if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
        return trimmed + '/chat/completions';
      }

      function buildHeaders() {
        var headers = {};
        var src = state.config.api.headers || {};
        Object.keys(src).forEach(function(key){
          headers[key] = maybeNormalizeAuthHeader(key, src[key]);
        });
        if (!hasHeader(headers, 'authorization') && state.apiKey) {
          headers['Authorization'] = normalizeBearer(state.apiKey);
        }
        return headers;
      }

      function hasHeader(map, name) {
        var lower = name.toLowerCase();
        for (var key in map) {
          if (Object.prototype.hasOwnProperty.call(map, key)) {
            if (String(key).toLowerCase() === lower) return true;
          }
        }
        return false;
      }

      function maybeNormalizeAuthHeader(name, value) {
        if (!value) return value;
        if (String(name).toLowerCase() !== 'authorization') return value;
        return normalizeBearer(value);
      }

      function normalizeBearer(value) {
        if (!value) return value;
        var trimmed = String(value).trim();
        if (!trimmed) return trimmed;
        if (/^bearer\s+/i.test(trimmed)) {
          return trimmed;
        }
        // Some OpenRouter keys start with sk-; attach prefix automatically.
        return 'Bearer ' + trimmed;
      }

      function buildHttpError(status, body) {
        var message = 'HTTP ' + status;
        if (body) {
          var trimmed = body.trim();
          if (trimmed) {
            try {
              var parsed = JSON.parse(trimmed);
              if (parsed && parsed.error && parsed.error.message) {
                message += ' - ' + parsed.error.message;
              } else {
                message += ' - ' + trimmed.slice(0, 240);
              }
            } catch (_) {
              message += ' - ' + trimmed.slice(0, 240);
            }
          }
        }
        var err = new Error(message);
        err.status = status;
        return err;
      }

      function extractAssistantContent(data) {
        if (!data) return '';
        if (data.error && data.error.message) {
          throw new Error(data.error.message);
        }
        if (Array.isArray(data.choices) && data.choices.length > 0) {
          var choice = data.choices[0];
          if (choice.message && typeof choice.message.content === 'string') {
            return choice.message.content.trim();
          }
          if (typeof choice.text === 'string') {
            return choice.text.trim();
          }
        }
        return '';
      }

      function autoResizeTextarea(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(240, el.scrollHeight + 2) + 'px';
      }

      function debounce(fn, wait) {
        var timer = 0;
        return function(){
          var args = arguments;
          clearTimeout(timer);
          timer = setTimeout(function(){ fn.apply(null, args); }, wait);
        };
      }

      function loadFromStorage(key) {
        try {
          return localStorage.getItem(key);
        } catch (_) {
          return null;
        }
      }

      function saveToStorage(key, value) {
        try {
          if (value === null || value === undefined || value === '') {
            localStorage.removeItem(key);
          } else {
            localStorage.setItem(key, value);
          }
        } catch (_) {}
      }

      return {
        init: init
      };
    })();

    CDV_CHAT.init();
  } catch (e) {
    console && console.warn && console.warn('CDV inject error', e);
  }
})();
