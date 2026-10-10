/* chat.js · AI 助手聊天 */
'use strict';

(function () {
  var history = [];
  var QUICK = [
    '谁是我的敌人？',
    '我和每个人是什么关系？帮我做个亲疏排名。',
    '梳理一下陈北这个人，最近他在想什么？',
    '苏晚和赵烽之间关系如何？',
    '从日记里总结一下我最近的人际动态',
    '帮我把人物按“可信任程度”排个序'
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderText(s) {
    var t = escapeHtml(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    t = t.replace(/\n/g, '<br/>');
    return t;
  }

  function appendBubble(role, html, isThinking) {
    var log = document.getElementById('chatLog');
    var div = document.createElement('div');
    div.className = 'chat-bubble chat-' + role;
    var av = document.createElement('div');
    av.className = 'cb-avatar';
    av.textContent = role === 'ai' ? '✦' : '我';
    var body = document.createElement('div');
    body.className = 'cb-body';
    var r = document.createElement('div');
    r.className = 'cb-role';
    r.textContent = role === 'ai' ? 'AI 助手' : '我';
    var t = document.createElement('div');
    t.className = 'cb-text' + (isThinking ? ' thinking' : '');
    t.innerHTML = html;
    body.appendChild(r);
    body.appendChild(t);
    div.appendChild(av);
    div.appendChild(body);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return t;
  }

  function setBusy(busy) {
    document.getElementById('btnSend').disabled = busy;
    document.getElementById('chatInput').disabled = busy;
  }

  function send(question) {
    var input = document.getElementById('chatInput');
    var q = (question !== undefined && question !== null) ? String(question).trim() : input.value.trim();
    if (!q || document.getElementById('btnSend').disabled) return;
    if (question === undefined) input.value = '';
    grow();

    appendBubble('user', renderText(q));
    var thinkingEl = appendBubble('ai', '思考中…（正在结合你的人物图谱 JSON 分析）', true);
    setBusy(true);

    window.api.chat(q, history.slice(0, 40)).then(function (r) {
      thinkingEl.className = 'cb-text';
      thinkingEl.innerHTML = renderText(r.reply || '(无内容)');
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: r.reply || '' });
      if (history.length > 40) history = history.slice(-40);
      var log = document.getElementById('chatLog');
      log.scrollTop = log.scrollHeight;
    }).catch(function (e) {
      thinkingEl.className = 'cb-text';
      thinkingEl.innerHTML = '<span class="muted">⚠ ' + escapeHtml((e && e.message) || String(e)) + '</span>';
    }).finally(function () {
      setBusy(false);
      input.focus();
    });
  }

  function grow() {
    var ta = document.getElementById('chatInput');
    ta.style.height = 'auto';
    ta.style.height = Math.min(130, Math.max(38, ta.scrollHeight)) + 'px';
  }

  function updateStats(n, r, d) {
    document.getElementById('statPersons').textContent = n;
    document.getElementById('statRelations').textContent = r;
    document.getElementById('statDiaries').textContent = d;
  }

  function init() {
    var input = document.getElementById('chatInput');
    var btn = document.getElementById('btnSend');
    var list = document.getElementById('quickList');

    QUICK.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'quick-item';
      b.textContent = q;
      b.addEventListener('click', function () { send(q); });
      list.appendChild(b);
    });

    function trySend() { send(); }
    btn.addEventListener('click', trySend);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', grow);

    document.getElementById('btnViewContext').addEventListener('click', function () {
      window.api.context().then(function (r) {
        var body = document.createElement('div');
        body.className = 'pre-line';
        body.textContent = r.prompt;
        window.UI.openModal('📄 问答时携带的知识（JSON）', body, [{ label: '关闭' }]);
      }).catch(function (e) {
        window.UI.toast((e && e.message) || String(e), true);
      });
    });
  }

  window.Chat = { init: init, send: send, updateStats: updateStats, clearHistory: function () { history = []; } };
})();