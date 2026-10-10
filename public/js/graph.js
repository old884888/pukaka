/* ============================================================
 * graph.js · 浮动球体关系图谱
 * 球体缓缓沉浮 · 可拖动 · 滚轮缩放 · Alt/连接模式下从球拖到球 = 建立关系
 * ============================================================ */
'use strict';

(function () {
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- 物理参数 ---------- */
  var SPRING_REST = 130;      // 连接线自然长度
  var SPRING_K = 0.0018;      // 弹簧系数
  var REPULSE_R = 250;        // 排斥作用半径
  var REPULSE_K = 620;        // 排斥强度
  var GRAVITY = 0.00045;      // 中心吸引力
  var DAMP = 0.90;            // 阻尼
  var VMAX = 4.2;             // 速度上限
  var BOB_X = 0.006;          // 横向沉浮扰动
  var BOB_Y = 0.010;          // 纵向沉浮扰动(浮力)

  /* ---------- 类 ---------- */
  function Graph(container, svg, callbacks) {
    this.container = container;
    this.svg = svg;
    this.cb = callbacks || {};
    this.nodes = [];
    this.links = [];
    this.nodeById = {};
    this.linkById = {};
    this._nodeEls = {};
    this._linkEls = {};

    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;
    this.time = 0;

    this.dragNode = null;
    this.panning = false;
    this.connecting = false;
    this.connectFrom = null;
    this.pendingConnectId = null;
    this.moved = 0;
    this.lastScreen = null;
    this.selectedNodeId = null;
    this.selectedLinkId = null;

    this.connectMode = false;

    svg.style.userSelect = 'none';
    svg.style.touchAction = 'none';
    this.build();
    this.resize();
    this.bindEvents();
    var self = this;
    this.raf = requestAnimationFrame(function loop() { self.step(); self.render(); self.raf = requestAnimationFrame(loop); });
    window.addEventListener('resize', function () { self.resize(); });
  }

  Graph.prototype.build = function () {
    var svg = this.svg;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    var defs = document.createElementNS(SVGNS, 'defs');
    var arrow = document.createElementNS(SVGNS, 'marker');
    arrow.setAttribute('id', 'arrowHead');
    arrow.setAttribute('viewBox', '0 0 10 10');
    arrow.setAttribute('refX', '8.5');
    arrow.setAttribute('refY', '5');
    arrow.setAttribute('markerWidth', '9');
    arrow.setAttribute('markerHeight', '9');
    arrow.setAttribute('markerUnits', 'userSpaceOnUse');
    arrow.setAttribute('orient', 'auto-start-reverse');
    var ap = document.createElementNS(SVGNS, 'path');
    ap.setAttribute('d', 'M0,0 L9,5 L0,10 z');
    ap.setAttribute('fill', '#8fb0ff');
    arrow.appendChild(ap);
    defs.appendChild(arrow);
    svg.appendChild(defs);

    this.rootG = document.createElementNS(SVGNS, 'g');
    this.linkG = document.createElementNS(SVGNS, 'g');
    this.nodeG = document.createElementNS(SVGNS, 'g');
    this.rootG.appendChild(this.linkG);
    this.rootG.appendChild(this.nodeG);
    svg.appendChild(this.rootG);

    this.tempLine = document.createElementNS(SVGNS, 'line');
    this.tempLine.setAttribute('class', 'temp-line');
    this.tempLine.setAttribute('visibility', 'hidden');
    this.rootG.appendChild(this.tempLine);
  };

  Graph.prototype.resize = function () {
    this.w = this.container.clientWidth || 900;
    this.h = this.container.clientHeight || 600;
    if (this.w === 0) this.w = 900;
    if (this.h === 0) this.h = 600;
    this.svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
  };

  /* ---------- 数据 ---------- */
  Graph.prototype.setData = function (persons, relations) {
    var old = this.nodeById;
    var nodes = persons.map(function (p) {
      var prev = old[p.id];
      return {
        id: p.id,
        name: p.name,
        color: p.color || '#5b8cff',
        r: 15,
        x: prev ? prev.x : (this.w * 0.25 + Math.random() * this.w * 0.5),
        y: prev ? prev.y : (this.h * 0.25 + Math.random() * this.h * 0.5),
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        ph: Math.random() * Math.PI * 2,
        ph2: Math.random() * Math.PI * 2,
        deg: 0
      };
    }, this);
    this.nodes = nodes;
    this.nodeById = {};
    nodes.forEach(function (n) { this.nodeById[n.id] = n; }, this);

    var links = relations.map(function (r) {
      return {
        id: r.id,
        s: r.source,
        t: r.target,
        type: r.type || '朋友',
        directed: !!r.directed,
        strength: r.strength === '' || r.strength == null ? 3 : Number(r.strength) || 3
      };
    });
    this.links = links;
    this.linkById = {};
    links.forEach(function (l) { this.linkById[l.id] = l; }, this);

    /* 度数与半径 */
    var nMap = this.nodeById;
    nodes.forEach(function (n) { n.deg = 0; });
    links.forEach(function (l) {
      if (nMap[l.s]) nMap[l.s].deg++;
      if (nMap[l.t]) nMap[l.t].deg++;
    });
    nodes.forEach(function (n) {
      n.r = 15 + Math.min(n.deg * 1.8, 13);
    });
    this.rebuildDom();
  };

  /* ---------- DOM ---------- */
  Graph.prototype.rebuildDom = function () {
    this.linkG.innerHTML = '';
    this.nodeG.innerHTML = '';
    this._linkEls = {};
    this._nodeEls = {};

    var self = this;
    this.links.forEach(function (l) {
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'link');
      g.setAttribute('data-link-id', l.id);

      var vis = document.createElementNS(SVGNS, 'line');
      vis.setAttribute('class', 'link-line');
      if (l.directed) vis.setAttribute('marker-end', 'url(#arrowHead)');
      vis.setAttribute('stroke-width', String(1.2 + l.strength * 0.34));
      var hit = document.createElementNS(SVGNS, 'line');
      hit.setAttribute('class', 'link-hit');
      var label = document.createElementNS(SVGNS, 'text');
      label.setAttribute('class', 'link-label');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = l.type + ' · ' + l.strength + '⭐';

      g.appendChild(vis);
      g.appendChild(hit);
      g.appendChild(label);
      self.linkG.appendChild(g);
      self._linkEls[l.id] = { vis: vis, hit: hit, label: label, g: g };

      g.addEventListener('pointerenter', function () { g.classList.add('hover'); });
      g.addEventListener('pointerleave', function () { g.classList.remove('hover'); });
    });

    this.nodes.forEach(function (n) {
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'node');
      g.setAttribute('data-node-id', n.id);
      g.style.setProperty('--c', n.color);

      var halo = document.createElementNS(SVGNS, 'circle');
      halo.setAttribute('class', 'halo');
      halo.setAttribute('r', String(n.r + 8));
      halo.setAttribute('fill', n.color);

      var ball = document.createElementNS(SVGNS, 'circle');
      ball.setAttribute('class', 'ball');
      ball.setAttribute('r', String(n.r));
      ball.setAttribute('fill', n.color);

      var shine = document.createElementNS(SVGNS, 'circle');
      shine.setAttribute('r', String(Math.max(2.5, n.r * 0.3)));
      shine.setAttribute('cx', String(-n.r * 0.32));
      shine.setAttribute('cy', String(-n.r * 0.38));
      shine.setAttribute('fill', 'rgba(255,255,255,0.4)');

      var name = document.createElementNS(SVGNS, 'text');
      name.setAttribute('class', 'node-name');
      name.setAttribute('y', String(n.r + 15));
      name.textContent = n.name;

      var title = document.createElementNS(SVGNS, 'title');
      title.textContent = n.name;

      g.appendChild(halo);
      g.appendChild(ball);
      g.appendChild(shine);
      g.appendChild(name);
      g.appendChild(title);
      self.nodeG.appendChild(g);
      self._nodeEls[n.id] = { g: g, halo: halo, ball: ball };
    });
    this.applySelectionClasses();
  };

  Graph.prototype.applySelectionClasses = function () {
    var self = this;
    Object.keys(this._nodeEls).forEach(function (id) {
      var el = self._nodeEls[id].g;
      el.classList.toggle('selected', id === self.selectedNodeId);
      el.classList.toggle('pending', id === self.pendingConnectId);
    });
    Object.keys(this._linkEls).forEach(function (id) {
      var el = self._linkEls[id].g;
      el.classList.toggle('selected', id === self.selectedLinkId);
    });
  };

  /* ---------- 物理模拟 ---------- */
  Graph.prototype.step = function () {
    var nodes = this.nodes;
    var links = this.links;
    if (!nodes.length) return;
    var self = this;
    this.time += 16.7;
    var t = this.time;
    var w = this.w, h = this.h;

    /* 缓慢漂移的中心（模拟“沉浮”的大环境） */
    var cx = w / 2 + Math.sin(t * 0.00032) * Math.min(w, h) * 0.16;
    var cy = h / 2 + Math.cos(t * 0.00024) * Math.min(w, h) * 0.12;

    var i, j, a, b, dx, dy, d2, d, f, ux, uy, rr;

    /* 两两排斥 + 碰撞 */
    for (i = 0; i < nodes.length; i++) {
      for (j = i + 1; j < nodes.length; j++) {
        a = nodes[i]; b = nodes[j];
        dx = a.x - b.x; dy = a.y - b.y;
        d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
        d = Math.sqrt(d2);
        ux = dx / d; uy = dy / d;

        rr = a.r + b.r + 7;
        if (d < rr) {
          var push = (rr - d) * 0.09;
          a.x += ux * push; a.y += uy * push;
          b.x -= ux * push; b.y -= uy * push;
        }
        if (d < REPULSE_R) {
          f = REPULSE_K / (d2 + 40);
          if (f > 1.4) f = 1.4;
          a.vx += ux * f; a.vy += uy * f;
          b.vx -= ux * f; b.vy -= uy * f;
        }
      }
    }

    /* 弹簧（关系连线） */
    for (i = 0; i < links.length; i++) {
      var L = links[i];
      a = self.nodeById[L.s]; b = self.nodeById[L.t];
      if (!a || !b) continue;
      dx = b.x - a.x; dy = b.y - a.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      ux = dx / d; uy = dy / d;
      f = (d - SPRING_REST) * SPRING_K;
      a.vx += ux * f; a.vy += uy * f;
      b.vx -= ux * f; b.vy -= uy * f;
    }

    /* 个体力：中心引力 + 沉浮 */
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === this.dragNode || this.isDraggingSide(n)) {
        n.vx *= 0.8; n.vy *= 0.8;
        continue;
      }
      var fx = 0, fy = 0;
      fx += (cx - n.x) * GRAVITY;
      fy += (cy - n.y) * GRAVITY;
      /* 沉浮：缓慢上下浮动的浮力 */
      var lift = Math.sin(t * 0.00055 + n.ph2) * BOB_Y;
      fy -= lift;                       // 屏幕 y 向下，负力=上浮
      fx += Math.sin(t * 0.0004 + n.ph) * BOB_X;

      n.vx += fx; n.vy += fy;
      var sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (sp > VMAX) { n.vx = n.vx / sp * VMAX; n.vy = n.vy / sp * VMAX; }
      n.vx *= DAMP; n.vy *= DAMP;

      /* 边界软反弹 */
      if (n.x < -80) n.vx += 0.12;
      if (n.x > this.w + 80) n.vx -= 0.12;
      if (n.y < 40) n.vy += 0.12;
      if (n.y > this.h + 60) n.vy -= 0.12;

      n.x += n.vx; n.y += n.vy;

      /* 渲染时细微的呼吸浮动 */
      n.breath = Math.sin(t * 0.0012 + n.ph) * 1.6;
    }
  };

  Graph.prototype.isDraggingSide = function (n) {
    return this.connecting && this.connectFrom === n.id;
  };

  /* ---------- 渲染 ---------- */
  Graph.prototype.render = function () {
    this.rootG.setAttribute('transform', 'translate(' + this.tx + ',' + this.ty + ') scale(' + this.zoom + ')');

    var linkEls = this._linkEls, nodeEls = this._nodeEls;
    for (var i = 0; i < this.links.length; i++) {
      var L = this.links[i];
      var a = this.nodeById[L.s], b = this.nodeById[L.t];
      var el = linkEls[L.id];
      if (!a || !b || !el) continue;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / d, uy = dy / d;
      var x1 = a.x + ux * (a.r + 2);
      var y1 = a.y + uy * (a.r + 2);
      var x2 = b.x - ux * (b.r + (L.directed ? 7 : 3));
      var y2 = b.y - uy * (b.r + (L.directed ? 7 : 3));
      el.vis.setAttribute('x1', x1); el.vis.setAttribute('y1', y1);
      el.vis.setAttribute('x2', x2); el.vis.setAttribute('y2', y2);
      el.hit.setAttribute('x1', x1); el.hit.setAttribute('y1', y1);
      el.hit.setAttribute('x2', x2); el.hit.setAttribute('y2', y2);
      /* 标签放在连线中点稍偏移 */
      el.label.setAttribute('x', (x1 + x2) / 2 - uy * 12);
      el.label.setAttribute('y', (y1 + y2) / 2 + ux * 12 + 3);
    }

    for (var k = 0; k < this.nodes.length; k++) {
      var n = this.nodes[k];
      var ne = nodeEls[n.id];
      if (!ne) continue;
      var by = (n.breath || 0);
      ne.g.setAttribute('transform', 'translate(' + (n.x).toFixed(1) + ',' + (n.y + by).toFixed(1) + ')');
    }

    /* 连接中的临时线 */
    if (this.connecting && this.connectFrom) {
      var from = this.nodeById[this.connectFrom];
      if (from) {
        this.tempLine.setAttribute('visibility', 'visible');
        this.tempLine.setAttribute('x1', from.x); this.tempLine.setAttribute('y1', from.y);
        var pw = this.clientToWorld(this.pointerX, this.pointerY);
        this.tempLine.setAttribute('x2', pw.x); this.tempLine.setAttribute('y2', pw.y);
      }
    } else {
      this.tempLine.setAttribute('visibility', 'hidden');
    }
  };

  Graph.prototype.clientToWorld = function (sx, sy) {
    var rect = this.svg.getBoundingClientRect();
    var x = sx - rect.left, y = sy - rect.top;
    return { x: (x - this.tx) / this.zoom, y: (y - this.ty) / this.zoom };
  };

  /* ---------- 事件 ---------- */
  Graph.prototype.bindEvents = function () {
    var self = this;
    var svg = this.svg;

    /* 缩放 */
    this.container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var factor = Math.pow(1.0016, -e.deltaY);
      var nz = Math.max(0.2, Math.min(3.5, self.zoom * factor));
      var k = nz / self.zoom;
      self.tx = mx - (mx - self.tx) * k;
      self.ty = my - (my - self.ty) * k;
      self.zoom = nz;
    }, { passive: false });

    svg.addEventListener('pointerdown', function (e) {
      self.pointerX = e.clientX; self.pointerY = e.clientY;
      var target = e.target;
      var nodeEl = target && target.closest ? target.closest('[data-node-id]') : null;
      var linkEl = target && target.closest ? target.closest('[data-link-id]') : null;

      if (nodeEl) {
        var id = nodeEl.getAttribute('data-node-id');
        self.moved = 0;
        self.lastScreen = { x: e.clientX, y: e.clientY };

        if (e.altKey) {
          /* Alt+拖拽连线：从球 A 拉到球 B（连接模式下也支持）
           * 连接模式下的普通点击则在 pointerup 中完成“点 A → 点 B” */
          self.connecting = true;
          self.connectFrom = id;
        } else {
          self.dragNode = self.nodeById[id];
        }
        return;
      }
      if (linkEl) {
        self.selectedLinkId = linkEl.getAttribute('data-link-id');
        self.applySelectionClasses();
        if (self.cb.onSelectRelation) self.cb.onSelectRelation(self.selectedLinkId);
        return;
      }
      /* 空白处：平移 */
      self.panning = true;
      self.moved = 0;
      self.lastScreen = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', function (e) {
      if (!self.panning && !self.dragNode && !self.connecting) return;
      self.pointerX = e.clientX; self.pointerY = e.clientY;
      var dx = e.clientX - self.lastScreen.x;
      var dy = e.clientY - self.lastScreen.y;
      self.moved += Math.abs(dx) + Math.abs(dy);
      self.lastScreen = { x: e.clientX, y: e.clientY };

      if (self.panning) { self.tx += dx; self.ty += dy; }
      else if (self.dragNode) {
        self.dragNode.x += dx / self.zoom;
        self.dragNode.y += dy / self.zoom;
        self.dragNode.vx = 0; self.dragNode.vy = 0;
      }
    });

    window.addEventListener('pointerup', function (e) {
      self.pointerX = e.clientX; self.pointerY = e.clientY;
      var moved = self.moved > 5;

      if (self.connecting) {
        var fromId = self.connectFrom;
        var targetEl = document.elementFromPoint(e.clientX, e.clientY);
        var tNode = targetEl && targetEl.closest ? targetEl.closest('[data-node-id]') : null;
        var toId = tNode ? tNode.getAttribute('data-node-id') : null;
        if (fromId && toId && toId !== fromId) {
          if (self.cb.onConnect) self.cb.onConnect(fromId, toId);
        }
        self.connecting = false;
        self.connectFrom = null;
      } else if (self.dragNode) {
        var id = self.dragNode.id;
        self.dragNode = null;
        if (!moved) {
          if (self.connectMode) {
            /* 连接模式下点击选择两端 */
            if (!self.pendingConnectId) self.pendingConnectId = id;
            else if (self.pendingConnectId !== id) {
              var cFrom = self.pendingConnectId;
              self.pendingConnectId = null;
              if (self.cb.onConnect) self.cb.onConnect(cFrom, id);
            } else self.pendingConnectId = null;
            self.applySelectionClasses();
          } else {
            self.selectedNodeId = (self.selectedNodeId === id) ? null : id;
            self.selectedLinkId = null;
            self.applySelectionClasses();
            if (self.cb.onSelectNode) self.cb.onSelectNode(self.selectedNodeId);
            if (self.cb.onSelectRelation) self.cb.onSelectRelation(null);
          }
        }
      } else if (self.panning) {
        self.panning = false;
        if (!moved) {
          self.selectedNodeId = null;
          self.selectedLinkId = null;
          self.applySelectionClasses();
          if (self.cb.onSelectNode) self.cb.onSelectNode(null);
          if (self.cb.onSelectRelation) self.cb.onSelectRelation(null);
        }
      }
    });
  };

  Graph.prototype.setConnectMode = function (on) {
    this.connectMode = !!on;
    this.pendingConnectId = null;
    this.applySelectionClasses();
  };

  Graph.prototype.flashNode = function (id) {
    this.selectedNodeId = id;
    this.selectedLinkId = null;
    this.applySelectionClasses();
  };

  Graph.prototype.clearSelection = function () {
    this.selectedNodeId = null;
    this.selectedLinkId = null;
    this.applySelectionClasses();
  };

  window.GraphView = Graph;
})();