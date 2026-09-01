/* ============================================================
 * parser.js —— Markdown 缩进树 ⇄ 全局 JSON Tree
 *   parseMarkdownToTree   : 缩进文本 → JSON 树（记录 line 供反向定位）
 *   extractSubtree        : 以 currentFocusId 为根截取 3 层视区子树
 *   convertToMermaid      : 视区子树 → Mermaid mindmap 文本
 *   findNode / getPathTo / getParentId / searchNodes : 树工具
 * ============================================================ */
const TreeParser = (() => {
  const INDENT = 2; // 每级缩进 = 2 个空格

  /* ---------- 基础工具 ---------- */
  function sanitizeLabel(raw) {
    let s = String(raw == null ? "" : raw).trim();
    // 去掉 markdown 前缀（# 标题 / - * + 列表符）
    s = s.replace(/^#+\s*/, "").replace(/^[-*+]\s+/, "");
    // 替换会与 mermaid 语法冲突的符号为全角，避免破坏节点
    return s
      .replace(/\(/g, "（").replace(/\)/g, "）")
      .replace(/\[/g, "［").replace(/\]/g, "］")
      .replace(/\{/g, "｛").replace(/\}/g, "｝")
      .replace(/</g, "＜").replace(/>/g, "＞")
      .replace(/\|/g, "｜")
      .replace(/[\r\n]+/g, " ")
      .trim();
  }

  /* 根据显示宽度自动换行：CJK 等宽字符按 2，ASCII 按 1，零宽字符按 0。
   * 超过阈值时拆分为多行，用 <br/> 连接供 Mermaid 渲染成多行文本。 */
  function charDisplayWidth(ch) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200B || cp === 0x200C || cp === 0x200D) return 0;
    if (cp >= 0x3000 && cp <= 0x9FFF) return 2;
    if (cp >= 0xAC00 && cp <= 0xD7AF) return 2;
    if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
    return 1;
  }
  function wrapLabel(s, maxUnits) {
    if (!s) return s;
    const total = Array.from(s).reduce((sum, ch) => sum + charDisplayWidth(ch), 0);
    if (total <= maxUnits) return s;
    const parts = [];
    let cur = "", curW = 0;
    for (const ch of s) {
      const w = charDisplayWidth(ch);
      if (curW + w > maxUnits && cur) {
        parts.push(cur);
        cur = ch; curW = w;
      } else {
        cur += ch; curW += w;
      }
    }
    if (cur) parts.push(cur);
    return parts.join("<br/>");
  }

  /* ---------- 1. 缩进文本 → JSON Tree ---------- */
  function parseMarkdownToTree(text) {
    const lines = String(text == null ? "" : text).split(/\r?\n/);
    const root = { label: "根", id: "0", depth: 0, line: 1, children: [] };
    const stack = [root];
    let hasRoot = false;

    lines.forEach((raw, idx) => {
      const lineNo = idx + 1;
      const t = raw.replace(/\t/g, "  ");
      if (!t.trim()) return;
      let indent = t.length - t.trimStart().length;
      let label = sanitizeLabel(t);

      // 第一行：若顶格则作为真正的根节点
      if (!hasRoot) {
        hasRoot = true;
        if (indent === 0) {
          root.label = label || root.label;
          root.line = lineNo;
          return; // 根节点已就位，后续行按正常逻辑入栈
        }
        // 否则使用合成根，该行降为一级
        indent = INDENT;
      }

      let depth = Math.floor(indent / INDENT);
      if (hasRoot && depth < 1) depth = 1; // 根之后不允许再出现顶格节点，降为一级
      const topDepth = stack.length - 1;
      if (depth > topDepth + 1) depth = topDepth + 1; // 缩进跳跃过大时钳制
      while (stack.length > depth) stack.pop(); // 出栈到父层级（stack.length == depth）

      const parent = stack[stack.length - 1];
      const node = {
        label,
        id: parent.id + "-" + parent.children.length,
        depth: depth,
        line: lineNo,
        children: []
      };
      parent.children.push(node);
      stack.push(node);
    });

    return root;
  }

  /* ---------- 树查询工具 ---------- */
  function findNode(tree, id) {
    if (!tree || id == null) return null;
    if (id === tree.id) return tree;
    const segs = String(id).split("-");
    let cur = tree;
    for (let i = 1; i < segs.length; i++) {
      cur = cur && cur.children ? cur.children[+segs[i]] : undefined;
      if (!cur) return null;
    }
    return cur;
  }

  function getPathTo(tree, id) {
    const path = [];
    if (!tree) return path;
    const segs = String(id).split("-");
    let cur = tree;
    path.push(cur);
    for (let i = 1; i < segs.length; i++) {
      cur = cur && cur.children ? cur.children[+segs[i]] : undefined;
      if (!cur) return path;
      path.push(cur);
    }
    return path;
  }

  function getParentId(tree, id) {
    if (!tree || String(id) === tree.id) return null;
    const s = String(id).split("-");
    s.pop();
    return s.join("-");
  }

  function nodeHasChildren(tree, id) {
    const n = findNode(tree, id);
    return !!(n && n.children && n.children.length);
  }

  /* ---------- 2. 截取 3 层视区子树 ---------- */
  /* 视区：focus 为根 → 一级 → 二级（共 maxDepth 层）。
   * 第 maxDepth 层节点若在全局仍有子节点 → hasMore=true（用于发光） */
  function extractSubtree(tree, focusId, maxDepth) {
    maxDepth = maxDepth || 3;
    const focus = findNode(tree, focusId) || tree;
    function build(n, d) {
      const hasChildren = !!(n.children && n.children.length);
      return {
        label: n.label,
        id: n.id,
        line: n.line,
        depthRel: d,
        hasChildren,
        hasMore: d === maxDepth - 1 && hasChildren,
        children: d < maxDepth - 1 ? (n.children || []).map((c) => build(c, d + 1)) : []
      };
    }
    return build(focus, 0);
  }

  /* ---------- 3. 视区子树 → Mermaid mindmap 文本 ----------
   * shapeId : 节点形状；outMap : 输出 [{label, node}] 供后处理反查 */
  function convertToMermaid(subTree, shapeId, outMap, shapes) {
    const shape = (shapes && shapes.find((s) => s.id === shapeId)) || { open: "", close: "" };
    const used = new Set();
    if (outMap) outMap.length = 0;
    const lines = ["mindmap"];

    function walk(n, d) {
      let base = sanitizeLabel(n.label) || " ";
      let key = base;
      let i = 1;
      while (used.has(key)) key = base + "\u200B".repeat(i++);
      used.add(key);
      if (outMap) outMap.push({ label: key, node: n });
      /* 按层级控制最大显示宽度，避免节点过长撑开整体布局。
       * 根节点可稍宽，一级、二级逐层收紧。 */
      const maxUnits = d === 0 ? 18 : d === 1 ? 14 : 12;
      const text = (shape.open || "") + wrapLabel(key, maxUnits) + (shape.close || "");
      lines.push("  ".repeat(d + 1) + text);
      (n.children || []).forEach((c) => walk(c, d + 1));
    }
    walk(subTree, 0);
    return lines.join("\n");
  }

  /* ---------- 搜索 ---------- */
  function searchNodes(tree, query, limit) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    const out = [];
    if (!q || !tree) return out;
    const exact = [];
    const stack = [tree];
    while (stack.length) {
      const n = stack.pop();
      if (n.children) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
      const lab = String(n.label || "").toLowerCase();
      if (lab === q) exact.push(n);
      else if (lab.includes(q)) out.push(n);
      if (exact.length + out.length > (limit || 20) * 2) break;
    }
    const merged = exact.concat(out);
    return merged.slice(0, limit || 20);
  }

  /* ---------- 导入 .mmd 时剥离 mermaid 形状标记 ---------- */
  function stripMermaidShapes(text) {
    return String(text == null ? "" : text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^%%/.test(l) && !/^mindmap\b/i.test(l))
      .map((l) => {
        return l
          .replace(/^\}\)+/, "").replace(/\(\(+$/,"")
          .replace(/^\}\{+/, "").replace(/\}\}+$/, "")
          .replace(/^\)+/, "").replace(/\(+$/, "")
          .replace(/^\[+/, "").replace(/\]+$/, "")
          .replace(/^\(+/, "").replace(/\)+$/, "")
          .replace(/^\{+/, "").replace(/\}+$/, "");
      })
      .join("\n");
  }

  return {
    INDENT,
    parseMarkdownToTree,
    findNode,
    getPathTo,
    getParentId,
    nodeHasChildren,
    extractSubtree,
    convertToMermaid,
    searchNodes,
    stripMermaidShapes,
    sanitizeLabel
  };
})();
