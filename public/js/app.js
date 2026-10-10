/* ============================================================
 * app.js · 主逻辑：标签页 / 人物 / 日记 / 关系 / 弹窗 / 导入导出
 * ============================================================ */
'use strict';

(function () {
  var state = { persons: [], relations: [], diaries: [], settings: { ai: {} } };
  var graph = null;
  var currentTab = 'graph';
  var editingDiaryId = null;
  var chipOverride = {};
  var panelSel = null;

  var REL_TYPES = ['朋友', '好友', '恋人', '敌人', '对手', '家人', '同事', '同学', '师徒', '盟友', '密友', '认识', '讨厌', '不和', '客户', '陌生人'];
  var GENDERS = ['男', '女', '其他', '保密'];
  var SWATCHES = ['#5b8cff', '#ff6b9d', '#4dd0a1', '#ffa94d', '#b197fc', '#63e6be', '#ff8787', '#74c0fc', '#ffd43b', '#e599f7', '#8ce99a', '#ffc078'];
  var PRESETS = [
    { name: 'DeepSeek（推荐）', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { name: '阿里百炼（通义千问）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: '本地 Ollama', base: 'http://127.0.0.1:11434/v1', model: 'llama3.1' }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg, isErr) {
    var root = $('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2600);
    setTimeout(function () { el.remove(); }, 3000);
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function personById(id) { return byId(state.persons, id); }
  function relationById(id) { return byId(state.relations, id); }
  function diaryById(id) { return byId(state.diaries, id); }
  function stars(n) {
    n = Math.max(1, Math.min(5, Number(n) || 1));
    var s = '';
    for (var i = 1; i <= 5; i++) s += (i <= n ? '★' : '☆');
    return s;
  }
  function avatarHtml(p, sizePx) {
    var ch = esc((p.name || '?').charAt(0));
    var st = 'background:' + esc(p.color || '#5b8cff') + (sizePx ? ';width:' + sizePx + 'px;height:' + sizePx + 'px;font-size:' + Math.round(sizePx * 0.42) + 'px' : '');
    return '<div class="avatar" style="' + st + '">' + ch + '</div>';
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(title, bodyEl, buttons) {
    var root = $('modalRoot');
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'modal';
    var header = document.createElement('div');
    header.className = 'modal-header';
    var tspan = document.createElement('span');
    tspan.textContent = title;
    header.appendChild(tspan);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn icon';
    closeBtn.textContent = '✕';
    header.appendChild(closeBtn);
    var body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof bodyEl === 'string') body.innerHTML = bodyEl;
    else if (bodyEl) body.appendChild(bodyEl);
    var foot = document.createElement('div');
    foot.className = 'modal-foot';
    (buttons || [{ label: '关闭' }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '') + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      foot.appendChild(btn);
      btn.addEventListener('click', function () {
        var r;
        if (b.fn) r = b.fn();
        if (r !== false) close();
      });
    });
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    return { body: body, modal: modal, close: close };
  }

  function confirmModal(text, onYes) {
    var body = document.createElement('div');
    body.innerHTML = '<div style="line-height:2">' + text + '</div>';
    openModal('⚠️ 确认操作', body, [
      { label: '取消', cls: 'ghost' },
      { label: '确定', cls: 'danger', fn: function () { onYes(); } }
    ]);
  }

  window.UI = { openModal: openModal, toast: toast };

  /* ---------------- 数据 ---------------- */
  function refresh() {
    return window.api.state().then(function (s) {
      state = s;
      if (!state.settings || !state.settings.ai) state.settings = { ai: { baseUrl: '', apiKey: '', model: '' } };
      renderAll();
    }).catch(function (e) { toast((e && e.message) || String(e), true); });
  }

  function renderAll() {
    if (editingDiaryId && !diaryById(editingDiaryId)) closeDiaryEditor();
    renderGraph();
    renderPersons();
    renderDiaryList();
    renderStats();
    renderPanel();
  }

  /* ---------------- 图谱 ---------------- */
  function renderGraph() {
    if (!graph) {
      graph = new window.GraphView($('graphStage'), $('graphSvg'), {
        onSelectNode: function (id) { panelSel = id ? 'p:' + id : null; renderPanel(); },
        onSelectRelation: function (id) { if (id) panelSel = 'r:' + id; renderPanel(); },
        onConnect: function (from, to) {
          if (!state.persons.length) return;
          panelSel = null;
          openRelationModal(null, from, to);
        }
      });
    }
    graph.setData(state.persons, state.relations);
    $('graphEmpty').hidden = state.persons.length > 0;
  }

  function showPersonOnGraph(id) {
    switchTab('graph');
    if (graph) graph.flashNode(id);
    panelSel = 'p:' + id;
    renderPanel();
  }

  function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab').forEach(function (s) {
      s.classList.toggle('active', s.id === 'tab-' + name);
    });
    if (name === 'graph' && graph) setTimeout(function () { graph.resize(); }, 40);
  }

  /* ---------------- 右侧详情面板 ---------------- */
  function relationOfPerson(p) {
    return state.relations.filter(function (r) { return r.source === p.id || r.target === p.id; });
  }
  function diariesOfPerson(p) {
    return state.diaries.filter(function (d) { return (d.mentions || []).indexOf(p.id) !== -1; });
  }

  function renderPanel() {
    var panel = $('graphPanel');
    var title = $('gpTitle');
    var body = $('gpBody');
    if (!panelSel) { panel.hidden = true; return; }
    var kind = panelSel.charAt(0);
    var id = panelSel.slice(2);
    if (kind === 'p') {
      var p = personById(id);
      if (!p) { panel.hidden = true; return; }
      title.textContent = '👤 ' + p.name;
      body.innerHTML = personPanelHtml(p);
      bindPersonPanel(p);
    } else {
      var r = relationById(id);
      if (!r) { panel.hidden = true; return; }
      title.textContent = '🔗 关系详情';
      body.innerHTML = relationPanelHtml(r);
      bindRelationPanel(r);
    }
    panel.hidden = false;
  }

  function personPanelHtml(p) {
    var rels = relationOfPerson(p);
    var dts = diariesOfPerson(p);
    var meta = [
      ['与我的关系', p.relationLabel || '—'],
      ['性别', p.gender || '—'],
      ['年龄', p.age === '' || p.age == null ? '—' : (p.age + ' 岁')],
      ['身高', p.height === '' || p.height == null ? '—' : (p.height + ' cm')],
      ['职业', p.occupation || '—'],
      ['标签', (p.tags || []).map(esc).join(' / ') || '—']
    ].map(function (kv) {
      return '<div class="kv"><div class="k">' + kv[0] + '</div><div class="v">' + kv[1] + '</div></div>';
    }).join('');

    var relHtml = rels.length ? rels.map(function (r) {
      var otherId = r.source === p.id ? r.target : r.source;
      var other = personById(otherId);
      var otherName = other ? esc(other.name) : '（已删除）';
      var dir = r.directed ? ' ➜' : ' ↔';
      return '<div class="rel-row">' +
        '<div class="rr-names"><span class="rr-type">' + esc(r.type || '关系') + '</span> ' + dir + ' <b>' + otherName + '</b><br/><span class="strength">' + stars(r.strength) + '</span>' +
        (r.note ? '<div class="muted small">' + esc(r.note) + '</div>' : '') + '</div>' +
        '<div class="rr-tail"><button class="btn icon" data-edit-rel="' + r.id + '">✎</button>' +
        '<button class="btn icon danger" data-del-rel="' + r.id + '">✕</button></div></div>';
    }).join('') : '<div class="muted small">还没有关系，点下方「添加关系」</div>';

    var dtHtml = dts.length ? dts.map(function (d) {
      return '<div class="person-mini" data-open-diary="' + d.id + '">' +
        '<div class="mini-dot">📖</div><div><div class="mini-name">' + esc(d.title || '（无标题）') + '</div>' +
        '<div class="mini-sub">' + esc(d.date || '') + '</div></div></div>';
    }).join('') : '<div class="muted small">日记中还没有提到 TA</div>';

    return '<div class="person-hero">' + avatarHtml(p, 52) +
      '<div><div class="ph-name">' + esc(p.name) + '</div><div class="ph-sub">' + esc(p.relationLabel || '未分类') + ' · ' + esc(p.gender || '') + '</div></div></div>' +
      '<div class="kv-grid">' + meta + '</div>' +
      '<div class="gp-section"><h4>简介 / 经历</h4><div class="notes-box">' + esc(p.notes || '（暂无）') + '</div></div>' +
      '<div class="gp-section"><h4>人物关系（' + rels.length + '）</h4>' + relHtml + '</div>' +
      '<div class="gp-section"><h4>日记中提到（' + dts.length + '）</h4>' + dtHtml + '</div>' +
      '<div class="gp-section" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn" id="paEdit">✎ 编辑资料</button>' +
      '<button class="btn primary" id="paAddRel">🔗 添加关系</button>' +
      '<button class="btn danger" id="paDel">🗑 删除人物</button></div>';
  }

  function bindPersonPanel(p) {
    var edit = $('paEdit');
    if (edit) edit.addEventListener('click', function () { openPersonModal(p); });
    var add = $('paAddRel');
    if (add) add.addEventListener('click', function () { openRelationModal(null, p.id, null); });
    var del = $('paDel');
    if (del) del.addEventListener('click', function () {
      confirmModal('确定删除人物「' + esc(p.name) + '」？<br/>与 TA 的所有关系和日记关联也会一并移除。', function () {
        window.api.deletePerson(p.id).then(function () {
          toast('已删除「' + p.name + '」');
          panelSel = null;
          if (graph) graph.clearSelection();
          refresh();
        }).catch(function (e) { toast((e && e.message) || String(e), true); });
      });
    });
    $('gpBody').querySelectorAll('[data-edit-rel]').forEach(function (btn) {
      btn.addEventListener('click', function () { openRelationModal(relationById(btn.getAttribute('data-edit-rel'))); });
    });
    $('gpBody').querySelectorAll('[data-del-rel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = relationById(btn.getAttribute('data-del-rel'));
        if (!r) return;
        confirmModal('断开这段关系？', function () {
          window.api.deleteRelation(r.id).then(function () { toast('已断开'); refresh(); }).catch(function (e) { toast((e && e.message) || String(e), true); });
        });
      });
    });
    $('gpBody').querySelectorAll('[data-open-diary]').forEach(function (el) {
      el.addEventListener('click', function () {
        var d = diaryById(el.getAttribute('data-open-diary'));
        if (d) { switchTab('diaries'); openDiaryEditor(d); }
      });
    });
  }

  function relationPanelHtml(r) {
    var a = personById(r.source);
    var b = personById(r.target);
    var aName = a ? esc(a.name) : '（已删除）';
    var bName = b ? esc(b.name) : '（已删除）';
    var dir = r.directed ? '单向：' + aName + ' ➜ ' + bName : '双向：' + aName + ' ↔ ' + bName;
    return '<div class="resume"><div class="r-t">' + aName + ' — ' + bName + '</div><div class="r-s">' + esc(r.type || '关系') + '</div></div>' +
      '<div class="kv-grid">' +
      '<div class="kv"><div class="k">关系类型</div><div class="v">' + esc(r.type || '—') + '</div></div>' +
      '<div class="kv"><div class="k">强度</div><div class="v"><span class="strength">' + stars(r.strength) + '</span></div></div>' +
      '</div>' +
      '<div class="kv-grid"><div class="kv" style="grid-column:1/-1"><div class="k">方向</div><div class="v">' + dir + '</div></div></div>' +
      '<div class="gp-section"><h4>备注</h4><div class="notes-box">' + esc(r.note || '（暂无）') + '</div></div>' +
      '<div class="gp-section" style="display:flex;gap:8px">' +
      '<button class="btn primary" id="raEdit">✎ 编辑关系</button>' +
      '<button class="btn danger" id="raDel">🗑 删除关系</button></div>';
  }

  function bindRelationPanel(r) {
    var e = $('raEdit');
    if (e) e.addEventListener('click', function () { openRelationModal(r); });
    var d = $('raDel');
    if (d) d.addEventListener('click', function () {
      confirmModal('断开这段关系？', function () {
        window.api.deleteRelation(r.id).then(function () { toast('已断开'); panelSel = null; if (graph) graph.clearSelection(); refresh(); })
          .catch(function (e2) { toast((e2 && e2.message) || String(e2), true); });
      });
    });
  }

  /* ---------------- 人物页 ---------------- */
  function renderPersons() {
    var q = ($('personSearch').value || '').trim().toLowerCase();
    var grid = $('personsGrid');
    grid.innerHTML = '';
    var list = state.persons.filter(function (p) {
      if (!q) return true;
      var hay = (p.name + ' ' + (p.relationLabel || '') + ' ' + (p.occupation || '') + ' ' + (p.tags || []).join(' ') + ' ' + (p.notes || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    if (!list.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + (q ? '没有匹配的人物' : '还没有人物，点击「添加人物」开始记录你身边的人') + '</div>';
      return;
    }
    list.forEach(function (p) { grid.appendChild(personCard(p)); });
  }

  function personCard(p) {
    var rels = relationOfPerson(p).length;
    var dts = diariesOfPerson(p).length;
    var card = document.createElement('div');
    card.className = 'person-card';
    var meta = [];
    if (p.age !== '' && p.age != null) meta.push('年龄 ' + p.age);
    if (p.height !== '' && p.height != null) meta.push('身高 ' + p.height + 'cm');
    if (p.occupation) meta.push(p.occupation);
    card.innerHTML = '<div class="pc-top">' + avatarHtml(p, 46) +
      '<div><div class="pc-name">' + esc(p.name) + '</div><div class="pc-sub">' + esc(p.relationLabel || '未分类') + ' · ' + esc(p.gender || '') + '</div></div></div>' +
      '<div class="pc-meta">' + (meta.length ? meta.map(esc).join(' · ') : '<span class="muted">暂无更多信息</span>') + '</div>' +
      (p.notes ? '<div class="pc-notes">' + esc(p.notes) + '</div>' : '') +
      '<div class="pc-foot"><span class="pc-count">🔗 ' + rels + ' 段关系 · 📖 ' + dts + ' 篇日记</span>' +
      '<div class="pc-actions"><button class="btn ghost" data-pa="edit">编辑</button><button class="btn ghost danger" data-pa="del">删除</button></div></div>';
    card.addEventListener('click', function (e) {
      var act = e.target.closest('[data-pa]');
      if (act) {
        if (act.getAttribute('data-pa') === 'edit') openPersonModal(p);
        else confirmModal('确定删除人物「' + esc(p.name) + '」？<br/>与 TA 的所有关系和日记关联也会一并移除。', function () {
          window.api.deletePerson(p.id).then(function () { toast('已删除'); refresh(); }).catch(function (e2) { toast((e2 && e2.message) || String(e2), true); });
        });
        return;
      }
      showPersonOnGraph(p.id);
    });
    return card;
  }

  /* ---------------- 人物弹窗 ---------------- */
  function personFormHtml(p) {
    var body = document.createElement('div');
    var genderOpts = GENDERS.map(function (g) {
      return '<option value="' + g + '"' + (p && p.gender === g ? ' selected' : '') + '>' + g + '</option>';
    }).join('');
    var swatches = SWATCHES.map(function (c) {
      return '<div class="swatch" data-c="' + c + '" style="background:' + c + '"></div>';
    }).join('');
    body.innerHTML = '<div class="form-row"><label class="required">姓名</label><input id="pfName" placeholder="如：苏晚"/></div>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>与我的关系</label><input id="pfRelation" list="dlRel" placeholder="朋友 / 敌人 / 恋人…"/></div>' +
      '<div class="form-row"><label>性别</label><select id="pfGender">' + genderOpts + '</select></div></div>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>年龄</label><input id="pfAge" type="number" min="0" placeholder="26"/></div>' +
      '<div class="form-row"><label>身高（cm）</label><input id="pfHeight" type="number" min="0" placeholder="170"/></div></div>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>职业</label><input id="pfOccupation" placeholder="程序员"/></div>' +
      '<div class="form-row"><label>标签（逗号分隔）</label><input id="pfTags" placeholder="发小, 同事"/></div></div>' +
      '<div class="form-row"><label>球体颜色</label><div class="swatches" id="pfSwatches">' + swatches + '</div><input type="hidden" id="pfColor"/></div>' +
      '<div class="form-row"><label>简介 / 经历 / 印象</label><textarea id="pfNotes" rows="4" placeholder="写写他/她的情况、经历、性格…（会被 AI 助手引用）"></textarea></div>' +
      '<datalist id="dlRel">' + REL_TYPES.map(function (t) { return '<option value="' + t + '"></option>'; }).join('') + '</datalist>';
    var v = function (id) { return body.querySelector('#' + id); };
    if (p) {
      v('pfName').value = p.name || '';
      v('pfRelation').value = p.relationLabel || '';
      v('pfGender').value = p.gender || '保密';
      v('pfAge').value = p.age === '' || p.age == null ? '' : p.age;
      v('pfHeight').value = p.height === '' || p.height == null ? '' : p.height;
      v('pfOccupation').value = p.occupation || '';
      v('pfTags').value = (p.tags || []).join(', ');
      v('pfColor').value = p.color || '';
      v('pfNotes').value = p.notes || '';
    } else {
      v('pfColor').value = SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
    }
    var sel = v('pfColor').value || SWATCHES[0];
    body.querySelectorAll('.swatch').forEach(function (s) {
      if (s.getAttribute('data-c') === sel) s.classList.add('sel');
      s.addEventListener('click', function () {
        body.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
        s.classList.add('sel');
        v('pfColor').value = s.getAttribute('data-c');
      });
    });
    return body;
  }

  function openPersonModal(p) {
    var body = personFormHtml(p);
    var saving = false;
    openModal(p ? '✎ 编辑人物' : '➕ 添加人物', body, [
      { label: '取消', cls: 'ghost' },
      {
        label: p ? '保存修改' : '添加', cls: 'primary',
        fn: function () {
          if (saving) return false;
          var d = {
            name: body.querySelector('#pfName').value.trim(),
            relationLabel: body.querySelector('#pfRelation').value.trim(),
            gender: body.querySelector('#pfGender').value,
            age: body.querySelector('#pfAge').value,
            height: body.querySelector('#pfHeight').value,
            occupation: body.querySelector('#pfOccupation').value.trim(),
            tags: body.querySelector('#pfTags').value.split(/[,，、\s]+/).filter(Boolean),
            color: body.querySelector('#pfColor').value,
            notes: body.querySelector('#pfNotes').value
          };
          if (!d.name) { toast('请填写姓名', true); return false; }
          saving = true;
          var req = p ? window.api.updatePerson(p.id, d) : window.api.createPerson(d);
          req.then(function () {
            toast(p ? '已保存' : '已添加「' + d.name + '」');
            refresh();
          }).catch(function (e) { saving = false; toast((e && e.message) || String(e), true); return false; });
        }
      }
    ]);
  }

  /* ---------------- 关系弹窗 ---------------- */
  function openRelationModal(rel, preSource, preTarget) {
    if (!state.persons.length) { toast('先添加人物，才能建立关系', true); openPersonModal(null); return; }
    var opts = state.persons.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    var body = document.createElement('div');
    body.innerHTML = '<div class="form-grid">' +
      '<div class="form-row"><label class="required">人物 A</label><select id="rfSource">' + opts + '</select></div>' +
      '<div class="form-row"><label class="required">人物 B</label><select id="rfTarget">' + opts + '</select></div></div>' +
      '<div class="form-row"><label>关系类型</label><input id="rfType" list="dlRel2" placeholder="朋友 / 敌人 / 恋人 / 师徒…"/><datalist id="dlRel2">' + REL_TYPES.map(function (t) { return '<option value="' + t + '"></option>'; }).join('') + '</datalist></div>' +
      '<div class="form-row"><label>亲密度（1-5）</label><div class="strength-wrap"><input id="rfStrength" type="range" min="1" max="5" value="3"/><span class="strength-val" id="rfStrengthVal">★★★☆☆</span></div></div>' +
      '<div class="form-row"><label><input id="rfDirected" type="checkbox" style="margin-right:6px"/>单向关系（A ➜ B，例如 A 单方面讨厌 B）</label></div>' +
      '<div class="form-row"><label>备注（怎么认识的、发生过什么…）</label><input id="rfNote" placeholder="如：2024 年秋天，画画认识的"/></div>';
    function val(id) { return body.querySelector('#' + id).value; }
    var strengthVal = function () { body.querySelector('#rfStrengthVal').textContent = stars(body.querySelector('#rfStrength').value); };
    body.querySelector('#rfStrength').addEventListener('input', strengthVal);
    strengthVal();
    if (rel) {
      body.querySelector('#rfSource').value = rel.source;
      body.querySelector('#rfTarget').value = rel.target;
      body.querySelector('#rfType').value = rel.type || '';
      body.querySelector('#rfStrength').value = Number(rel.strength) || 3;
      strengthVal();
      body.querySelector('#rfDirected').checked = !!rel.directed;
      body.querySelector('#rfNote').value = rel.note || '';
    } else {
      if (preSource) body.querySelector('#rfSource').value = preSource;
      if (preTarget) body.querySelector('#rfTarget').value = preTarget;
      if (preTarget) body.querySelector('#rfTarget').focus();
    }
    var saving = false;
    openModal(rel ? '✎ 编辑关系' : '🔗 新建关系', body, [
      { label: '取消', cls: 'ghost' },
      {
        label: rel ? '保存修改' : '建立关系', cls: 'primary',
        fn: function () {
          if (saving) return false;
          var source = val('rfSource'), target = val('rfTarget');
          if (!source || !target) { toast('请选择两个人物', true); return false; }
          if (source === target) { toast('两端不能是同一个人', true); return false; }
          var d = {
            source: source, target: target,
            type: val('rfType').trim() || '朋友',
            strength: Number(val('rfStrength')) || 3,
            directed: body.querySelector('#rfDirected').checked,
            note: val('rfNote').trim()
          };
          saving = true;
          var req = rel ? window.api.updateRelation(rel.id, d) : window.api.createRelation(d);
          req.then(function () {
            toast('关系已建立：' + (personById(d.source) ? personById(d.source).name : '') + ' — ' + (personById(d.target) ? personById(d.target).name : ''));
            refresh();
          }).catch(function (e) { saving = false; toast((e && e.message) || String(e), true); return false; });
        }
      }
    ]);
  }

  /* ---------------- 日记页 ---------------- */
  function renderDiaryList() {
    var listEl = $('diaryList');
    listEl.innerHTML = '';
    var sorted = state.diaries.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
    if (!sorted.length) {
      listEl.innerHTML = '<div class="empty">还没写过日记<br/>点击「写日记」记录第一篇</div>';
      return;
    }
    sorted.forEach(function (d) {
      var item = document.createElement('div');
      item.className = 'diary-item' + (d.id === editingDiaryId ? ' selected' : '');
      var mentions = (d.mentions || []).map(function (id) {
        var p = personById(id);
        return p ? '<span class="chip" data-pid="' + p.id + '">' + esc(p.name) + '</span>' : '';
      }).join('');
      item.innerHTML = '<div class="di-top"><span class="di-date">' + esc(d.date || '--') + '</span><span class="di-title">' + esc(d.title || '（无标题）') + '</span></div>' +
        '<div class="di-snippet">' + esc(d.content || '').slice(0, 80) + '</div>' +
        '<div class="di-foot"><div>' + mentions + '</div><button class="btn icon danger" data-dd="' + d.id + '" title="删除日记">✕</button></div>';
      item.addEventListener('click', function (e) {
        var del = e.target.closest('[data-dd]');
        if (del) {
          confirmModal('删除日记「' + esc(d.title || '无标题') + '」？', function () {
            window.api.deleteDiary(d.id).then(function () { toast('日记已删除'); if (editingDiaryId === d.id) closeDiaryEditor(); refresh(); })
              .catch(function (e2) { toast((e2 && e2.message) || String(e2), true); });
          });
          return;
        }
        var chip = e.target.closest('[data-pid]');
        if (chip) { showPersonOnGraph(chip.getAttribute('data-pid')); return; }
        openDiaryEditor(d);
      });
      item.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        confirmModal('删除日记「' + esc(d.title || '无标题') + '」？', function () {
          window.api.deleteDiary(d.id).then(function () { toast('日记已删除'); if (editingDiaryId === d.id) closeDiaryEditor(); refresh(); })
            .catch(function (e2) { toast((e2 && e2.message) || String(e2), true); });
        });
      });
      listEl.appendChild(item);
    });
  }

  function openDiaryEditor(d) {
    editingDiaryId = d ? d.id : null;
    chipOverride = {};
    var dateEl = $('dDate'), titleEl = $('dTitle'), contentEl = $('dContent');
    dateEl.value = d ? (d.date || '') : new Date().toISOString().slice(0, 10);
    titleEl.value = d ? (d.title || '') : '';
    contentEl.value = d ? (d.content || '') : '';
    if (d) {
      (d.mentions || []).forEach(function (id) { chipOverride[id] = true; });
    }
    $('diaryEditor').hidden = false;
    $('diaryEditorEmpty').hidden = true;
    updateMentionChips();
    renderDiaryList();
  }

  function closeDiaryEditor() {
    editingDiaryId = null;
    chipOverride = {};
    $('diaryEditor').hidden = true;
    $('diaryEditorEmpty').hidden = false;
    renderDiaryList();
  }

  function updateMentionChips() {
    var content = $('dContent').value || '';
    var matched = state.persons.filter(function (p) { return p.name && content.indexOf(p.name) !== -1; });
    var box = $('mentionChips');
    box.innerHTML = '';
    if (!matched.length) {
      box.innerHTML = '<span class="mention-hint">未检测到已知人物（保存时会自动记录）</span>';
      return;
    }
    matched.forEach(function (p) {
      var on = chipOverride[p.id] !== false;
      var chip = document.createElement('span');
      chip.className = 'chip ' + (on ? 'on' : 'off');
      chip.textContent = (on ? '✓ ' : '') + p.name;
      chip.title = '点击切换是否关联到这篇日记';
      chip.addEventListener('click', function () {
        chipOverride[p.id] = (chipOverride[p.id] === false) ? true : false;
        updateMentionChips();
      });
      box.appendChild(chip);
    });
  }

  function collectMentions() {
    var content = $('dContent').value || '';
    var ids = [];
    state.persons.forEach(function (p) {
      if (chipOverride[p.id] !== false && p.name && content.indexOf(p.name) !== -1) ids.push(p.id);
    });
    return ids;
  }

  function saveDiary() {
    var d = {
      date: $('dDate').value,
      title: $('dTitle').value.trim(),
      content: $('dContent').value,
      mentions: collectMentions()
    };
    if (!d.title && !d.content.trim()) { toast('日记内容为空', true); return; }
    var req = editingDiaryId ? window.api.updateDiary(editingDiaryId, d) : window.api.createDiary(d);
    req.then(function () {
      toast('日记已保存');
      closeDiaryEditor();
      refresh();
    }).catch(function (e) { toast((e && e.message) || String(e), true); });
  }

  /* ---------------- 设置 ---------------- */
  function openSettingsModal() {
    var ai = state.settings.ai || {};
    var body = document.createElement('div');
    var presetOpts = PRESETS.map(function (pr) {
      return '<option value="' + pr.name + '">' + pr.name + '</option>';
    }).join('');
    body.innerHTML = '<div class="form-row"><label>AI 服务商（兼容 OpenAI 协议）</label><select id="stPreset">' + presetOpts + '</select></div>' +
      '<div class="form-row"><label>接口地址 Base URL</label><input id="stBase" placeholder="https://api.deepseek.com"/></div>' +
      '<div class="form-row"><label>API Key</label><input id="stKey" type="password" placeholder="sk-..."/><div class="hint-line">Key 只保存在本机 data/data.json，不会上传到其他地方</div></div>' +
      '<div class="form-row"><label>模型</label><input id="stModel" placeholder="deepseek-chat"/></div>' +
      '<div class="hint-line">💡 建议在配置 AI 后点「测试连接」确认可用。没有 Key 时 AI 助手会提示先配置。</div>';
    var v = function (id) { return body.querySelector('#' + id); };
    v('stBase').value = ai.baseUrl || PRESETS[0].base;
    v('stKey').value = ai.apiKey || '';
    v('stModel').value = ai.model || PRESETS[0].model;
    v('stPreset').addEventListener('change', function () {
      var pr = null;
      PRESETS.forEach(function (x) { if (x.name === v('stPreset').value) pr = x; });
      if (pr) { v('stBase').value = pr.base; v('stModel').value = pr.model; }
    });
    openModal('⚙️ 设置 · AI 助手', body, [
      {
        label: '测试连接', fn: function () {
          var cfg = { ai: { baseUrl: v('stBase').value.trim(), apiKey: v('stKey').value.trim(), model: v('stModel').value.trim() } };
          window.api.saveSettings(cfg).then(function (saved) {
            state.settings = saved;
            return window.api.chat('请只回复：连接成功', []);
          }).then(function (r) {
            toast('✅ AI 连接成功：' + String(r.reply || '').slice(0, 40));
          }).catch(function (e) {
            toast('❌ ' + ((e && e.message) || String(e)).slice(0, 120), true);
          });
          return false;
        }
      },
      {
        label: '保存', cls: 'primary', fn: function () {
          var cfg = { ai: { baseUrl: v('stBase').value.trim() || PRESETS[0].base, apiKey: v('stKey').value.trim(), model: v('stModel').value.trim() || 'deepseek-chat' } };
          return window.api.saveSettings(cfg).then(function (saved) {
            state.settings = saved;
            toast('设置已保存');
          }).catch(function (e) { toast((e && e.message) || String(e), true); });
        }
      }
    ]);
  }

  /* ---------------- 导入导出 ---------------- */
  function exportData() {
    var a = document.createElement('a');
    a.href = '/api/export';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); } catch (e) { toast('导入失败：不是有效的 JSON 文件', true); return; }
      var np = (obj.persons || []).length, nr = (obj.relations || []).length, nd = (obj.diaries || []).length;
      confirmModal('导入将覆盖当前全部数据：<br/>当前：' + state.persons.length + ' 人物 / ' + state.relations.length + ' 关系 / ' + state.diaries.length + ' 日记<br/>将要：' + np + ' 人物 / ' + nr + ' 关系 / ' + nd + ' 日记<br/><span class="muted small">确定继续吗？</span>', function () {
        window.api.importData(obj).then(function (r) {
          toast('已导入：' + r.persons + ' 人物 / ' + r.relations + ' 关系 / ' + r.diaries + ' 日记');
          panelSel = null;
          if (graph) graph.clearSelection();
          refresh();
        }).catch(function (e) { toast((e && e.message) || String(e), true); });
      });
    };
    reader.readAsText(file);
  }

  /* ---------------- 统计 ---------------- */
  function renderStats() {
    if (window.Chat) window.Chat.updateStats(state.persons.length, state.relations.length, state.diaries.length);
  }

  /* ---------------- 初始化 ---------------- */
  function bind() {
    /* 标签页 */
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    /* 图谱工具 */
    $('btnAddPerson').addEventListener('click', function () { openPersonModal(null); });
    $('btnAddPerson2').addEventListener('click', function () { openPersonModal(null); });
    $('btnConnectMode').addEventListener('click', function () {
      if (!graph) return;
      graph.setConnectMode(!graph.connectMode);
      var on = graph.connectMode;
      $('btnConnectMode').classList.toggle('toggle-on', on);
      $('btnConnectMode').textContent = on ? '🔗 连接模式：开（依次点两个球）' : '🔗 连接模式';
      toast(on ? '连接模式已开启：先点球 A，再点球 B' : '连接模式已关闭', !on);
    });
    $('gpClose').addEventListener('click', function () {
      panelSel = null;
      $('graphPanel').hidden = true;
      if (graph) graph.clearSelection();
    });

    /* 人物页 */
    $('personSearch').addEventListener('input', renderPersons);

    /* 日记页 */
    $('btnAddDiary').addEventListener('click', function () { openDiaryEditor(null); });
    $('btnSaveDiary').addEventListener('click', saveDiary);
    $('btnCancelDiary').addEventListener('click', closeDiaryEditor);
    $('dContent').addEventListener('input', updateMentionChips);

    /* 导入导出 / 设置 */
    $('btnExport').addEventListener('click', exportData);
    $('btnImport').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });
    $('btnSettings').addEventListener('click', openSettingsModal);

    window.Chat.init();
  }

  bind();
  refresh();
})();