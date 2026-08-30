(function () {
  'use strict';

  var VERSION = '3.1.0';
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var simulatorTimers = new WeakMap();

  document.documentElement.classList.add('report-js');
  document.documentElement.setAttribute('data-report-ds-version', VERSION);

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function panelsForBar(bar) {
    var panels = [];
    var sibling = bar.nextElementSibling;
    while (sibling && sibling.classList && (sibling.classList.contains('tab-pane') || sibling.classList.contains('tab-panel'))) {
      panels.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    if (panels.length) return panels;
    var root = bar.closest('.tab-set');
    if (!root) return panels;
    return Array.prototype.filter.call(root.children, function (child) {
      return child.classList && (child.classList.contains('tab-pane') || child.classList.contains('tab-panel'));
    });
  }

  function initTabSet(bar, setIndex) {
    var selector = bar.classList.contains('tabs') ? '.tb' : '.tab';
    var tabs = Array.prototype.slice.call(bar.querySelectorAll(selector));
    var panels = panelsForBar(bar);
    if (!tabs.length || !panels.length) return;

    var setId = 'report-tabs-' + setIndex;
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', bar.getAttribute('aria-label') || '内容视图');

    function keyForTab(tab, index) {
      return tab.getAttribute('data-tab') || String(index);
    }

    function keyForPanel(panel, index) {
      return panel.getAttribute('data-pane') || String(index);
    }

    function activate(tab, moveFocus) {
      var index = tabs.indexOf(tab);
      if (index < 0) return;
      var key = keyForTab(tab, index);
      tabs.forEach(function (item, itemIndex) {
        var active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
        item.setAttribute('tabindex', active ? '0' : '-1');
        if (!item.id) item.id = setId + '-tab-' + itemIndex;
      });
      panels.forEach(function (panel, panelIndex) {
        var active = keyForPanel(panel, panelIndex) === key;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
        panel.setAttribute('aria-hidden', String(!active));
        if (!panel.id) panel.id = setId + '-panel-' + panelIndex;
        if (active) {
          panel.setAttribute('aria-labelledby', tab.id);
          tab.setAttribute('aria-controls', panel.id);
        }
      });
      if (moveFocus) tab.focus();
      bar.dispatchEvent(new CustomEvent('report:tabchange', { bubbles: true, detail: { key: key } }));
    }

    tabs.forEach(function (tab, index) {
      tab.setAttribute('role', 'tab');
      if (tab.tagName === 'BUTTON' && !tab.getAttribute('type')) tab.setAttribute('type', 'button');
      if (!tab.id) tab.id = setId + '-tab-' + index;
      tab.addEventListener('click', function () { activate(tab, false); });
      tab.addEventListener('keydown', function (event) {
        var nextIndex = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') nextIndex = index;
        else return;
        event.preventDefault();
        activate(tabs[nextIndex], true);
      });
    });

    panels.forEach(function (panel, index) {
      panel.setAttribute('role', 'tabpanel');
      if (!panel.id) panel.id = setId + '-panel-' + index;
    });
    tabs.forEach(function (tab, index) {
      var key = keyForTab(tab, index);
      var panel = panels.find(function (candidate, panelIndex) { return keyForPanel(candidate, panelIndex) === key; });
      if (!panel) return;
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('aria-labelledby', tab.id);
      if (!panel.getAttribute('data-print-title')) panel.setAttribute('data-print-title', tab.textContent.trim());
    });

    activate(tabs.find(function (tab) { return tab.classList.contains('active'); }) || tabs[0], false);
  }

  function initTabs() {
    document.querySelectorAll('.tabs,.tabbar').forEach(function (bar, index) {
      initTabSet(bar, index);
    });
  }

  function formatNumber(value, decimals) {
    try {
      return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value);
    } catch (_) {
      return value.toFixed(decimals);
    }
  }

  function initCounters() {
    var jobs = [];
    document.querySelectorAll('.counter[data-target]').forEach(function (el) {
      jobs.push(new Promise(function (resolve) {
        var raw = el.getAttribute('data-target') || '0';
        var target = Number(raw);
        if (!Number.isFinite(target)) { resolve(); return; }
        var decimalsAttr = el.getAttribute('data-decimals');
        var inferredDecimals = Math.min(6, (raw.split('.')[1] || '').length);
        var decimalsValue = decimalsAttr === null ? inferredDecimals : Number(decimalsAttr);
        var decimals = Number.isFinite(decimalsValue) ? Math.max(0, Math.min(6, Math.floor(decimalsValue))) : inferredDecimals;
        var prefix = el.getAttribute('data-prefix') || '';
        var suffix = el.getAttribute('data-suffix') || '';
        var durationAttr = el.getAttribute('data-duration');
        var durationValue = durationAttr === null ? 1100 : Number(durationAttr);
        var duration = Number.isFinite(durationValue) ? Math.max(0, Math.min(10000, durationValue)) : 1100;
        var finalText = prefix + formatNumber(target, decimals) + suffix;
        el.setAttribute('aria-label', finalText);

        if (reducedMotion || duration === 0) {
          el.textContent = finalText;
          resolve();
          return;
        }

        var start = performance.now();
        function step(now) {
          var progress = Math.min((now - start) / duration, 1);
          var eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = prefix + formatNumber(target * eased, decimals) + suffix;
          if (progress < 1) requestAnimationFrame(step);
          else { el.textContent = finalText; resolve(); }
        }
        requestAnimationFrame(step);
      }));
    });
    return Promise.all(jobs);
  }

  function initProgress() {
    document.querySelectorAll('.anim-bar').forEach(function (bar) {
      var width = bar.style.getPropertyValue('--w') || getComputedStyle(bar).getPropertyValue('--w') || '0%';
      var value = Math.max(0, Math.min(100, parseFloat(width) || 0));
      var row = bar.closest('.bar-row');
      var label = row && row.querySelector('.lbl') ? row.querySelector('.lbl').textContent.trim() : '进度';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', label);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(value));
      if (reducedMotion) bar.classList.add('armed');
      else setTimeout(function () { bar.classList.add('armed'); }, 180);
    });
  }

  function initTableRegions() {
    document.querySelectorAll('.tbl-wrap').forEach(function (wrap, index) {
      var caption = wrap.querySelector('caption');
      if (!wrap.hasAttribute('tabindex')) wrap.setAttribute('tabindex', '0');
      if (!wrap.hasAttribute('role')) wrap.setAttribute('role', 'region');
      if (!wrap.hasAttribute('aria-label')) {
        wrap.setAttribute('aria-label', caption && caption.textContent.trim() ? caption.textContent.trim() : '可横向滚动的数据表格 ' + (index + 1));
      }
    });
  }

  function initTooltips() {
    document.querySelectorAll('.tip').forEach(function (tip, index) {
      var box = tip.querySelector('.tipbox');
      if (!box) return;
      if (!box.id) box.id = 'report-tip-' + index;
      box.setAttribute('role', 'tooltip');
      var trigger = tip.querySelector('a,button,input,select,textarea,[tabindex]') || tip;
      if (trigger === tip && !tip.hasAttribute('tabindex')) tip.setAttribute('tabindex', '0');
      var describedBy = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (describedBy.indexOf(box.id) < 0) describedBy.push(box.id);
      trigger.setAttribute('aria-describedby', describedBy.join(' '));
    });
  }

  var printDetailsState = null;
  function expandDetailsForPrint() {
    if (printDetailsState) return;
    printDetailsState = Array.prototype.map.call(document.querySelectorAll('details'), function (node) {
      var wasOpen = node.open;
      node.open = true;
      return { node: node, wasOpen: wasOpen };
    });
  }

  function restoreDetailsAfterPrint() {
    if (!printDetailsState) return;
    printDetailsState.forEach(function (entry) { entry.node.open = entry.wasOpen; });
    printDetailsState = null;
  }

  function initPrintExpansion() {
    window.addEventListener('beforeprint', expandDetailsForPrint);
    window.addEventListener('afterprint', restoreDetailsAfterPrint);
  }

  function markMermaidFallback(node, message) {
    if (node.querySelector('svg')) return;
    node.setAttribute('data-report-state', 'source');
    var wrap = node.closest('.mermaid-wrap');
    if (wrap && !wrap.querySelector('.mermaid-status')) {
      var status = document.createElement('div');
      status.className = 'mermaid-status';
      status.setAttribute('role', 'status');
      status.textContent = message;
      wrap.insertBefore(status, node);
    }
  }

  function loadMermaidDependency(timeoutMs) {
    if (window.mermaid) return Promise.resolve(true);
    var dependency = document.querySelector('meta[name="report-mermaid"]');
    var src = dependency && dependency.getAttribute('content');
    var integrity = dependency && dependency.getAttribute('data-sri');
    if (!src || !integrity) return Promise.resolve(false);

    document.documentElement.setAttribute('data-report-mermaid', 'loading');
    return new Promise(function (resolve) {
      var settled = false;
      var script = document.createElement('script');
      var finish = function (loaded, state) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        document.documentElement.setAttribute('data-report-mermaid', state);
        resolve(loaded);
      };
      var timer = setTimeout(function () {
        script.remove();
        finish(false, 'timeout');
      }, timeoutMs || 5000);
      script.src = src;
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.setAttribute('data-report-mermaid-loader', 'v1');
      script.onload = function () { finish(Boolean(window.mermaid), window.mermaid ? 'loaded' : 'source'); };
      script.onerror = function () { finish(false, 'source'); };
      document.head.appendChild(script);
    });
  }

  function whenWindowLoaded() {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) { window.addEventListener('load', resolve, { once: true }); });
  }

  function renderMermaidNodes(nodes) {
    var nonceMeta = document.querySelector('meta[name="report-style-nonce"]');
    var styleNonce = nonceMeta && nonceMeta.getAttribute('content');
    return Promise.all(nodes.map(function (node, index) {
      var source = node.textContent;
      var renderId = 'report-mermaid-' + Date.now() + '-' + index;
      return Promise.resolve(window.mermaid.render(renderId, source)).then(function (result) {
        var svg = result.svg;
        if (styleNonce) svg = svg.replace(/<style(?=[\s>])/g, '<style nonce="' + styleNonce + '"');
        node.innerHTML = svg;
        node.setAttribute('data-processed', 'true');
        if (typeof result.bindFunctions === 'function') result.bindFunctions(node);
      }).catch(function (error) {
        node.textContent = source;
        throw error;
      });
    }));
  }

  function initMermaid() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.mermaid:not([data-processed="true"])'));
    if (!nodes.length) {
      document.documentElement.setAttribute('data-report-mermaid', 'unused');
      return Promise.resolve();
    }
    // Start the optional 3.5 MB dependency only after window.load so a slow
    // CDN can never delay the report's initial document load.
    return whenWindowLoaded().then(function () { return loadMermaidDependency(12000); }).then(function (loaded) {
      if (!loaded || !window.mermaid) {
        nodes.forEach(function (node) { markMermaidFallback(node, '图表引擎未在时限内加载，已保留 Mermaid 源码。'); });
        document.documentElement.setAttribute('data-report-mermaid', 'source');
        return;
      }

      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'strict',
          themeVariables: {
            primaryColor: '#F5F0E4',
            primaryTextColor: '#1F1D17',
            primaryBorderColor: '#8B3A1F',
            lineColor: '#5A5447',
            secondaryColor: '#E8E1D2',
            tertiaryColor: '#FAF7F0',
            fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
            fontSize: '13px'
          },
          flowchart: { curve: 'basis', useMaxWidth: true, htmlLabels: false },
          sequence: { useMaxWidth: true, diagramMarginX: 20 },
          pie: { useMaxWidth: true },
          gantt: { useMaxWidth: true }
        });
        return renderMermaidNodes(nodes).then(function () {
          document.documentElement.setAttribute('data-report-mermaid', 'rendered');
        }).catch(function () {
          nodes.forEach(function (node) { markMermaidFallback(node, '图表渲染失败，已保留 Mermaid 源码。'); });
          document.documentElement.setAttribute('data-report-mermaid', 'source');
        });
      } catch (_) {
        nodes.forEach(function (node) { markMermaidFallback(node, '图表渲染失败，已保留 Mermaid 源码。'); });
        document.documentElement.setAttribute('data-report-mermaid', 'source');
      }
    });
  }

  function initNavigation() {
    var nav = document.getElementById('report-nav');
    var main = document.getElementById('report-main') || document.querySelector('.report-main');
    if (!nav || !main) return;
    nav.setAttribute('aria-label', nav.getAttribute('aria-label') || '报告目录');

    if (!nav.children.length) {
      var sections = main.querySelectorAll('section[id],.sec-head[id],[data-nav]');
      var count = 0;
      sections.forEach(function (section) {
        var id = section.id || section.getAttribute('data-nav');
        if (!id) return;
        var heading = section.querySelector('h1,h2,h3');
        var title = section.getAttribute('data-nav-title') || (heading && heading.textContent.trim()) || id;
        var group = section.getAttribute('data-nav-group');
        if (group) {
          var groupNode = document.createElement('div');
          groupNode.className = 'grp';
          groupNode.textContent = group;
          nav.appendChild(groupNode);
        }
        var link = document.createElement('a');
        var number = document.createElement('span');
        number.className = 'n';
        number.textContent = String(count).padStart(2, '0');
        link.href = '#' + id;
        link.appendChild(number);
        link.appendChild(document.createTextNode(' ' + title));
        nav.appendChild(link);
        count += 1;
      });
    }

    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    if (!links.length) return;

    function setActive(link) {
      links.forEach(function (item) {
        var active = item === link;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'location');
        else item.removeAttribute('aria-current');
      });
      if (window.innerWidth <= 960 && link) {
        link.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }

    links.forEach(function (link) {
      link.addEventListener('click', function () { setActive(link); });
    });
    setActive(links.find(function (link) { return link.classList.contains('active'); }) || links[0]);

    if ('IntersectionObserver' in window) {
      var byId = {};
      links.forEach(function (link) {
        var rawId = link.hash.slice(1);
        var id = rawId;
        try { id = decodeURIComponent(rawId); } catch (_) { /* keep the literal, audit reports invalid ids */ }
        byId[id] = link;
      });
      var observer = new IntersectionObserver(function (entries) {
        var visible = entries.filter(function (entry) { return entry.isIntersecting; });
        if (!visible.length) return;
        visible.sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
        var link = byId[visible[0].target.id];
        if (link) setActive(link);
      }, { rootMargin: '-10% 0px -55% 0px', threshold: [0.01, 0.25] });
      Object.keys(byId).forEach(function (id) {
        var target = document.getElementById(id);
        if (target) observer.observe(target);
      });
    }
  }

  function clearSimulator(root) {
    var timer = simulatorTimers.get(root);
    if (timer) clearTimeout(timer);
    simulatorTimers.delete(root);
    root.querySelectorAll('.sim-step').forEach(function (step) {
      step.classList.remove('run', 'fail');
      step.removeAttribute('aria-current');
      var glyph = step.querySelector('.glyph');
      if (glyph) glyph.textContent = '○';
    });
    var finalMessage = root.querySelector('[data-sim-final]') || document.getElementById('simFinal');
    if (finalMessage) {
      finalMessage.textContent = '';
      finalMessage.setAttribute('aria-live', 'polite');
    }
  }

  function simRun(mode, rootId) {
    var root = document.getElementById(rootId || 'simSteps');
    if (!root) return;
    clearSimulator(root);
    var steps = Array.prototype.slice.call(root.querySelectorAll('.sim-step'));
    var failAt = mode === 'good' ? -1 : (mode === 'bad-sec' ? 4 : 6);
    var index = 0;

    function runOne() {
      if (index >= steps.length) {
        steps.forEach(function (item) { item.removeAttribute('aria-current'); });
        var finalMessage = root.querySelector('[data-sim-final]') || document.getElementById('simFinal');
        var ok = mode === 'good';
        if (finalMessage) finalMessage.textContent = ok ? '✓ 全绿，流程通过' : '✗ 拦截成功，流程中止';
        if (window.talkSend) window.talkSend('sim-done', { mode: mode, ok: ok });
        simulatorTimers.delete(root);
        return;
      }
      var step = steps[index];
      var glyph = step.querySelector('.glyph');
      var failed = index === failAt;
      steps.forEach(function (item) { item.removeAttribute('aria-current'); });
      step.classList.add(failed ? 'fail' : 'run');
      step.setAttribute('aria-current', 'step');
      if (glyph) glyph.textContent = failed ? '✗' : '✓';
      index = failed ? steps.length : index + 1;
      simulatorTimers.set(root, setTimeout(runOne, reducedMotion ? 0 : 240));
    }
    runOne();
  }

  function simReset(rootId) {
    var root = document.getElementById(rootId || 'simSteps');
    if (root) clearSimulator(root);
  }

  function initSimulatorControls() {
    document.addEventListener('click', function (event) {
      var runButton = event.target && event.target.closest ? event.target.closest('[data-sim-mode]') : null;
      if (runButton) {
        simRun(runButton.getAttribute('data-sim-mode') || 'good', runButton.getAttribute('data-sim-root') || undefined);
        return;
      }
      var resetButton = event.target && event.target.closest ? event.target.closest('[data-sim-reset]') : null;
      if (resetButton) simReset(resetButton.getAttribute('data-sim-reset') || undefined);
    });
  }

  function audit(root) {
    root = root || document;
    var errors = [];
    var warnings = [];
    var idCounts = {};
    root.querySelectorAll('[id]').forEach(function (node) {
      idCounts[node.id] = (idCounts[node.id] || 0) + 1;
    });
    Object.keys(idCounts).forEach(function (id) {
      if (idCounts[id] > 1) errors.push('重复 id：' + id);
    });

    var h1Count = root.querySelectorAll('h1').length;
    if (h1Count !== 1) errors.push('正式汇报必须恰好使用一个 h1；当前为 ' + h1Count + ' 个。');
    if (!root.querySelector('.hero h1')) errors.push('hero 中缺少 h1。');
    var headingLevels = Array.prototype.map.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (heading) {
      return Number(heading.tagName.slice(1));
    });
    for (var headingIndex = 1; headingIndex < headingLevels.length; headingIndex += 1) {
      if (headingLevels[headingIndex] > headingLevels[headingIndex - 1] + 1) {
        warnings.push('标题层级从 h' + headingLevels[headingIndex - 1] + ' 跳到 h' + headingLevels[headingIndex] + '。');
        break;
      }
    }
    root.querySelectorAll('.kpi').forEach(function (node, index) {
      if (!node.querySelector('.num') || !node.querySelector('.lbl')) warnings.push('第 ' + (index + 1) + ' 个 KPI 缺少 .num 或 .lbl。');
    });
    root.querySelectorAll('img').forEach(function (node) {
      if (!node.hasAttribute('alt')) warnings.push('图片缺少 alt：' + (node.getAttribute('src') || '(inline)'));
    });
    root.querySelectorAll('button').forEach(function (node) {
      if (!node.textContent.trim() && !node.getAttribute('aria-label')) warnings.push('按钮缺少可访问名称。');
    });
    root.querySelectorAll('.tbl-wrap').forEach(function (node) {
      if (!node.hasAttribute('tabindex') || !node.getAttribute('aria-label')) warnings.push('横向表格容器缺少键盘焦点或可访问名称。');
    });
    var inlineStyleNodes = Array.prototype.slice.call(root.querySelectorAll('[style]')).filter(function (node) {
      return !node.closest('.mermaid svg') && !node.classList.contains('mermaidTooltip');
    });
    var nonTokenInlineStyles = inlineStyleNodes.filter(function (node) {
      return node.getAttribute('style').split(';').map(function (part) { return part.trim(); }).filter(Boolean)
        .some(function (part) { return !/^--[a-z0-9_-]+\s*:/i.test(part); });
    }).length;
    if (nonTokenInlineStyles > 0) warnings.push('正文含 ' + nonTokenInlineStyles + ' 个非令牌内联 style；优先使用设计系统 class。');

    return {
      version: VERSION,
      errors: errors,
      warnings: warnings,
      stats: {
        sections: root.querySelectorAll('section[id]').length,
        cards: root.querySelectorAll('.card').length,
        kpis: root.querySelectorAll('.kpi').length,
        tables: root.querySelectorAll('table').length,
        inlineStyles: inlineStyleNodes.length
      }
    };
  }

  window.simRun = simRun;
  window.simReset = simReset;
  window.ReportDesignSystem = Object.freeze({ version: VERSION, audit: audit, simRun: simRun, simReset: simReset });


  function initTrace() {
    var node = document.getElementById('report-trace-data');
    var root = document.getElementById('report-trace-root');
    if (!node || !root) return;
    var raw = (node.textContent || '').trim();
    if (!raw || raw === '{{' + 'trace}}') return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !Array.isArray(data.steps) || !data.steps.length) return;
    var T = { think: ['#2f5061', '思考'], tool: ['#3f6b3d', '工具'], wait: ['#7a5713', '等待'], fail: ['#9c3a2e', '失败'] };
    var steps = data.steps.map(function (s, i) {
      var t = T[s.t] ? s.t : 'tool';
      return { t: t, label: String(s.label || ('步骤 ' + (i + 1))), ms: Number(s.ms) || 400, kind: s.kind || t, detail: s.detail || '', cmd: s.cmd, out: s.out, flagged: !!s.flagged };
    });
    var max = Math.max.apply(null, steps.map(function (s) { return s.ms; }));
    var st = data.stats || {};
    root.classList.add('trace-on');
    root.innerHTML =
      '<div class="trace-panel"><div class="trace-head">会话轨迹回放<span class="hint">talkSend · trace.*</span></div>' +
      '<div class="trace-stats">' +
      (st.tokens ? '<span>tokens <b>' + st.tokens + '</b></span>' : '') +
      (st.time ? '<span>耗时 <b>' + st.time + '</b></span>' : '') +
      (st.cost ? '<span>花费 <b>' + st.cost + '</b></span>' : '') +
      '<span>步骤 <b>' + steps.length + '</b></span>' +
      '<span>失败 <b>' + steps.filter(function (s) { return s.t === 'fail'; }).length + '</b></span>' +
      '</div><div class="trace-water">' +
      steps.map(function (s, i) {
        var c = T[s.t][0];
        return '<div class="trow" data-i="' + i + '" style="' + (s.flagged ? 'border-color:var(--bad)' : '') + '">' +
          '<span class="no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="t" style="background:' + c + '">' + T[s.t][1] + '</span>' +
          '<span class="lbl">' + s.label + '</span>' +
          '<span class="track"><span class="bar" style="width:' + Math.round(s.ms / max * 100) + '%;background:' + c + '"></span></span>' +
          '<span class="ms">' + (s.ms / 1000).toFixed(1) + 's</span>' +
          '<button class="flag' + (s.flagged ? ' on' : '') + '" data-i="' + i + '" title="这步不该发生">⚑</button></div>';
      }).join('') + '</div><div class="trace-review" id="trace-review"></div></div>';
    var water = root.querySelector('.trace-water');
    function review() {
      var f = steps.filter(function (s) { return s.flagged; });
      var box = root.querySelector('#trace-review');
      box.innerHTML = f.length ? f.map(function (s, i) {
        return '<div class="item"><span style="color:var(--bad)">⚑</span><b>' + s.label + '</b><span style="margin-left:auto;font-size:10.5px;color:var(--txt-faint)">' + T[s.t][1] + '</span></div>';
      }).join('') : '<div class="trace-empty">暂无标记 · 问题步骤点行右侧 ⚑</div>';
    }
    water.addEventListener('click', function (e) {
      var flag = e.target.closest('.flag');
      if (flag) { var i = +flag.dataset.i; steps[i].flagged = !steps[i].flagged; flag.classList.toggle('on', steps[i].flagged);
        flag.closest('.trow').style.borderColor = steps[i].flagged ? 'var(--bad)' : '';
        if (window.talkSend) window.talkSend('trace.flag', { step: steps[i].label, flag: steps[i].flagged });
        review(); return; }
      var row = e.target.closest('.trow'); if (!row) return;
      var s = steps[+row.dataset.i]; var c = T[s.t][0];
      var m = document.createElement('div'); m.className = 'trace-modal';
      m.innerHTML = '<div class="box"><button class="x">✕</button><h4><span style="color:' + c + '">' + T[s.t][1] + '</span> · ' + s.label + '</h4>' +
        (s.kind === 'bash' && s.cmd ? '<div class="trace-detail">' + s.cmd + (s.out ? '\n' + s.out : '') + '</div>' : (s.detail ? '<div style="font-size:12.5px;color:var(--txt-dim)">' + s.detail + '</div>' : ''));
      document.body.appendChild(m);
      m.querySelector('.x').onclick = function () { m.remove(); };
      m.addEventListener('mousedown', function (ev) { if (ev.target === m) m.remove(); });
    });
    review();
  }

  onReady(function () {
    initTabs();
    var countersReady = initCounters();
    initProgress();
    initNavigation();
    initTableRegions();
    initTooltips();
    initTrace();
    initPrintExpansion();
    initSimulatorControls();
    var mermaidReady = Promise.resolve(initMermaid());
    // Core readiness is independent of the optional 3.5 MB chart engine. Mermaid
    // keeps readable source visible while it loads and publishes its own state.
    Promise.resolve(countersReady).finally(function () {
      document.documentElement.setAttribute('data-report-ready', 'true');
      document.dispatchEvent(new CustomEvent('report:ready', { detail: audit(document) }));
    });
    mermaidReady.finally(function () {
      document.dispatchEvent(new CustomEvent('report:mermaidready', { detail: { state: document.documentElement.getAttribute('data-report-mermaid') } }));
    });
  });
})();
