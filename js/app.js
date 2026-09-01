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
    "          轴突",
    "            轴突末梢",
    "            突触前膜",
    "          树突",
    "            树突棘",
    "            接收端",
    "          更深处",
    "            最深节点",
    "              神经元 A",
    "              神经元 B",
    "              神经元 C",
    "            更深深",
    "              节点 X",
    "              节点 Y",
    "            最最深",
    "        髓鞘",
    "          郎飞结",
    "          绝缘层",
    "      第二分支",
    "        子分支A",
    "          叶子1",
    "          叶子2",
    "          叶子3",
    "        子分支B",
    "          叶子4",
    "          叶子5",
    "          叶子6",
    "    联合分支",
    "      子联合1",
    "        更深",
    "          更深深",
    "            最深深",
    "      子联合2",
    "        联合节点 A",
    "        联合节点 B",
    "    信号传递",
    "      电信号",
    "        动作电位",
    "        静息电位",
    "        传导速度",
    "      化学递质",
    "        乙酰胆碱",
    "        多巴胺",
    "        血清素",
    "        谷氨酸",
    "  外观设计",
    "    渐变主题",
    "      极光霓虹",
    "        深色适配",
    "        浅色适配",
    "        高对比模式",
    "      深海幽蓝",
    "        深色适配",
    "        浅色适配",
    "        高对比模式",
    "      烈焰橙红",
    "        深色适配",
    "        浅色适配",
    "        高对比模式",
    "      赛博脉冲",
    "        深色适配",
    "        浅色适配",
    "        高对比模式",
    "    节点形状",
    "      圆形",
    "        描边样式",
    "        填充样式",
    "        阴影样式",
    "      六边形",
    "        描边样式",
    "        填充样式",
    "        阴影样式",
    "      云朵",
    "        描边样式",
    "        填充样式",
    "        阴影样式",
    "      爆炸",
    "        描边样式",
    "        填充样式",
    "        阴影样式",
    "    深色模式",
    "      自动切换",
    "        跟随系统",
    "        定时切换",
    "      手动切换",
    "        浅色",
    "        深色",
    "  配置",
    "    主页链接",
    "      URL",
    "      标题",
    "      打开方式",
    "    头像关注",
    "      头像URL",
    "      昵称",
    "      简介",
    "    默认主题",
    "      记忆上次",
    "      跟随系统",
    "      固定主题"
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
  /* 偏好持久化：theme / shape 只有被用户主动点选过（pinned）才覆盖 config 默认值，
   * 这样之后改 config.js / config.json 里的 defaultTheme、defaultShape
   * 能立即对「没手动选过」的浏览器生效，而不被历史偏好悄悄盖掉。 */
  function savePrefs(patch) {
    try {
      const cur = JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
      Object.assign(cur, { theme: state.theme, shape: state.shape, dark: state.dark }, patch || {});
      localStorage.setItem(LS_PREFS, JSON.stringify(cur));
    } catch (e) {}
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

  /* View Transition 下钻过渡。需求侧需要「点击节点放大成新根」的连贯动画，
   * 默认开启；少数环境（如系统开了「减少动态效果」、headless 截图工具）下
   * `document.startViewTransition` 可能不起作用或产生卡顿，那时把 USE_VT
   * 改 false 即可退化为无动画的直接重绘。 */
  const USE_VT = true;

  /* ---------------- 渲染主控（带 View Transitions） ---------------- */
  async function renderMindmap(focusId, animate) {
    state.focusId = focusId;
    const srcGid = state.vtSourceGid;
    const srcEl = state.vtSourceEl;

    // 后渲染更新（面包屑/微缩地图/统计）。放在过渡回调内执行，避免在
    // 「t.finished 永不 resolve」的环境（如系统减少动态效果、headless 虚拟时间）下面包屑不更新。
    const afterRender = () => { updateBreadcrumbs(); updateMinimap(); updateEditorStat(); };

    if (USE_VT && document.startViewTransition && animate !== false && srcGid) {
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

  /* ---------------- SVG 后处理：渐变 / 发光 / 点击 ----------------
   * 两种上色模式（由主题的 byBranch 决定）：
   *   · byBranch=false（默认）：colors 的 3 组渐变按「相对层级」上色，
   *     同一层所有节点同色，块内由 pair[0]→pair[1] 做纵向渐变。
   *   · byBranch=true        ：colors 的每一组是「一个分支」的纯色（pair 两端相同），
   *     整条分支共用一个灰度/色阶，块内没有渐变。Mermaid 会给每个节点打上
   *     section-N 类（根为 section--1），直接拿它当分支号即可。
   *     分支数多于配色数时循环取用。 */
  const BRANCH_MAX = 8;

  function injectGradients(svg) {
    const NS = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS(NS, "defs"); svg.prepend(defs); }
    const theme = getTheme(state.theme);
    const cols = (theme && theme.colors) || [];

    const put = (id, c1, c2) => {
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
      s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", c1);
      const s2 = document.createElementNS(NS, "stop");
      s2.setAttribute("offset", "100%"); s2.setAttribute("stop-color", c2);
      g.appendChild(s1); g.appendChild(s2);
    };

    if (theme && theme.byBranch) {
      cols.slice(0, BRANCH_MAX).forEach((pair, bi) => {
        /* 纯色：两端取同一个值，渐变退化成平涂 */
        put("mmgrad-b" + bi, pair[0], pair[1] || pair[0]);
      });
    } else {
      cols.slice(0, 3).forEach((pair, i) => put("mmgrad-" + i, pair[0], pair[1] || pair[0]));
    }
  }

  /* 从 Mermaid 打的 section-N 类里取分支号；根节点是 section--1 */
  function branchIndexOf(g) {
    const m = /section-(-?\d+)/.exec(g.getAttribute("class") || "");
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    return n < 0 ? 0 : n + 1;
  }

  function hexToRgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixHex(c1, c2, w1) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return "rgb(" + a.map((v, i) => Math.round(v * w1 + b[i] * (1 - w1))).join(",") + ")";
  }
  /* 将暗色提亮为可见的发光色；已够亮的颜色只做轻微提亮，避免发灰。 */
  function brighten(c, amount) {
    const [r, g, b] = hexToRgb(c);
    amount = Math.max(0, Math.min(1, amount));
    return "rgb(" + Math.round(r + (255 - r) * amount) + "," + Math.round(g + (255 - g) * amount) + "," + Math.round(b + (255 - b) * amount) + ")";
  }

  /* ---------------- 节点形状重绘 ----------------
   * Mermaid 原生形状普遍偏大、偏圆，直接用在 3 级视区里会互相挤压：
   *   · 圆形直径取「文字对角线 + padding」，高度是矩形的 2.4 倍，
   *     实测同级节点垂直间距为 -4.8px（即真正重叠）；
   *   · 矩形 / 六边形高度为文字高的 2.7 倍，显得又高又笨；
   *   · 云朵高达 86px，占掉两行节点的位置。
   * 这里统一按文字实际尺寸重绘几何：
   *   · 矩形类：横向留白 > 纵向留白，得到横向细长的观感，圆角收敛为微导圆角；
   *   · 圆形：改为横向椭圆（rx 跟随文字宽，ry 跟随文字高并收敛），大幅降低垂直占位；
   *   · 云朵：保留 Mermaid 的有机轮廓，仅按目标高度做垂直压缩；
   *   · 等边三角形：Mermaid mindmap 无此语法，用六边形 {{ }} 语法占位后重绘。
   * 只改几何、不动布局：连线端点本就深入节点内部十几像素并被节点盖住，
   * 形状缩小后依然被覆盖，因此无需同步调整连线。 */
  const GEOM_ATTRS = new Set(["d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "points", "transform"]);
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* 元素中心在 g.mindmap-node 局部坐标系中的位置（自动跨越中间各层 transform） */
  function centerIn(el, gEl) {
    const b = el.getBBox();
    const mg = gEl.getCTM(), me = el.getCTM();
    if (!mg || !me) return null;
    const p = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(mg.inverse().multiply(me));
    return { x: p.x, y: p.y };
  }

  /* 承载文字的那个带 transform 的 <g>（Mermaid 用它把文字摆到形状中心） */
  function textGroupOf(textEl, g) {
    let el = textEl.parentElement, fallback = null;
    while (el && el !== g) {
      if (el.getAttribute("transform")) return el;
      if (!fallback) fallback = el;
      el = el.parentElement;
    }
    return fallback || textEl.parentElement;
  }

  function cloneShapeEl(src, tag) {
    const el = document.createElementNS(SVG_NS, tag);
    Array.from(src.attributes).forEach((a) => {
      if (GEOM_ATTRS.has(a.name)) return;
      el.setAttribute(a.name, a.value);
    });
    return el;
  }

  function pointsStr(pts) {
    return pts.map((p) => p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" ");
  }

  /* 返回 {el, box, textOffsetY}；box 为新形状在 g 局部坐标系下的包围盒 */
  function buildShape(geom, shapeEl, c, tw, th) {
    if (geom.kind === "rect") {
      const w = tw + geom.padX * 2, h = th + geom.padY * 2;
      const el = cloneShapeEl(shapeEl, "rect");
      el.setAttribute("x", (c.x - w / 2).toFixed(2));
      el.setAttribute("y", (c.y - h / 2).toFixed(2));
      el.setAttribute("width", w.toFixed(2));
      el.setAttribute("height", h.toFixed(2));
      if (geom.radius) { el.setAttribute("rx", geom.radius); el.setAttribute("ry", geom.radius); }
      return { el: el, box: { x: c.x - w / 2, y: c.y - h / 2, w: w, h: h }, textOffsetY: 0 };
    }
    if (geom.kind === "circle") {
      /* 正圆：半径 = max(文字半宽, 文字半高) + 小 padding，让圆贴近文字、
       * 整体大小约为之前的 7/10。文字四角到圆心的距离 ≤ 半对角线，
       * 加上 padR 后确保文字不会探出圆外。 */
      const r = Math.max(tw, th) / 2 + geom.padR;
      const el = cloneShapeEl(shapeEl, "circle");
      el.setAttribute("cx", c.x.toFixed(2));
      el.setAttribute("cy", c.y.toFixed(2));
      el.setAttribute("r", r.toFixed(2));
      return { el: el, box: { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 }, textOffsetY: 0 };
    }
    if (geom.kind === "ellipse") {
      const rx = tw / 2 + geom.padRX;
      const ry = Math.max(th / 2 + geom.padRY, rx * (geom.flat || 0.6));
      const el = cloneShapeEl(shapeEl, "ellipse");
      el.setAttribute("cx", c.x.toFixed(2));
      el.setAttribute("cy", c.y.toFixed(2));
      el.setAttribute("rx", rx.toFixed(2));
      el.setAttribute("ry", ry.toFixed(2));
      return { el: el, box: { x: c.x - rx, y: c.y - ry, w: rx * 2, h: ry * 2 }, textOffsetY: 0 };
    }
    if (geom.kind === "hexagon") {
      const w = tw + geom.padX * 2, h = th + geom.padY * 2;
      const cut = Math.min(geom.cut || 13, w * 0.18);
      const el = cloneShapeEl(shapeEl, "polygon");
      el.setAttribute("points", pointsStr([
        [c.x - w / 2 + cut, c.y - h / 2],
        [c.x + w / 2 - cut, c.y - h / 2],
        [c.x + w / 2, c.y],
        [c.x + w / 2 - cut, c.y + h / 2],
        [c.x - w / 2 + cut, c.y + h / 2],
        [c.x - w / 2, c.y]
      ]));
      return { el: el, box: { x: c.x - w / 2, y: c.y - h / 2, w: w, h: h }, textOffsetY: 0 };
    }
    if (geom.kind === "triangle") {
      /* 等边三角形高 H = a·√3/2。三角形装横向文字很浪费垂直空间，
       * 因此高度设上限（实测布局可用中心距约 107px，多行文字按比例放宽），
       * 文字允许轻微探出斜边，视觉上像贴在三角徽章上的标签。 */
      const lines = Math.max(1, Math.round(th / 19));
      const maxH = 60 + lines * 36;
      const H = Math.max(th + 30, Math.min(tw * 1.35 + 22, maxH));
      const a = H / (Math.sqrt(3) / 2);
      const el = cloneShapeEl(shapeEl, "polygon");
      el.setAttribute("points", pointsStr([
        [c.x, c.y - H / 2],
        [c.x + a / 2, c.y + H / 2],
        [c.x - a / 2, c.y + H / 2]
      ]));
      /* 等边三角形的视觉重心在距底边 H/3 处，比几何中心偏低 */
      return { el: el, box: { x: c.x - a / 2, y: c.y - H / 2, w: a, h: H }, textOffsetY: H * 0.18 };
    }
    return null;
  }

  function reshapeNode(g, geom) {
    const shapeEl = g.querySelector("rect, circle, path, ellipse, polygon");
    const textEl = g.querySelector("text");
    if (!shapeEl || !textEl) return;
    const c = centerIn(shapeEl, g);
    const tc = centerIn(textEl, g);
    if (!c || !tc) return;
    const tb = textEl.getBBox();
    const tw = tb.width, th = tb.height;
    if (!tw || !th) return;

    let box, textOffsetY = 0;

    if (geom.kind === "cloud") {
      /* 云朵保留 Mermaid 的有机轮廓，只按目标高度做垂直压缩（以自身中心为锚点，
       * 中心不变，因此文字无需重新居中）。 */
      const b = shapeEl.getBBox();
      const targetH = th + geom.padY * 2;
      const k = Math.min(1, targetH / b.height);
      const bx = b.x + b.width / 2, by = b.y + b.height / 2;
      shapeEl.setAttribute("transform",
        "translate(" + bx.toFixed(2) + "," + by.toFixed(2) + ") scale(1," + k.toFixed(3) + ") translate(" + (-bx).toFixed(2) + "," + (-by).toFixed(2) + ")");
      box = { x: bx - b.width / 2, y: by - (b.height * k) / 2, w: b.width, h: b.height * k };
    } else {
      /* Mermaid mindmap 把 shape 套在 <g transform="translate(tx,ty)"> 里再挂回 g.mindmap-node，
       * 所以 cx/cy/x/y/points 是"元素自身局部坐标"（wrapper-local），而 centerIn 返回的是
       * g.mindmap-node-local。直接用 c 设 cx/cy 会让新形状被多平移一次，表现为严重错位。
       * 这里用 CTM 反推，把 c 换算到 shapeEl 父节点的局部坐标再交给 buildShape。 */
      const cEl = toElementLocal(c, shapeEl, g);
      const built = buildShape(geom, shapeEl, cEl, tw, th);
      if (!built) return;
      box = built.box;
      textOffsetY = built.textOffsetY;
      shapeEl.parentNode.replaceChild(built.el, shapeEl);
    }

    /* 文字重新居中到新形状（三角形需按重心下移） */
    const dx = c.x - tc.x, dy = c.y + textOffsetY - tc.y;
    if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
      const tg = textGroupOf(textEl, g);
      if (tg) {
        const prev = tg.getAttribute("transform") || "";
        tg.setAttribute("transform", (prev ? prev + " " : "") + "translate(" + dx.toFixed(2) + "," + dy.toFixed(2) + ")");
      }
    }

  }

  /* 把 g.mindmap-node-local 下的点 c 换算到 shapeEl 父节点的局部坐标
   * （也就是 cx/cy/x/y/points 真正所在的坐标空间）。形状元素被包在多层 translate 的
   * wrapper-g 里，必须用 CTM 反推，不能简单相减。
   * 注意：要用 shapeEl.parentElement 的 CTM，而不是 shapeEl 本身的 CTM。
   * 因为新形状会替换 shapeEl 并挂到同一父节点下，若 shapeEl 自身带 transform 属性
   *（如 Mermaid 给 circle 写的 translate），用 me 反推会回到 shapeEl-local，
   * 而新元素的 cx/cy 实际在 parent-local，导致严重错位。 */
  function toElementLocal(c, shapeEl, g) {
    const parent = shapeEl.parentElement;
    const mp = parent && parent.getCTM();
    const mg = g.getCTM();
    if (!mp || !mg) return c;
    /* mp: parent-local → user；mg: g-local → user。
     * 反推到 parent-local: c_parent = mp⁻¹ · mg · c_g。 */
    const m = mp.inverse().multiply(mg);
    const p = new DOMPoint(c.x, c.y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  function applyGradient(nodeEl, depthRel, branchIdx) {
    const fillEl = nodeEl.querySelector("rect, circle, path, ellipse, polygon");
    if (!fillEl) return;
    const theme = getTheme(state.theme);
    if (theme && theme.byBranch) {
      const n = Math.max(1, (theme.colors || []).length);
      fillEl.style.setProperty("fill", "url(#mmgrad-b" + (branchIdx % n) + ")", "important");
      return;
    }
    /* Mermaid 10 mindmap 会在 SVG <style> 里注入 .section-* path { fill: hsl(...,0%) }
     * 等规则，优先级高于 fill 属性，导致我们注入的 url(#mmgrad-N) 属性被覆盖，
     * 节点显示为黑色/灰色，无法呈现主题渐变。
     * 改用内联 style 并加 !important，确保渐变始终生效。 */
    fillEl.style.setProperty("fill", "url(#mmgrad-" + Math.min(depthRel, 2) + ")", "important");
  }

  function postProcessSVG(sub) {
    const container = $("#mermaid-container");
    const svg = container.querySelector("svg");
    if (!svg) return;
    injectGradients(svg);

    /* 连线：Mermaid 注入的 .edge-depth-* 线宽为 14/11/8px（相邻级差仅 ~21%），
     * 3 级视区里只有两档线，肉眼几乎看不出粗细变化（原生 Mermaid 的锥形感
     * 来自 5、6 级深树的 17→14→11→8→5→2）。
     * 这里按「父节点层级」（edge-depth 类即父级）显式设置更强的锥形线宽，
     * 用内联 style + !important，不受 Mermaid 内部 CSS 与外部样式影响：
     * root→一级 14px、一级→二级 8px、二级→三级 4.5px。
     * 颜色取当前主题对应层级渐变的亮端，与固定中性蓝灰 6:4 混合：
     * 既呼应节点主题色，又保证深浅两种模式下都清晰可读。 */
    const EDGE_NEUTRAL = "#9aa7bd";
    const EDGE_WIDTH = [14, 8, 4.5];
    const cols = (getTheme(state.theme) || {}).colors || [];
    svg.querySelectorAll(".mindmap-edges .edge").forEach((e) => {
      const dm = /edge-depth-(-?\d+)/.exec(e.getAttribute("class") || "");
      const d = dm ? Math.max(0, parseInt(dm[1], 10)) : 0;
      const base = cols[d] && cols[d][1];
      e.style.setProperty("stroke", base ? mixHex(base, EDGE_NEUTRAL, 0.6) : EDGE_NEUTRAL, "important");
      e.style.setProperty("fill", "none", "important");
      e.style.setProperty("stroke-width", String(EDGE_WIDTH[Math.min(d, 2)]), "important");
      /* 粗线下折点会有尖角凸起，用圆角连接+圆头线帽过渡更顺滑；
       * 线帽超出节点边界的部分会被后绘制的节点图形盖住，不会外溢。 */
      e.style.setProperty("stroke-linejoin", "round");
      e.style.setProperty("stroke-linecap", "round");
    });

    const shape = getShape(state.shape);
    const geom = shape ? shape.geom : null;
    /* 所有根节点固定为正圆形（与当前用户所选形状无关）。
     * 使用独立的 ROOT_CIRCLE_GEOM，而不是用户「圆形」形状的扁椭圆 geom。 */
    const ROOT_CIRCLE_GEOM = { kind: "circle", padR: 2 };
    const labelMap = new Map(state.renderLabelMap.map((x) => [x.label, x.node]));
    /* 呼吸光色：按节点实际填充色（层级渐变亮端 / byBranch 分支色）计算，
     * 并对暗色做提亮，保证在深色背景下始终可见。CSS 用 var(--glow) 引用。
     * 这样不同主题、不同分支、不同层级的发光颜色都会跟着变化，不会 stuck 在蓝色。 */
    const theme = getTheme(state.theme);
    // cols 已在上方连线处理处定义，复用同一份主题配色。

    svg.querySelectorAll("g.mindmap-node").forEach((g) => {
      const txtEl = g.querySelector("text");
      const txt = txtEl ? (txtEl.textContent || "").trim() : "";
      const node = labelMap.get(txt);
      if (!node) return;
      g.dataset.gid = node.id;
      g.dataset.relDepth = node.depthRel;
      g.dataset.hasMore = node.hasMore ? "1" : "0";
      g.classList.add("mind-node");
      const bi = branchIndexOf(g);
      if (node.hasMore) {
        let base;
        if (theme && theme.byBranch) {
          base = (cols[bi % cols.length] || [])[0] || "#00e5ff";
        } else {
          const pair = cols[Math.min(node.depthRel, 2)];
          base = pair ? (pair[1] || pair[0]) : "#00e5ff";
        }
        g.style.setProperty("--glow", brighten(base, 0.55));
        g.classList.add("has-more-glowing");
      }
      /* Mermaid 给每个节点画的底部装饰粗线（原设计里充当"卡片下沿"）。
       * 新形状走的是克制的纯色块路线，这条线会变成突兀的白色横条，直接移除。 */
      const deco = g.querySelector("line");
      if (deco) deco.remove();
      const nodeGeom = node.depthRel === 0 ? ROOT_CIRCLE_GEOM : geom;
      if (nodeGeom) reshapeNode(g, nodeGeom);
      applyGradient(g, node.depthRel, bi);
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
  function getShape(id) { return (window.APP_CONFIG.shapes || []).find((s) => s.id === id) || window.APP_CONFIG.shapes[0]; }

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
    savePrefs({ themePinned: true });
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
      const dotCls = { circle: "circle", hexagon: "hexagon", cloud: "cloud" }[s.id] || "";
      dot.className = "shape-dot" + (dotCls ? " " + dotCls : "");
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
    savePrefs({ shapePinned: true });
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
      else if (a === "export-png") exportPng();
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
  function exportPng() {
    const svg = $("#mermaid-container svg");
    if (!svg) { toast("当前没有可导出的脑图", true); return; }
    try {
      /* 克隆 SVG 序列化为独立图片。节点渐变/连线颜色已由后处理写成内联样式，
       * Mermaid 内部 <style> 随克隆一起带走；页面级样式（文字白色、字体）
       * 需要在这里手动补齐，否则导出图中文字会回退为默认黑字。 */
      const clone = svg.cloneNode(true);
      clone.querySelectorAll("g.mindmap-node text, .node text").forEach((t) => {
        t.setAttribute("fill", "#ffffff");
      });
      clone.setAttribute("font-family", '"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif');
      const vb = (clone.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      let W = (vb.length === 4 && vb[2] > 0) ? vb[2] : parseFloat(clone.getAttribute("width"));
      let H = (vb.length === 4 && vb[3] > 0) ? vb[3] : parseFloat(clone.getAttribute("height"));
      if (!W || !H) { W = 800; H = 600; }
      W = Math.ceil(W); H = Math.ceil(H);
      clone.setAttribute("width", W);
      clone.setAttribute("height", H);
      clone.style.maxWidth = "";
      const xml = new XMLSerializer().serializeToString(clone);
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      const scale = 2; /* 2 倍分辨率，保证公众号长图清晰 */
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = W * scale; cv.height = H * scale;
        const ctx = cv.getContext("2d");
        ctx.scale(scale, scale);
        /* 背景跟随当前深浅色模式，避免导出透明底在浅色查看器里“消失” */
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#10141d";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        cv.toBlob((blob) => {
          if (!blob) { toast("PNG 导出失败", true); return; }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "无限脑图.png";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
          toast("已导出 .png 图片（2 倍分辨率）");
        }, "image/png");
      };
      img.onerror = () => toast("PNG 导出失败：SVG 序列化异常", true);
      img.src = url;
    } catch (e) {
      toast("PNG 导出失败：" + ((e && e.message) || e), true);
    }
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
      state.theme = (p.themePinned && p.theme) || window.APP_CONFIG.defaultTheme || "forest";
      state.shape = (p.shapePinned && p.shape) || window.APP_CONFIG.defaultShape || "default";
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
