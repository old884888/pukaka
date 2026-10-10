#!/usr/bin/env node
/* ============================================================
 * 人物图谱 · 本地服务器（零依赖，需要 Node.js >= 18）
 * 启动：node server.js   或双击 start.bat
 * 打开：http://localhost:3210
 *
 * 所有数据（人物/关系/日记/AI设置）以 JSON 存于 data/data.json
 * ============================================================ */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var PORT = Number(process.env.PORT || 3210);
var ROOT = __dirname;
var PUBLIC_DIR = path.join(ROOT, 'public');
var DATA_DIR = path.join(ROOT, 'data');
var DATA_FILE = path.join(DATA_DIR, 'data.json');

/* ---------------- 默认配置 ---------------- */
function defaultSettings() {
  return {
    ai: { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat' }
  };
}

/* ---------------- 数据加载与保存 ---------------- */
function loadData() {
  var empty = { version: 1, persons: [], relations: [], diaries: [], settings: defaultSettings() };
  try {
    var d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    d.persons = Array.isArray(d.persons) ? d.persons : [];
    d.relations = Array.isArray(d.relations) ? d.relations : [];
    d.diaries = Array.isArray(d.diaries) ? d.diaries : [];
    d.settings = (d.settings && d.settings.ai) ? d.settings : defaultSettings();
    if (!d.settings.ai.baseUrl) d.settings.ai.baseUrl = defaultSettings().ai.baseUrl;
    if (!d.settings.ai.model) d.settings.ai.model = defaultSettings().ai.model;
    d.settings.ai.apiKey = String(d.settings.ai.apiKey || '');
    return d;
  } catch (e) {
    return empty;
  }
}

var state = loadData();
var saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 120);
}
function saveNow() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------------- 小工具 ---------------- */
function uid(prefix) { return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function nowIso() { return new Date().toISOString(); }
function str(v, fallback) { return (v === undefined || v === null) ? (fallback || '') : String(v); }
function num(v) { if (v === '' || v === null || v === undefined) return ''; var n = Number(v); return isFinite(n) && n !== 0 ? n : (n === 0 ? 0 : ''); }

var COLORS = ['#5b8cff', '#ff6b9d', '#4dd0a1', '#ffa94d', '#b197fc', '#63e6be', '#ff8787', '#74c0fc', '#ffd43b', '#e599f7', '#8ce99a', '#ffc078'];
function defaultColor(index) { return COLORS[index % COLORS.length]; }

function personById(id) {
  for (var i = 0; i < state.persons.length; i++) if (state.persons[i].id === id) return state.persons[i];
  return null;
}
function nameOf(id) {
  var p = personById(id);
  return p ? p.name : ('#' + id);
}
function json(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/* 自动识别日记中出现的已知人物姓名 */
function detectMentions(content) {
  var found = [];
  if (!content) return found;
  state.persons.forEach(function (p) {
    if (p.name && content.indexOf(p.name) !== -1) found.push(p.id);
  });
  return found;
}

/* ---------------- 构建 AI 上下文 JSON ---------------- */
function buildContext() {
  var persons = state.persons.map(function (p) {
    return {
      id: p.id,
      姓名: str(p.name),
      性别: str(p.gender),
      与我的关系: str(p.relationLabel),
      年龄: p.age === '' || p.age == null ? '' : Number(p.age),
      身高cm: p.height === '' || p.height == null ? '' : Number(p.height),
      职业: str(p.occupation),
      标签: Array.isArray(p.tags) ? p.tags : [],
      简介: str(p.notes)
    };
  });
  var relations = state.relations.map(function (r) {
    var fromName = nameOf(r.source);
    var toName = nameOf(r.target);
    return {
      从: fromName,
      到: toName,
      关系类型: str(r.type),
      强度: r.strength === '' || r.strength == null ? '' : Number(r.strength),
      方向: r.directed ? (fromName + ' -> ' + toName) : ('双向: ' + fromName + ' <-> ' + toName),
      备注: str(r.note)
    };
  });
  var sorted = state.diaries.slice().sort(function (a, b) {
    return (a.date || '') < (b.date || '') ? 1 : -1;
  });
  var diaries = sorted.slice(0, 200).map(function (d) {
    return { 日期: str(d.date), 标题: str(d.title), 摘要: str(d.content).slice(0, 800) };
  });
  var obj = {
    说明: '以下是用户的人物图谱完整数据，人物与日记中的姓名一一对应，关系中的“从/到”与姓名对应',
    人物数量: state.persons.length,
    关系数量: state.relations.length,
    日记数量: state.diaries.length,
    人物: persons,
    关系: relations,
    日记: diaries
  };
  return JSON.stringify(obj);
}

function systemPrompt(ctx) {
  return '你是「人物图谱」应用的智能助手。用户通过写日记记录了生活中出现的人物，并维护了人物档案与人物关系。\n\n'
    + '回答规则：\n'
    + '1. 优先依据下方提供的完整 JSON 数据回答，可引用其中的人物姓名、关系类型、日记内容；\n'
    + '2. 数据中没有的信息，请明确说“图谱里没有记录”，不要编造人物或关系；\n'
    + '3. 可以跨多条记录归纳总结，例如梳理某人的经历、分析人物关系网、评价亲疏远近；\n'
    + '4. 回答使用简体中文，条理清晰，适当分点。\n\n'
    + '当前完整数据（JSON）：\n' + ctx;
}

/* ---------------- 轻量路由 ---------------- */
var routes = [];
function route(method, pattern, handler) { routes.push({ method: method, pattern: pattern, handler: handler }); }
function matchPath(pattern, pathname) {
  var pp = pattern.split('/').filter(Boolean);
  var sp = pathname.split('/').filter(Boolean);
  if (pp.length !== sp.length) return null;
  var params = {};
  for (var i = 0; i < pp.length; i++) {
    if (pp[i].charAt(0) === ':') params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

/* ---------------- API：人物 ---------------- */
route('GET', '/api/state', function (req, res) { json(res, 200, state); });

route('POST', '/api/persons', function (req, res, p, body) {
  var name = str(body.name).trim();
  if (!name) return json(res, 400, { error: '请填写人物姓名' });
  var person = {
    id: uid('p'),
    name: name,
    gender: str(body.gender),
    relationLabel: str(body.relationLabel),
    age: num(body.age),
    height: num(body.height),
    occupation: str(body.occupation),
    tags: Array.isArray(body.tags) ? body.tags.map(function (t) { return str(t); }).filter(Boolean) : [],
    color: str(body.color) || defaultColor(state.persons.length),
    notes: str(body.notes),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.persons.push(person);
  scheduleSave();
  json(res, 200, person);
});

route('PUT', '/api/persons/:id', function (req, res, params, body) {
  var p = personById(params.id);
  if (!p) return json(res, 404, { error: '人物不存在' });
  var name = str(body.name).trim();
  if (!name) return json(res, 400, { error: '请填写人物姓名' });
  p.name = name;
  p.gender = str(body.gender);
  p.relationLabel = str(body.relationLabel);
  p.age = num(body.age);
  p.height = num(body.height);
  p.occupation = str(body.occupation);
  p.tags = Array.isArray(body.tags) ? body.tags.map(function (t) { return str(t); }).filter(Boolean) : [];
  if (str(body.color)) p.color = str(body.color);
  p.notes = str(body.notes);
  p.updatedAt = nowIso();
  scheduleSave();
  json(res, 200, p);
});

route('DELETE', '/api/persons/:id', function (req, res, params) {
  var before = state.persons.length;
  state.persons = state.persons.filter(function (p) { return p.id !== params.id; });
  if (state.persons.length === before) return json(res, 404, { error: '人物不存在' });
  state.relations = state.relations.filter(function (r) { return r.source !== params.id && r.target !== params.id; });
  state.diaries.forEach(function (d) {
    if (Array.isArray(d.mentions)) d.mentions = d.mentions.filter(function (m) { return m !== params.id; });
  });
  scheduleSave();
  json(res, 200, { ok: true });
});

/* ---------------- API：关系 ---------------- */
route('POST', '/api/relations', function (req, res, p, body) {
  var source = str(body.source);
  var target = str(body.target);
  if (!source || !target) return json(res, 400, { error: '请选择关系两端的人物' });
  if (source === target) return json(res, 400, { error: '不能和自己是同一个人建立关系' });
  if (!personById(source)) return json(res, 400, { error: '起始人物不存在' });
  if (!personById(target)) return json(res, 400, { error: '目标人物不存在' });
  var rel = {
    id: uid('r'),
    source: source,
    target: target,
    type: str(body.type) || '朋友',
    strength: num(body.strength) === '' ? 3 : Math.max(1, Math.min(5, num(body.strength))),
    directed: body.directed ? true : false,
    note: str(body.note),
    createdAt: nowIso()
  };
  state.relations.push(rel);
  scheduleSave();
  json(res, 200, rel);
});

route('PUT', '/api/relations/:id', function (req, res, params, body) {
  var r = null;
  for (var i = 0; i < state.relations.length; i++) if (state.relations[i].id === params.id) { r = state.relations[i]; break; }
  if (!r) return json(res, 404, { error: '关系不存在' });
  var source = str(body.source) || r.source;
  var target = str(body.target) || r.target;
  if (source !== r.source && !personById(source)) return json(res, 400, { error: '起始人物不存在' });
  if (target !== r.target && !personById(target)) return json(res, 400, { error: '目标人物不存在' });
  if (source === target) return json(res, 400, { error: '两端不能是同一人' });
  r.source = source;
  r.target = target;
  r.type = str(body.type) || r.type || '朋友';
  if (body.strength !== undefined && body.strength !== null && body.strength !== '') {
    r.strength = Math.max(1, Math.min(5, num(body.strength)));
  }
  r.directed = body.directed ? true : false;
  r.note = str(body.note);
  scheduleSave();
  json(res, 200, r);
});

route('DELETE', '/api/relations/:id', function (req, res, params) {
  var before = state.relations.length;
  state.relations = state.relations.filter(function (r) { return r.id !== params.id; });
  if (state.relations.length === before) return json(res, 404, { error: '关系不存在' });
  scheduleSave();
  json(res, 200, { ok: true });
});

/* ---------------- API：日记 ---------------- */
route('POST', '/api/diaries', function (req, res, p, body) {
  var content = str(body.content);
  if (!str(body.title).trim() && !content.trim()) return json(res, 400, { error: '日记内容为空' });
  var mentions = Array.isArray(body.mentions) ? body.mentions : [];
  detectMentions(content).forEach(function (id) { if (mentions.indexOf(id) === -1) mentions.push(id); });
  var diary = {
    id: uid('d'),
    date: str(body.date) || new Date().toISOString().slice(0, 10),
    title: str(body.title),
    content: content,
    mentions: mentions,
    createdAt: nowIso()
  };
  state.diaries.push(diary);
  scheduleSave();
  json(res, 200, diary);
});

route('PUT', '/api/diaries/:id', function (req, res, params, body) {
  var d = null;
  for (var i = 0; i < state.diaries.length; i++) if (state.diaries[i].id === params.id) { d = state.diaries[i]; break; }
  if (!d) return json(res, 404, { error: '日记不存在' });
  var content = str(body.content);
  if (!str(body.title).trim() && !content.trim()) return json(res, 400, { error: '日记内容为空' });
  d.date = str(body.date) || d.date;
  d.title = str(body.title);
  d.content = content;
  var mentions = Array.isArray(body.mentions) ? body.mentions : [];
  detectMentions(content).forEach(function (id) { if (mentions.indexOf(id) === -1) mentions.push(id); });
  d.mentions = mentions;
  scheduleSave();
  json(res, 200, d);
});

route('DELETE', '/api/diaries/:id', function (req, res, params) {
  var before = state.diaries.length;
  state.diaries = state.diaries.filter(function (d) { return d.id !== params.id; });
  if (state.diaries.length === before) return json(res, 404, { error: '日记不存在' });
  scheduleSave();
  json(res, 200, { ok: true });
});

/* ---------------- API：设置 / 导入导出 ---------------- */
route('PUT', '/api/settings', function (req, res, p, body) {
  var ai = body.ai || {};
  state.settings.ai = {
    baseUrl: str(ai.baseUrl) || defaultSettings().ai.baseUrl,
    apiKey: str(ai.apiKey),
    model: str(ai.model) || defaultSettings().ai.model
  };
  scheduleSave();
  json(res, 200, state.settings);
});

route('GET', '/api/export', function (req, res) {
  var data = JSON.stringify(state, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="renwutupu-data.json"; filename*=UTF-8\'\'' + encodeURIComponent('人物图谱数据.json'),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(data);
});

route('POST', '/api/import', function (req, res, p, body) {
  function cleanPersons(arr) {
    var seen = {};
    return (Array.isArray(arr) ? arr : []).map(function (x) {
      var name = str(x && x.name).trim();
      if (!name) return null;
      var id = str(x.id) || uid('p');
      if (seen[id]) id = uid('p');
      seen[id] = true;
      return {
        id: id, name: name,
        gender: str(x.gender),
        relationLabel: str(x.relationLabel),
        age: num(x.age),
        height: num(x.height),
        occupation: str(x.occupation),
        tags: Array.isArray(x.tags) ? x.tags.map(String) : [],
        color: str(x.color) || defaultColor(0),
        notes: str(x.notes),
        createdAt: str(x.createdAt) || nowIso(),
        updatedAt: str(x.updatedAt) || nowIso()
      };
    }).filter(Boolean);
  }
  function cleanRelations(arr, persons) {
    var ids = persons.map(function (p) { return p.id; });
    return (Array.isArray(arr) ? arr : []).map(function (x, i) {
      var s = str(x && x.source), t = str(x && x.target);
      if (!s || !t || s === t || ids.indexOf(s) === -1 || ids.indexOf(t) === -1) return null;
      var st = num(x.strength);
      return {
        id: str(x.id) || uid('r'),
        source: s, target: t,
        type: str(x.type) || '朋友',
        strength: st === '' ? 3 : Math.max(1, Math.min(5, st)),
        directed: x.directed ? true : false,
        note: str(x.note),
        createdAt: str(x.createdAt) || nowIso()
      };
    }).filter(Boolean);
  }
  function cleanDiaries(arr, persons) {
    var ids = persons.map(function (p) { return p.id; });
    return (Array.isArray(arr) ? arr : []).map(function (x) {
      var content = str(x && x.content);
      if (!content.trim()) return null;
      var mentions = Array.isArray(x.mentions) ? x.mentions.filter(function (m) { return ids.indexOf(m) !== -1; }) : [];
      return {
        id: str(x.id) || uid('d'),
        date: str(x.date) || new Date().toISOString().slice(0, 10),
        title: str(x.title),
        content: content,
        mentions: mentions,
        createdAt: str(x.createdAt) || nowIso()
      };
    }).filter(Boolean);
  }
  if (!body || (!Array.isArray(body.persons) && !Array.isArray(body.relations) && !Array.isArray(body.diaries))) return json(res, 400, { error: '导入失败：需要包含 persons / relations / diaries 数组的 JSON 文件' });
  var persons = cleanPersons(body.persons);
  var relations = cleanRelations(body.relations, persons);
  var diaries = cleanDiaries(body.diaries, persons);
  state.persons = persons;
  state.relations = relations;
  state.diaries = diaries;
  if (body.settings && body.settings.ai) {
    state.settings = { ai: {
      baseUrl: str(body.settings.ai.baseUrl) || defaultSettings().ai.baseUrl,
      apiKey: str(body.settings.ai.apiKey),
      model: str(body.settings.ai.model) || defaultSettings().ai.model
    } };
  }
  saveNow();
  json(res, 200, { ok: true, persons: persons.length, relations: relations.length, diaries: diaries.length });
});

/* ---------------- API：AI 问答 ---------------- */
route('GET', '/api/context', function (req, res) {
  var ctx = buildContext();
  json(res, 200, { context: ctx, prompt: systemPrompt(ctx) });
});

function endpointOf(base) {
  var b = String(base || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(b)) return b;
  if (/\/(v\d+)$/i.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

route('POST', '/api/chat', async function (req, res, p, body) {
  var cfg = state.settings.ai || {};
  if (!cfg.apiKey) return json(res, 400, { error: '还没有配置 AI 接口。点击右上角「设置」，填入 API Key（例如 DeepSeek 的 key）即可使用。' });
  var question = str(body.question);
  if (!question.trim()) return json(res, 400, { error: '问题不能为空' });
  var history = Array.isArray(body.history) ? body.history : [];
  var messages = [
    { role: 'system', content: systemPrompt(buildContext()) }
  ];
  history.slice(-20).forEach(function (m) {
    var role = (m && m.role === 'assistant') ? 'assistant' : 'user';
    var content = String((m && m.content) || '').slice(0, 4000);
    if (content) messages.push({ role: role, content: content });
  });
  messages.push({ role: 'user', content: question.slice(0, 6000) });

  var url = endpointOf(cfg.baseUrl);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 180000);
  try {
    var resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: messages,
        temperature: 0.4,
        max_tokens: 4096
      }),
      signal: controller.signal
    });
    var text = await resp.text();
    if (!resp.ok) {
      return json(res, 502, { error: 'AI 接口返回 ' + resp.status + '：' + text.slice(0, 400) });
    }
    var data = JSON.parse(text);
    var reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '(AI 未返回内容)')
      : '(无法解析 AI 返回)';
    json(res, 200, { reply: reply });
  } catch (e) {
    if (e && e.name === 'AbortError') return json(res, 504, { error: 'AI 请求超时（180 秒），请重试。' });
    return json(res, 502, { error: 'AI 请求失败：' + String(e && e.message || e) + '。请检查设置中的接口地址与网络。' });
  } finally {
    clearTimeout(timer);
  }
});

/* ---------------- 静态资源 ---------------- */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  var file = pathname === '/' ? '/index.html' : pathname;
  var full = path.normalize(path.join(PUBLIC_DIR, file));
  if (full.indexOf(PUBLIC_DIR) !== 0) return json(res, 403, { error: 'forbidden' });
  fs.readFile(full, function (err, buf) {
    if (err) return json(res, 404, { error: 'not found' });
    var ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------------- 服务器 ---------------- */
var server = http.createServer(async function (req, res) {
  var u = new URL(req.url, 'http://localhost');
  var pathname = decodeURIComponent(u.pathname);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      return res.end();
    }
    if (pathname.indexOf('/api/') === 0) {
      var body = {};
      var ct = req.headers['content-type'] || '';
      if ((req.method === 'POST' || req.method === 'PUT') && ct.indexOf('json') !== -1) {
        var raw = await readBody(req);
        if (raw.trim()) body = JSON.parse(raw);
      }
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        if (r.method !== req.method) continue;
        var params = matchPath(r.pattern, pathname);
        if (params) return await r.handler(req, res, params, body);
      }
      return json(res, 404, { error: '接口不存在' });
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。');
    console.error('请关闭占用程序，或换一个端口启动：PORT=3211 node server.js');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, function () {
  console.log('==========================================');
  console.log('  人物图谱已启动');
  console.log('  请用浏览器打开:  http://localhost:' + PORT);
  console.log('  数据文件:        ' + DATA_FILE);
  console.log('  停止服务:        按 Ctrl+C');
  console.log('==========================================');
});