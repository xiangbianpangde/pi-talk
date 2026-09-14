(function () {
  'use strict';

  var VERSION = '1.0.0';
  document.documentElement.classList.add('explain-js');
  document.documentElement.setAttribute('data-explain-ds-version', VERSION);

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function initCheckButtons() {
    document.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-talk-event="explain-check"]') : null;
      if (!btn) return;

      var card = btn.closest('.check-card');
      if (card) {
        card.querySelectorAll('button[data-talk-event="explain-check"]').forEach(function (b) {
          b.classList.remove('selected');
          b.removeAttribute('aria-pressed');
        });
      }
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
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
      if (idCounts[id] > 1) errors.push('重复 ID：' + id);
    });

    var h1s = root.querySelectorAll('h1');
    if (h1s.length !== 1) {
      errors.push('Explain 页面必须有且仅有一个 h1；当前找到 ' + h1s.length + ' 个。');
    }

    // 核心硬原则：绝对禁止 <details> 折叠
    var details = root.querySelectorAll('details');
    if (details.length > 0) {
      errors.push('Explain 页面严禁使用 <details> 隐藏或折叠教学内容；必须直接平铺可见（发现 ' + details.length + ' 个）。');
    }

    // 校验标题层级
    var headings = Array.prototype.map.call(root.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) {
      return Number(h.tagName.slice(1));
    });
    for (var i = 1; i < headings.length; i += 1) {
      if (headings[i] > headings[i - 1] + 1) {
        warnings.push('标题层级跳跃：从 h' + headings[i - 1] + ' 跳到 h' + headings[i] + '。');
        break;
      }
    }

    // 校验类比卡片必须包含类比文本和失效说明
    root.querySelectorAll('.analogy-card').forEach(function (node, index) {
      if (!node.querySelector('.analogy-text') || !node.querySelector('.breakage-note')) {
        errors.push('第 ' + (index + 1) + ' 个类比卡片缺少 .analogy-text 或 .breakage-note。');
      }
    });

    // 校验无障碍按钮
    root.querySelectorAll('button').forEach(function (node) {
      if (!node.textContent.trim() && !node.getAttribute('aria-label')) {
        warnings.push('按钮缺少文本或 aria-label。');
      }
    });

    return {
      version: VERSION,
      errors: errors,
      warnings: warnings,
      stats: {
        layers: root.querySelectorAll('.layer-block').length,
        checks: root.querySelectorAll('.check-card').length,
        analogies: root.querySelectorAll('.analogy-card').length,
        codeBlocks: root.querySelectorAll('.code-block').length
      }
    };
  }

  onReady(initCheckButtons);

  window.ExplainDesignSystem = Object.freeze({
    version: VERSION,
    audit: audit
  });
})();
