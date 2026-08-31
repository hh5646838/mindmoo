/* ============================================================
 * app.js —— 无限脑图 · 3 级下钻视区 主逻辑
 *   数据流：编辑器源码 →(300ms防抖)→ 全局JSON树 →(focusId截取3层)
 *          → Mermaid mindmap → CSS View Transitions → 画布 SVG
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- 全局状态 ---------------- */
  const state = {
    tree: null,          // 全局 JSON 树（完整）
    focusId: "0",        // 当前视区根节点 id
    shape: "default",
    theme: "aurora",
    dark: true,
    renderLabelMap: [],  // [{label, node}] 本次渲染 label->node 反查
    vtSourceEl: null,    // 视图过渡：旧视图里的源节点元素
    vtSourceGid: null,   // 视图过渡：源节点全局 id（新视图中的同一逻辑节点）
    pendingSearch: [],
    searchActive: -1
  };

  const LS_SOURCE = "wuxian.mindmap.source";
  const LS_PREFS = "wuxian.mindmap.prefs";
  let uid = 0;

  const SAMPLE_TEXT = [
    "无限脑图 O",
    "  想法 Idea",
    "    3级视区",
    "      截取三层",
    "      防抖解析",
    "      全局JSON树",
    "    无限延伸",
    "      神经突触",
    "      泛光节点",
    "      平滑过渡",
    "  神经突触 joint5",
    "    下一层 joint10",
    "      终端 $",
    "        深层神经",
    "          更深处",
    "            最深节点",
    "      第二分支",
    "        子分支A",
    "          叶子1",
    "        子分支B",
    "    联合分支",
    "      子联合1",
    "        更深",
    "      子联合2",
    "  外观设计",
    "    渐变主题",
    "      极光霓虹",
    "      深海幽蓝",
    "      烈焰橙红",
    "      赛博脉冲",
    "    节点形状",
    "      圆形",
    "      六边形",
    "      云朵",
    "      爆炸",
    "  配置",
    "    主页链接",
    "    头像关注",
    "    默认主题"
  ].join("\n");

  /* ---------------- 小工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function throttle(fn, ms) { let last = 0, t; return (...a) => { const now = Date.now(); const run = () => { last = Date.now(); fn(...a); }; if (now - last >= ms) run(); else { clearTimeout(t); t = setTimeout(run, ms - (now - last)); } }; }
  function toast(msg, warn) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (warn ? " warn" : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2200);
  }
  function savePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ theme: state.theme, shape: state.shape, dark: state.dark })); } catch (e) {}
  }

  /* ---------------- 自定义 CodeMirror 模式：缩进树 ---------------- */
  if (window.CodeMirror) {
    CodeMirror.defineMode("indenttree", function () {
      return {
        startState: function () { return { lineStart: true, first: true, depth: 0 }; },
        token: function (stream, state) {
          if (stream.sol()) { state.lineStart = true; state.first = true; }
          if (state.lineStart) {
            const m = stream.match(/^[ \t]*/);
            state.depth = Math.min(8, Math.round(((m && m[0]) ? m[0].length : 0) / 2));
            state.lineStart = false;
            if (stream.eol()) return null;
          }
          if (stream.match(/^(%%|#\s)/)) return "cm-comment cm-depth-" + state.depth;
          const base = "cm-depth-" + state.depth;
          if (state.first && stream.match(/^[^\s]+/)) { state.first = false; return "cm-title " + base; }
          if (stream.match(/^[^\s]+/)) return base;
          if (stream.match(/[\s]+/)) return null;
          stream.next();
          return null;
        }
      };
    });
  }

  /* ---------------- 编辑器 ---------------- */
  let editor = null;
  function initEditor() {
    editor = CodeMirror.fromTextArea($("#src-editor"), {
      mode: "indenttree",
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      styleActiveLine: true,
      extraKeys: { "Ctrl-/": toggleEditor, "Cmd-/": toggleEditor }
    });
    let source = "";
    try { source = localStorage.getItem(LS_SOURCE) || ""; } catch (e) {}
    editor.setValue(source || SAMPLE_TEXT);
    editor.on("change", debounce(() => {
      const text = editor.getValue();
      try { localStorage.setItem(LS_SOURCE, text); } catch (e) {}
      state.tree = TreeParser.parseMarkdownToTree(text);
      if (!TreeParser.findNode(state.tree, state.focusId)) state.focusId = "0";
      renderMindmap(state.focusId, false);
      updateEditorStat();
    }, 300));
    editor.on("change", () => updateEditorStat());
  }
  function updateEditorStat() {
    const el = $("#editor-stat");
    if (!el) return;
    const n = state.tree ? countNodes(state.tree) : 0;
    el.textContent = n + " 节点 · 缩进=层级";
  }
  function countNodes(n) { let c = 1; (n.children || []).forEach((x) => (c += countNodes(x))); return c; }

  function openEditor() { document.body.classList.add("editor-open"); }
  function closeEditor() { document.body.classList.remove("editor-open"); }
  function toggleEditor() { document.body.classList.toggle("editor-open"); }

  function reverseLocate(line, afterDrill) {
    const doIt = () => {
      openEditor();
      if (!editor) return;
      const pos = { line: Math.max(0, (line || 1) - 1), ch: 0 };
      editor.setCursor(pos);
      editor.scrollIntoView(pos, 160);
      const lh = editor.getLineHandle(pos.line);
      if (lh) {
        editor.addLineClass(lh, "background", "line-flash");
        setTimeout(() => editor.removeLineClass(lh, "background", "line-flash"), 1700);
      }
    };
    if (afterDrill) setTimeout(doIt, 430); else doIt();
  }

  /* ---------------- Mermaid 初始化 ---------------- */
  function initMermaid() {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      fontFamily: '"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif',
      theme: "base",
      themeVariables: {
        fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
        fontSize: "14px",
        /* 脑图外观与深浅色模式解耦：固定一套配色，深浅模式一致。
         * 节点填充实际由后处理的 mmgrad-* 渐变覆盖；此处仅影响连线/文字等基础色。 */
        primaryColor: "#1f2937",
        primaryTextColor: "#e5e7eb",
        primaryBorderColor: "#6b7280",
        lineColor: "#8b96ad",
        textColor: "#e5e7eb",
        mainBkg: "transparent",
        background: "transparent"
      },
      mindmap: { htmlLabels: false, padding: 12 },
      flowchart: { htmlLabels: false, curve: "basis" }
    });
  }

  /* ---------------- 渲染主控（带 View Transitions） ---------------- */
  async function renderMindmap(focusId, animate) {
    state.focusId = focusId;
    const srcGid = state.vtSourceGid;
    const srcEl = state.vtSourceEl;

    // 后渲染更新（面包屑/微缩地图/统计）。放在过渡回调内执行，避免在
    // 「t.finished 永不 resolve」的环境（如系统减少动态效果、headless 虚拟时间）下面包屑不更新。
    const afterRender = () => { updateBreadcrumbs(); updateMinimap(); updateEditorStat(); };

    if (document.startViewTransition && animate !== false && srcGid) {
      if (srcEl) { try { srcEl.style.viewTransitionName = "vt-target"; } catch (e) {} }
      const t = document.startViewTransition(async () => {
        await doRender();
        afterRender();
      });
      try { await t.finished; } catch (e) {}
      state.vtSourceEl = null;
      state.vtSourceGid = null;
      if (window.__vtTargetEl) { try { window.__vtTargetEl.style.viewTransitionName = ""; } catch (e) {} window.__vtTargetEl = null; }
    } else {
      state.vtSourceEl = null;
      state.vtSourceGid = null;
      await doRender();
      afterRender();
    }
  }

  async function doRender() {
    const container = $("#mermaid-container");
    const sub = TreeParser.extractSubtree(state.tree, state.focusId, window.APP_CONFIG.maxDepth || 3);
    const mmd = TreeParser.convertToMermaid(sub, state.shape, state.renderLabelMap, window.APP_CONFIG.shapes);
    let svg = "";
    try {
      const res = await window.mermaid.render("mmv-" + (++uid), mmd);
      svg = res.svg;
    } catch (e) {
      console.error("[mermaid] render error", e);
      container.innerHTML = '<div class="render-error">渲染失败：' + esc((e && e.message) || String(e)) + "</div>";
      return;
    }
    container.innerHTML = svg;
    postProcessSVG(sub);

    // 视图过渡：把新视图里与源节点同逻辑的节点标记为 vt-target
    if (state.vtSourceGid) {
      const targetEl = container.querySelector('[data-gid="' + state.vtSourceGid + '"]');
      if (targetEl) {
        try { targetEl.style.viewTransitionName = "vt-target"; } catch (e) {}
        window.__vtTargetEl = targetEl;
      }
    }
  }

  /* ---------------- SVG 后处理：渐变 / 发光 / 点击 ---------------- */
  function injectGradients(svg) {
    const NS = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS(NS, "defs"); svg.prepend(defs); }
    const theme = getTheme(state.theme);
    (theme && theme.colors ? theme.colors : []).slice(0, 3).forEach((pair, i) => {
      const id = "mmgrad-" + i;
      let g = defs.querySelector("#" + id);
      if (!g) {
        g = document.createElementNS(NS, "linearGradient");
        g.setAttribute("id", id);
        g.setAttribute("x1", "0"); g.setAttribute("y1", "0");
        g.setAttribute("x2", "0"); g.setAttribute("y2", "1");
        defs.appendChild(g);
      }
      g.innerHTML = "";
      const s1 = document.createElementNS(NS, "stop");
      s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", pair[0]);
      const s2 = document.createElementNS(NS, "stop");
      s2.setAttribute("offset", "100%"); s2.setAttribute("stop-color", pair[1]);
      g.appendChild(s1); g.appendChild(s2);
    });
  }

  function applyGradient(nodeEl, depthRel) {
    const fillEl = nodeEl.querySelector("rect, circle, path, ellipse");
    if (!fillEl) return;
    fillEl.setAttribute("fill", "url(#mmgrad-" + Math.min(depthRel, 2) + ")");
  }

  function postProcessSVG(sub) {
    const container = $("#mermaid-container");
    const svg = container.querySelector("svg");
    if (!svg) return;
    injectGradients(svg);

    /* 修复 Mermaid mindmap 连线：其生成的 section-edge 颜色为 hsl(...,0%)
     *（纯黑）深色下不可见，且 edge-depth-* 宽度规则未生效（实际只有 2px 太细）。
     * 这里强制注入固定蓝灰颜色 + 按层级的内联线宽（内联属性优先级最高）。 */
    const EDGE_COLOR = "#9aa7bd";
    svg.querySelectorAll(".mindmap-edges .edge").forEach((e) => {
      e.setAttribute("stroke", EDGE_COLOR);
      e.setAttribute("fill", "none");
      const dm = /edge-depth-(-?\d+)/.exec(e.getAttribute("class") || "");
      const d = dm ? parseInt(dm[1], 10) : 0;
      e.setAttribute("stroke-width", String(d <= 0 ? 4 : d === 1 ? 3 : 2.5));
    });

    const labelMap = new Map(state.renderLabelMap.map((x) => [x.label, x.node]));
    svg.querySelectorAll("g.mindmap-node").forEach((g) => {
      const txtEl = g.querySelector("text");
      const txt = txtEl ? (txtEl.textContent || "").trim() : "";
      const node = labelMap.get(txt);
      if (!node) return;
      g.dataset.gid = node.id;
      g.dataset.relDepth = node.depthRel;
      g.dataset.hasMore = node.hasMore ? "1" : "0";
      g.classList.add("mind-node");
      if (node.hasMore) g.classList.add("has-more-glowing");
      applyGradient(g, node.depthRel);
    });
  }

  /* ---------------- 画布点击（事件委托） ---------------- */
  function bindCanvasClicks() {
    $("#mermaid-container").addEventListener("click", (e) => {
      const g = e.target.closest("g.mindmap-node");
      if (!g) return;
      const gid = g.dataset.gid;
      const node = TreeParser.findNode(state.tree, gid);
      if (!node) return;

      const hasChildren = !!(node.children && node.children.length);
      const isRootOfView = gid === state.focusId;

      if (isRootOfView) {
        // 点击当前伪根 → 上钻一级
        const pid = TreeParser.getParentId(state.tree, gid);
        if (pid) {
          navigateTo(pid, g, gid);
          reverseLocate(TreeParser.findNode(state.tree, pid) ? TreeParser.findNode(state.tree, pid).line : node.line, true);
        } else {
          reverseLocate(node.line);
          toast("已是全局根节点");
        }
      } else if (hasChildren) {
        // 有子节点 → 下钻（该节点成为新的伪根）
        navigateTo(gid, g, gid);
        reverseLocate(node.line, true);
      } else {
        // 叶子节点 → 仅反向定位
        reverseLocate(node.line);
      }
    });
  }

  function navigateTo(gid, sourceEl, sourceGid) {
    if (gid === state.focusId) return;
    state.vtSourceEl = sourceEl || null;
    state.vtSourceGid = sourceGid != null ? sourceGid : (sourceEl ? state.focusId : null);
    renderMindmap(gid, true);
  }
  function currentRootEl() {
    return $("#mermaid-container g.mindmap-node[data-gid='" + state.focusId + "']");
  }
  function goToRoot() {
    if (state.focusId === "0") { reverseLocate(state.tree ? state.tree.line : 1); return; }
    navigateTo("0", currentRootEl(), state.focusId);
  }
  function goUp() {
    const pid = TreeParser.getParentId(state.tree, state.focusId);
    if (!pid) { toast("已是根节点"); return; }
    navigateTo(pid, currentRootEl(), state.focusId);
  }

  /* ---------------- 面包屑导航 ---------------- */
  function buildCrumbItems(path) {
    const n = path.length;
    if (n <= 6) return path.map((nd, i) => ({ id: nd.id, label: nd.label, current: i === n - 1 }));
    const picks = [0];
    const midStart = 1, midEnd = n - 3;
    const midLen = midEnd - midStart + 1;
    if (midLen > 0) {
      const k = Math.min(3, midLen);
      for (let j = 0; j < k; j++) {
        const idx = midStart + Math.round(((midLen - 1) * j) / Math.max(1, k - 1));
        if (!picks.includes(idx)) picks.push(idx);
      }
    }
    picks.push(n - 2, n - 1);
    const uniq = Array.from(new Set(picks)).sort((a, b) => a - b);
    const result = [];
    let prev = -2;
    uniq.forEach((idx) => {
      if (idx - prev > 1) result.push({ ellipsis: true });
      result.push({ id: path[idx].id, label: path[idx].label, current: idx === n - 1 });
      prev = idx;
    });
    return result;
  }

  function updateBreadcrumbs() {
    const path = TreeParser.getPathTo(state.tree, state.focusId);
    const items = buildCrumbItems(path);
    const box = $("#crumb-path");
    box.innerHTML = "";
    items.forEach((it, i) => {
      if (it.ellipsis) {
        const s = document.createElement("span");
        s.className = "crumb-ellipsis"; s.textContent = "…";
        box.appendChild(s);
      } else {
        const s = document.createElement("span");
        s.className = "crumb" + (it.current ? " current" : "");
        s.textContent = it.label;
        s.title = it.label;
        s.addEventListener("click", () => {
          if (it.id !== state.focusId) navigateTo(it.id, currentRootEl(), state.focusId);
        });
        box.appendChild(s);
      }
      if (i < items.length - 1) {
        const sep = document.createElement("span");
        sep.className = "crumb-sep"; sep.textContent = "→";
        box.appendChild(sep);
      }
    });
  }

  /* ---------------- 全局搜索 ---------------- */
  function initSearch() {
    const input = $("#search-input");
    const list = $("#search-results");
    let active = -1;
    let matches = [];

    function renderList() {
      list.innerHTML = "";
      if (!matches.length) {
        const d = document.createElement("div");
        d.className = "search-empty";
        d.textContent = "未找到该节点";
        list.appendChild(d);
        list.classList.add("show");
        return;
      }
      matches.forEach((m, i) => {
        const item = document.createElement("div");
        item.className = "search-result-item" + (i === active ? " active" : "");
        const path = TreeParser.getPathTo(state.tree, m.id).map((x) => x.label).join(" → ");
        item.innerHTML = "<span>" + esc(m.label) + "</span><span class='search-result-path'>" + esc(path) + "</span>";
        item.addEventListener("click", () => { jumpTo(m); });
        list.appendChild(item);
      });
      list.classList.add("show");
    }

    function jumpTo(m) {
      navigateTo(m.id, currentRootEl(), state.focusId);
      reverseLocate(m.line, true);
      list.classList.remove("show");
      input.blur();
    }

    input.addEventListener("input", debounce(() => {
      const q = input.value.trim();
      if (!q) { list.classList.remove("show"); return; }
      matches = TreeParser.searchNodes(state.tree, q, 12);
      active = -1;
      renderList();
    }, 120));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = input.value.trim();
        if (!q) return;
        if (matches.length) jumpTo(matches[0]);
        else {
          const m = TreeParser.searchNodes(state.tree, q, 1);
          if (m.length) jumpTo(m[0]);
          else { toast("未找到该节点：" + q, true); list.classList.remove("show"); }
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(matches.length - 1, active + 1);
        renderList();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        renderList();
      } else if (e.key === "Escape") {
        list.classList.remove("show");
        input.blur();
      }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) list.classList.remove("show"); });
  }

  /* ---------------- 全局微缩地图 ---------------- */
  function updateMinimap() {
    const cv = $("#minimap");
    if (!cv) return;
    const W = cv.clientWidth || 200, H = cv.clientHeight || 150;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const tree = state.tree;
    if (!tree) return;

    const maxDepth = window.APP_CONFIG.maxDepth || 3;
    const focus = TreeParser.findNode(tree, state.focusId) || tree;
    const viewIds = new Set();
    (function collect(n, d) { if (d >= maxDepth) return; viewIds.add(n.id); (n.children || []).forEach((c) => collect(c, d + 1)); })(focus, 0);
    const pathIds = new Set(TreeParser.getPathTo(tree, state.focusId).map((n) => n.id));

    const total = countNodes(tree);
    const pos = new Map();
    const edges = [];
    let idx = 0;
    (function dfs(n, parent) {
      const x = 6 + Math.min(n.depth, 10) * 15;
      const y = 6 + idx * ((H - 12) / Math.max(1, total - 1));
      pos.set(n.id, { x: x, y: y, d: n.depth });
      if (parent && pos.has(parent.id)) edges.push({ x1: pos.get(parent.id).x, y1: pos.get(parent.id).y, x2: x, y2: y });
      idx++;
      (n.children || []).forEach((c) => dfs(c, n));
    })(tree, null);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(140,145,175,.32)";
    edges.forEach((e) => { ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); });

    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    viewIds.forEach((id) => { const p = pos.get(id); if (!p) return; if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
    if (minX <= maxX && minY <= maxY) {
      const pad = 4;
      ctx.fillStyle = "rgba(0,229,255,.10)";
      ctx.strokeStyle = "rgba(0,229,255,.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
      ctx.fill(); ctx.stroke();
    }

    pos.forEach((p, id) => {
      const inView = viewIds.has(id), onPath = pathIds.has(id);
      ctx.beginPath();
      ctx.arc(p.x, p.y, inView ? 2.6 : 1.6, 0, Math.PI * 2);
      ctx.fillStyle = inView ? (onPath ? "#00e5ff" : "rgba(0,229,255,.7)") : "rgba(130,135,160,.42)";
      ctx.fill();
    });
    const fp = pos.get(state.focusId);
    if (fp) {
      ctx.beginPath(); ctx.arc(fp.x, fp.y, 4.6, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 1.4; ctx.stroke();
    }
  }

  /* ---------------- 主题 / 形状 ---------------- */
  function getTheme(id) { return (window.APP_CONFIG.themes || []).find((t) => t.id === id) || window.APP_CONFIG.themes[0]; }

  function buildThemeMenu() {
    const box = $("#dd-color-menu");
    box.innerHTML = "";
    (window.APP_CONFIG.themes || []).forEach((t) => {
      const item = document.createElement("div");
      item.className = "theme-item";
      const sw = document.createElement("span");
      sw.className = "theme-swatch";
      const cs = t.colors || [];
      sw.style.background = "linear-gradient(135deg," + cs.map((p) => p[0]).join(",") + ")";
      const name = document.createElement("span");
      name.textContent = t.name;
      const check = document.createElement("span");
      check.className = "theme-check";
      check.textContent = t.id === state.theme ? "✔" : "";
      item.appendChild(sw); item.appendChild(name); item.appendChild(check);
      item.addEventListener("click", () => setTheme(t.id));
      box.appendChild(item);
    });
  }
  function setTheme(id) {
    state.theme = id;
    savePrefs();
    buildThemeMenu();
    renderMindmap(state.focusId, false);
  }

  function buildShapeMenu() {
    const box = $("#dd-shape-menu");
    box.innerHTML = "";
    (window.APP_CONFIG.shapes || []).forEach((s) => {
      const item = document.createElement("button");
      item.className = "dd-item";
      const dot = document.createElement("span");
      dot.className = "shape-dot" + (s.id === "circle" ? " circle" : s.id === "hexagon" ? " hexagon" : s.id === "cloud" ? " cloud" : "");
      const name = document.createElement("span");
      name.textContent = s.name;
      const check = document.createElement("span");
      check.className = "theme-check";
      check.textContent = s.id === state.shape ? "✔" : "";
      item.appendChild(dot); item.appendChild(name); item.appendChild(check);
      item.addEventListener("click", () => setShape(s.id));
      box.appendChild(item);
    });
  }
  function setShape(id) {
    state.shape = id;
    savePrefs();
    buildShapeMenu();
    renderMindmap(state.focusId, false);
  }

  function setDark(dark) {
    state.dark = dark;
    document.body.classList.toggle("dark", dark);
    document.body.classList.toggle("light", !dark);
    $("#btn-mode").textContent = dark ? "🌙" : "☀️";
    if (editor) editor.setOption("theme", dark ? "material-darker" : "mdn-like");
    /* 脑图外观与深浅色模式解耦：切换仅改 UI 外壳，不重渲染脑图 */
    savePrefs();
  }

  /* ---------------- 下拉菜单开关 ---------------- */
  function initDropdowns() {
    $$(".dd-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const dd = btn.closest(".dd");
        const isOpen = dd.classList.contains("open");
        $$(".dd.open").forEach((x) => x.classList.remove("open"));
        if (!isOpen) dd.classList.add("open");
      });
    });
    document.addEventListener("click", () => $$(".dd.open").forEach((x) => x.classList.remove("open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".dd.open").forEach((x) => x.classList.remove("open")); });

    // 🎞️ 导入/导出
    $("#dd-file-menu").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "import") $("#file-input").click();
      else if (a === "export-md") exportMd();
      else if (a === "export-mmd") exportMmd();
      else if (a === "copy-mmd") copyMmd();
      $$(".dd.open").forEach((x) => x.classList.remove("open"));
    });
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }
  function exportMd() {
    const text = editor ? editor.getValue() : SAMPLE_TEXT;
    download("无限脑图.md", text, "text/markdown;charset=utf-8");
    toast("已导出 .md 源码");
  }
  function exportMmd() {
    const mmd = TreeParser.convertToMermaid(state.tree, state.shape, [], window.APP_CONFIG.shapes);
    download("无限脑图.mmd", mmd, "text/plain;charset=utf-8");
    toast("已导出 .mmd（Mermaid）");
  }
  function copyMmd() {
    const mmd = TreeParser.convertToMermaid(state.tree, state.shape, [], window.APP_CONFIG.shapes);
    const done = () => toast("Mermaid 文本已复制");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(mmd).then(done, () => fallbackCopy(mmd, done));
    } else fallbackCopy(mmd, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选择", true); }
    ta.remove();
  }
  function initImport() {
    $("#file-input").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let text = String(reader.result || "");
        if (/\.mmd$/i.test(f.name)) text = TreeParser.stripMermaidShapes(text);
        editor.setValue(text);
        state.tree = TreeParser.parseMarkdownToTree(text);
        state.focusId = "0";
        renderMindmap("0", false);
        toast("已导入：" + f.name);
      };
      reader.readAsText(f);
      e.target.value = "";
    });
  }

  /* ---------------- 顶部栏 ---------------- */
  function initTopbar() {
    $("#btn-brand").addEventListener("click", goToRoot);
    $("#btn-root").addEventListener("click", goToRoot);
    $("#btn-up").addEventListener("click", goUp);
    $("#btn-help").addEventListener("click", () => ($("#help-modal").hidden = !$("#help-modal").hidden));
    $("#btn-help-close").addEventListener("click", () => ($("#help-modal").hidden = true));
    $("#help-modal").addEventListener("click", (e) => { if (e.target === $("#help-modal")) $("#help-modal").hidden = true; });
    $("#btn-mode").addEventListener("click", () => setDark(!state.dark));
    $("#btn-collapse").addEventListener("click", closeEditor);
    $("#btn-open-editor").addEventListener("click", openEditor);
    $("#btn-export-md-foot").addEventListener("click", exportMd);

    // 配置：主页链接 / 头像关注
    const cfg = window.APP_CONFIG;
    $("#app-title").textContent = cfg.appTitle || "无限脑图";
    document.title = (cfg.appTitle || "无限脑图") + " · 3级下钻视区";
    const home = $("#link-home");
    home.textContent = cfg.homepageText || "工具主页";
    if (cfg.homepageUrl) home.href = cfg.homepageUrl;
    const avatar = $("#link-avatar");
    $("#follow-text").textContent = cfg.followText || "关注我";
    if (cfg.followUrl) avatar.href = cfg.followUrl;
    if (cfg.avatarUrl) {
      const img = $("#avatar-img");
      img.src = cfg.avatarUrl;
      img.hidden = false;
      $("#avatar-fallback").hidden = true;
    }
  }

  /* ---------------- 全局快捷键 ---------------- */
  function initHotkeys() {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.key === "／")) {
        e.preventDefault();
        toggleEditor();
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    await loadAppConfig();
    // 读取本地偏好
    try {
      const p = JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
      state.theme = p.theme || window.APP_CONFIG.defaultTheme || "aurora";
      state.shape = p.shape || window.APP_CONFIG.defaultShape || "default";
      state.dark = p.dark != null ? p.dark : (window.APP_CONFIG.defaultDark !== false);
    } catch (e) {}

    state.tree = TreeParser.parseMarkdownToTree(editor ? editor.getValue() : SAMPLE_TEXT);
    document.body.classList.toggle("dark", state.dark);
    document.body.classList.toggle("light", !state.dark);
    $("#btn-mode").textContent = state.dark ? "🌙" : "☀️";

    initMermaid();
    buildThemeMenu();
    buildShapeMenu();
    bindCanvasClicks();
    initSearch();
    initDropdowns();
    initImport();
    initTopbar();
    initHotkeys();
    initEditor();
    // 重新解析（编辑器初始化后）
    state.tree = TreeParser.parseMarkdownToTree(editor.getValue());
    await renderMindmap(state.focusId, false);
    updateEditorStat();
    if (window.__CONFIG_FILE_ERROR__) {
      setTimeout(() => toast("file:// 直开：config.json 未加载。自定义配色/链接请编辑 js/config.js，或用本地 HTTP 服务打开（config.json 生效）", true), 1200);
    }
    window.addEventListener("resize", throttle(updateMinimap, 200));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
