// scatter-playground.js — 点が多い散布図の見せ方を並べて比べる試作
//   まず試す(今の散布図のまま手軽に直す)/ 1品を選ぶ(検索ページ向け)/ 傾向を見る(紹介・分析ページ向け)
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const STYLES = ["和風", "洋風", "中華", "韓国風", "エスニック", "インド風", "メキシカン"];
  const CATS = ["主食", "主菜", "副菜", "汁物", "デザート"];
  const styleColor = d3.scaleOrdinal(STYLES, ["#f26b38", "#db6f9f", "#e09b1f", "#3fae84", "#4a98c5", "#7c6ed6", "#8bbf4a"]);
  const catColor = d3.scaleOrdinal(CATS, ["#d9a23c", "#d9534f", "#4fa364", "#3c8dbc", "#c77dd6"]);
  const MISSING_MAX = 8;
  // 軸にできる値。bins はヒートマップ・背景のマス目の区切り
  const AX = {
    time: { label: "調理時間(分)", unit: "分", get: r => Math.min(r.time_min, 120), time: true, lowerBetter: true },
    missing: { label: "足りない食材の数", unit: "個", get: r => Math.min(r._missing, MISSING_MAX), int: true, max: MISSING_MAX, lowerBetter: true },
    price: { label: "値段(円・1人前)", unit: "円", get: r => r.price, max: 600, bins: [0, 100, 150, 200, 250, 300, 400, 500, Infinity], lowerBetter: true },
    kcal: { label: "カロリー(kcal・1人前)", unit: "kcal", get: r => r.nutrition?.kcal ?? 0, max: 1000, bins: [0, 100, 200, 300, 400, 500, 600, 800, Infinity], lowerBetter: true },
    protein: { label: "たんぱく質(g・1人前)", unit: "g", get: r => r.nutrition?.protein ?? 0, max: 50, bins: [0, 5, 10, 15, 20, 25, 30, 40, Infinity], lowerBetter: false },
    match: { label: "マッチ度", unit: "%", get: r => r._match, max: 1, pct: true, lowerBetter: false },
  };
  const TIME_BINS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 30], [30, 45], [45, 60], [60, 90], [90, 120]];

  const state = { recipes: [], master: {}, aliasMap: new Map(), have: [], view: "quick", ykey: "price", tscale: "ord", times: [] };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
  const pct = x => `${Math.round(x * 100)}%`;
  const fmtV = (k, v) => (AX[k].pct ? pct(v) : `${Math.round(v)}${AX[k].unit}`);

  // ---------- 食材の入力とマッチ度 ----------
  const norm = s => s.normalize("NFKC").trim().toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const membersOf = n => (state.master[n] || {}).members || [];
  const hasIng = (set, n) => set.has(n) || membersOf(n).some(m => set.has(m));
  function readHave() {
    const known = [], unknown = [];
    for (const t of $("have").value.split(/[、,，\s]+/).filter(Boolean)) {
      const c = state.aliasMap.get(norm(t));
      if (c) { if (!known.includes(c)) known.push(c); } else unknown.push(t);
    }
    state.have = known;
    $("unknown").textContent = unknown.length ? `(見つからない食材: ${unknown.join("、")})` : "";
    const set = new Set(known);
    for (const n of known) for (const m of membersOf(n)) set.add(m);
    for (const r of state.recipes) {
      const names = r.ingredients.map(i => i.name);
      const matched = names.filter(n => hasIng(set, n));
      const used = known.filter(h => matched.some(m => m === h || membersOf(h).includes(m) || membersOf(m).includes(h)));
      const cov = names.length ? matched.length / names.length : 0, use = known.length ? used.length / known.length : 0;
      r._match = cov + use ? (2 * cov * use) / (cov + use) : 0;   // 充足度と使い切り度の調和平均(tree-playground と同じ)
      r._missing = names.length - matched.length;
      r._usedHave = used;                                   // このレシピで使う手持ちの食材(組み合わせ表で使う)
      r._missingNames = names.filter(n => !hasIng(set, n));  // 足りない食材の名前(買い足しの階段で使う)
    }
  }

  // ---------- 軸(scale) ----------
  // 返すもの: s = 連続の d3 scale、val = 値 → s に渡す値(順番だけの軸なら何番目か)、jw = ずらす幅(px)、ticks/fmt = 目盛り
  function makeScale(key, range) {
    const a = AX[key], len = Math.abs(range[1] - range[0]);
    if (a.time) {
      const T = state.times;
      if (state.tscale === "ord") {
        const idx = t => { let best = 0; T.forEach((v, i) => { if (Math.abs(v - t) < Math.abs(T[best] - t)) best = i; }); return best; };
        const s = d3.scaleLinear([-0.5, T.length - 0.5], range);
        return { key, s, val: idx, jw: len / T.length * 0.62, ticks: d3.range(T.length), fmt: i => (Number.isInteger(i) && T[i] != null ? `${T[i]}分` : "") };
      }
      if (state.tscale === "log") {
        const s = d3.scaleLog([4, 135], range);
        return { key, s, val: t => Math.max(t, 4), jw: 9, ticks: [5, 10, 15, 20, 30, 60, 90, 120], fmt: v => `${v}分` };
      }
      const s = d3.scaleLinear([0, 125], range);
      return { key, s, val: t => t, jw: Math.abs(s(3.6) - s(0)), ticks: [5, 10, 15, 20, 30, 45, 60, 90, 120], fmt: v => `${v}分` };
    }
    if (a.int) {
      const s = d3.scaleLinear([-0.5, a.max + 0.5], range);
      return { key, s, val: v => v, jw: len / (a.max + 1) * 0.62, ticks: d3.range(a.max + 1), fmt: v => (v === a.max ? `${v}+個` : `${v}個`) };
    }
    const s = d3.scaleLinear([0, a.max], range).clamp(true);
    return { key, s, val: v => v, jw: a.pct ? len * 0.012 : len * 0.008, ticks: s.ticks(6), fmt: v => (a.pct ? pct(v) : v >= a.max ? `${v}+` : v) };
  }
  // 料理 r の位置(jitter: ずらすかどうか)
  const posOf = (sc, r, jitter = true, salt = "") => sc.s(sc.val(AX[sc.key].get(r))) + (jitter ? (hash(r.id + sc.key + salt) - 0.5) * sc.jw : 0);
  function drawAxis(g, sc, orient, at, { small = false, grid = null } = {}) {
    let ticks = sc.ticks;
    if (small && AX[sc.key].time) ticks = ticks.filter((_, i, arr) => i % Math.ceil(arr.length / 4) === 0);
    if (small && !AX[sc.key].time) ticks = sc.s.ticks ? sc.s.ticks(3) : ticks;
    const [d0, d1] = sc.s.domain().map(Number);
    ticks = ticks.filter(v => v >= Math.min(d0, d1) - 1e-9 && v <= Math.max(d0, d1) + 1e-9);
    if (grid) {
      g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
        .attr(orient === "left" ? "x1" : "y1", grid[0]).attr(orient === "left" ? "x2" : "y2", grid[1])
        .attr(orient === "left" ? "y1" : "x1", d => sc.s(d)).attr(orient === "left" ? "y2" : "x2", d => sc.s(d));
    }
    const ax = (orient === "left" ? d3.axisLeft(sc.s) : d3.axisBottom(sc.s)).tickValues(ticks).tickFormat(sc.fmt);
    g.append("g").attr("class", "axis").attr("transform", orient === "left" ? `translate(${at},0)` : `translate(0,${at})`).call(ax);
  }

  // ---------- 共通の描画部品 ----------
  let W, H;
  const M = { t: 18, r: 18, b: 40, l: 58 };
  function setup(height) {
    W = Math.max(320, $("chart").clientWidth || 800);
    H = height || Math.max(420, Math.min(600, W * 0.62));
    const svg = d3.select("#chart").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    svg.selectAll("*").remove();
    svg.on(".zoom", null).on("click", null);
    $("legend").innerHTML = "";
    return svg;
  }
  // 横軸 = 調理時間、縦軸 = 上で選んだ値 の基本の組み合わせ
  function basic(svg, g, yKey = state.ykey) {
    const X = makeScale("time", [M.l, W - M.r]), Yc = makeScale(yKey, [H - M.b, M.t]);
    drawAxis(g, Yc, "left", M.l, { grid: [M.l, W - M.r] });
    drawAxis(g, X, "bottom", H - M.b);
    g.append("text").attr("x", W - M.r).attr("y", H - 6).attr("text-anchor", "end").text("調理時間");
    g.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text(AX[yKey].label);
    return { X, Yc };
  }
  function tipOn(e, html) {
    const box = $("chart-wrap").getBoundingClientRect(), tip = $("tip");
    tip.innerHTML = html;
    tip.style.left = Math.min(e.clientX - box.left + 12, box.width - 270) + "px";
    tip.style.top = (e.clientY - box.top + 12) + "px";
    tip.hidden = false;
  }
  const tipOff = () => { $("tip").hidden = true; };
  const recipeTip = r => `<b>${esc(r.name)}</b><br>${r.style}・${r.category}　${r.time_min}分・${fmtV(state.ykey, AX[state.ykey].get(r))}` +
    (state.have.length ? `<br>マッチ度 ${pct(r._match)}・足りない食材 ${r._missing}` : "");
  function showList(title, recipes) {
    const list = recipes.slice().sort((a, b) => b._match - a._match || a.time_min - b.time_min);
    const q = state.have.join("、");
    $("list").innerHTML = `<h3>${esc(title)}</h3><p class="small">${recipes.length}品${recipes.length > 60 ? "(マッチ度の高い60品を表示)" : ""}。料理名を押すと検索ページで開きます。</p>
      <ol class="list">${list.slice(0, 60).map(r => `<li>${state.have.length ? `<span class="m">${pct(r._match)}</span>` : ""}<a href="search.html?${new URLSearchParams({ open: r.id, have: q })}" target="_blank">${esc(r.name)}</a>
      <div class="small">${r.style}・${r.category}　${r.time_min}分・${fmtV(state.ykey, AX[state.ykey].get(r))}${state.have.length && r._missing ? `・足りない${r._missing}` : ""}</div></li>`).join("")}</ol>`;
  }
  const ctrl = html => { $("view-ctrl").innerHTML = html; };
  const styleLegend = (prefix = "") => { $("legend").innerHTML = prefix + STYLES.map(s => `<span><i style="background:${styleColor(s)}"></i>${s}</span>`).join(""); };
  const matchColor = d3.scaleSequential([0, 0.7], d3.interpolateRgb("#e9e1d8", "#1f8a5c")).clamp(true);
  const dotEvents = sel => sel.on("mousemove", (e, r) => tipOn(e, recipeTip(r))).on("mouseleave", tipOff).on("click", (e, r) => { e.stopPropagation(); showList(r.name, [r]); });
  // 名前を重ならないように置く(重なるものは出さない、かんたんな方法)
  function placeLabels(g, items, x0 = M.l, x1 = W - 2) {
    const boxes = [];
    const fits = b => !boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) && b.x1 < x1 && b.x0 > x0;
    for (const it of items) {
      const t = it.text.length > 12 ? it.text.slice(0, 11) + "…" : it.text, w = t.length * 11 + 4;
      for (const [dx, dy, anchor] of [[8, 4, "start"], [-8, 4, "end"], [8, -8, "start"], [8, 15, "start"], [-8, -8, "end"]]) {
        const bx = anchor === "start" ? it.x + dx : it.x + dx - w;
        const b = { x0: bx, x1: bx + w, y0: it.y + dy - 10, y1: it.y + dy + 2 };
        if (fits(b)) { boxes.push(b); g.append("text").attr("class", "label").attr("x", it.x + dx).attr("y", it.y + dy).attr("text-anchor", anchor).text(t); break; }
      }
    }
  }
  // 定番の料理(食材を入れていないときの前景用): 名前が「基本の」で始まる料理
  const staples = () => state.recipes.filter(r => r.name.startsWith("基本の"));
  // 背景のマス目: 時間の値ごとの列 × 縦軸の区切り。列の幅は、となりの時間の値との中間まで
  function gridBackground(g, X, Yc, color0 = "#fbf6f0", color1 = "#dcc8b3") {
    const T = state.times, xs = T.map(t => X.s(X.val(t)));
    const edges = xs.map((x, i) => [i ? (xs[i - 1] + x) / 2 : x - (xs[1] - xs[0]) / 2, i < xs.length - 1 ? (x + xs[i + 1]) / 2 : x + (x - xs[i - 1]) / 2]);
    const bins = AX[Yc.key].bins || d3.range(0, AX[Yc.key].max + 1e-9, AX[Yc.key].max / 8).concat(Infinity);
    const cells = [];
    T.forEach((t, i) => {
      for (let k = 0; k < bins.length - 1; k++) {
        const rs = state.recipes.filter(r => AX.time.get(r) === t && AX[Yc.key].get(r) >= bins[k] && AX[Yc.key].get(r) < bins[k + 1]);
        if (rs.length) cells.push({ x0: edges[i][0], x1: edges[i][1], y0: Yc.s(Math.min(bins[k + 1], AX[Yc.key].max)), y1: Yc.s(bins[k]), rs });
      }
    });
    const c = d3.scaleSequentialSqrt([0, d3.max(cells, d => d.rs.length) || 1], d3.interpolateRgb(color0, color1));
    g.append("g").selectAll("rect").data(cells).join("rect").attr("class", "cell")
      .attr("x", d => d.x0 + 0.5).attr("y", d => d.y0 + 0.5).attr("width", d => Math.max(0, d.x1 - d.x0 - 1)).attr("height", d => Math.max(0, d.y1 - d.y0 - 1))
      .attr("fill", d => c(d.rs.length))
      .on("click", (e, d) => showList("このマスのレシピ", d.rs)).on("mousemove", (e, d) => tipOn(e, `${d.rs.length}品`)).on("mouseleave", tipOff);
  }

  // ---------- 0. まず試す: 点をずらす・半透明で小さく・時間の軸を変える ----------
  function viewQuick() {
    const opt = (sel, list) => list.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");
    ctrl(`<label>横軸 <select id="qx">${opt("missing", [["missing", "足りない食材の数(今の検索ページ)"], ["time", "調理時間"]])}</select></label>
      <label>縦軸 <select id="qy">${opt("time", [["time", "調理時間(今の検索ページ)"], ["price", "値段"], ["kcal", "カロリー"], ["protein", "たんぱく質"], ["match", "マッチ度"]])}</select></label>
      <label><input type="checkbox" id="qj" checked> 点を少しずらす</label>
      <label><input type="checkbox" id="qa" checked> 半透明にして小さく</label>`);
    const draw = () => {
      let xk = $("qx").value, yk = $("qy").value;
      if (xk === yk) { yk = xk === "time" ? "price" : "time"; $("qy").value = yk; }
      const svg = setup(), g = svg.append("g");
      const X = makeScale(xk, [M.l, W - M.r]), Yc = makeScale(yk, [H - M.b, M.t]);
      drawAxis(g, Yc, "left", M.l, { grid: [M.l, W - M.r] });
      drawAxis(g, X, "bottom", H - M.b);
      g.append("text").attr("x", W - M.r).attr("y", H - 6).attr("text-anchor", "end").text(AX[xk].label);
      g.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text(AX[yk].label);
      const jit = $("qj").checked, light = $("qa").checked;
      dotEvents(g.append("g").selectAll("circle").data(state.recipes).join("circle").attr("class", "dot")
        .attr("cx", r => posOf(X, r, jit)).attr("cy", r => posOf(Yc, r, jit))
        .attr("r", light ? 2.4 : 4.5).attr("fill", r => styleColor(r.style)).attr("fill-opacity", light ? 0.35 : 1)
        .attr("stroke", light ? "none" : "#fff").attr("stroke-width", 0.8));
      styleLegend(`<span>全${state.recipes.length}品を点で表示。</span>`);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 8. 上位だけアイコン(今の検索ページと同じ軸・アイコン) ----------
  // 今の検索ページ(viz.js の renderScatter)は、全部の料理をアイコンにして押し合わせる(forceCollide)ので、
  // 混んだ列ではアイコンが本当の調理時間から大きくずれる。アイコンを上位だけにして、ずれがどれだけ減るかを比べる
  function viewTopN() {
    const opt = (sel, list) => list.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");
    ctrl(`<label><input type="radio" name="tn" value="top" checked> 上位だけアイコン</label>
      <label><input type="radio" name="tn" value="all"> 全部アイコン(今の検索ページ)</label>
      <label>アイコンにする数 <input type="range" id="tn-n" min="10" max="100" step="5" value="40"> <span id="tn-n-v">40</span>品</label>
      <label>足りない食材 <select id="tn-x">${opt("5", [["2", "0〜2個"], ["3", "0〜3個"], ["5", "0〜5個(今の検索ページ)"]])}</select></label>
      <label><input type="checkbox" id="tn-names"> 名前を出す</label>`);
    const draw = () => {
      $("tn-n-v").textContent = $("tn-n").value;
      const all = document.querySelector('input[name="tn"]:checked').value === "all";
      const xmax = +$("tn-x").value, input = state.have.length > 0;
      const svg = setup(), g = svg.append("g");
      const cols = d3.range(xmax + 1);
      const x = d3.scaleBand(cols, [M.l, W - M.r]), colW = x.bandwidth();
      const R = Math.max(8, Math.min(W < 600 ? 11 : 14, colW / 2 - 2));   // 今の検索ページと同じ大きさ
      const y = d3.scaleLinear([0, 120], [H - M.b - R - 2, M.t + R]);
      const pool = state.recipes.filter(r => r._missing <= xmax);
      const rank = pool.slice().sort((a, b) => b._match - a._match || a.time_min - b.time_min);
      const top = all ? rank : rank.slice(0, +$("tn-n").value);
      const topIds = new Set(top.map(r => r.id)), rest = all ? [] : pool.filter(r => !topIds.has(r.id));

      // 「今すぐ作れる」列の背景・軸
      g.append("rect").attr("x", x(0)).attr("y", M.t).attr("width", colW).attr("height", H - M.b - M.t).attr("fill", "#eef7f1");
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).tickFormat(v => (v === 0 ? "0個(今すぐ)" : `${v}個`)));
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).tickValues([0, 20, 40, 60, 80, 100, 120]).tickFormat(v => `${v}分`));
      g.append("g").attr("class", "grid").selectAll("line").data([20, 40, 60, 80, 100, 120]).join("line")
        .attr("x1", M.l).attr("x2", W - M.r).attr("y1", y).attr("y2", y);
      g.append("text").attr("x", W - M.r).attr("y", H - 6).attr("text-anchor", "end").text("足りない食材の数");
      g.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text("調理時間");

      // 残りは小さな点。押し合わせず、列の中で左右に少しずらすだけ(縦の位置は本当の時間のまま)
      dotEvents(g.append("g").selectAll("circle").data(rest).join("circle").attr("class", "dot")
        .attr("cx", r => x(r._missing) + colW / 2 + (hash(r.id) - 0.5) * colW * 0.85)
        .attr("cy", r => y(Math.min(r.time_min, 120)) + (hash(r.id + "y") - 0.5) * 4)
        .attr("r", 2.3).attr("fill", r => styleColor(r.style)).attr("fill-opacity", 0.4));

      // アイコンは今の検索ページと同じ方法で押し合わせる(viz.js の renderScatter と同じ強さ・回数)
      const nodes = top.map((r, i) => {
        const cx = x(r._missing) + colW / 2, ty = y(Math.min(r.time_min, 120));
        return { r, cx, ty, x: cx + ((i % 5) - 2) * 3, y: ty };
      });
      const sim = d3.forceSimulation(nodes).randomSource(d3.randomLcg(7)).stop()
        .force("x", d3.forceX(n => n.cx).strength(0.12))
        .force("y", d3.forceY(n => n.ty).strength(0.8))
        .force("collide", d3.forceCollide(R + 1.5));
      for (let i = 0; i < 160; i++) sim.tick();
      for (const n of nodes) {
        n.x = Math.max(n.cx - colW / 2 + R, Math.min(n.cx + colW / 2 - R, n.x));
        n.y = Math.max(M.t + R, Math.min(H - M.b - R, n.y));
        n.err = Math.abs(y.invert(n.y) - Math.min(n.r.time_min, 120));   // アイコンの高さが本当の時間から何分ずれたか
      }
      const icon = g.append("g").selectAll("g").data(nodes).join("g").attr("class", "dot")
        .attr("transform", n => `translate(${n.x},${n.y})`).style("cursor", "pointer")
        .on("mousemove", (e, n) => tipOn(e, recipeTip(n.r) + `<br>アイコンの高さのずれ ${Math.round(n.err)}分`)).on("mouseleave", tipOff)
        .on("click", (e, n) => { e.stopPropagation(); showList(n.r.name, [n.r]); });
      icon.append("circle").attr("r", R).attr("fill", "#fff").attr("stroke", n => styleColor(n.r.style)).attr("stroke-width", 2.5);
      icon.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("font-size", `${Math.round(R * 1.15)}px`).text(n => n.r.emoji || "🍽️");
      if ($("tn-names").checked) placeLabels(g, nodes.map(n => ({ x: n.x, y: n.y, text: n.r.name })));

      const errs = nodes.map(n => n.err), big = errs.filter(e => e >= 15).length;
      styleLegend(`<span>${input ? "" : "<b>上で「今ある食材」を入れてください。</b>"}アイコン ${nodes.length}品${rest.length ? `・小さな点 ${rest.length}品` : ""}(足りない食材 ${xmax}個以下の ${pool.length}品)。
        アイコンの高さのずれ: 平均 ${Math.round(d3.mean(errs) || 0)}分・最大 ${Math.round(d3.max(errs) || 0)}分・15分以上ずれたもの ${big}品</span><br>`);
      showList(all ? `マッチ度の高い順(${xmax}個以下の全${pool.length}品)` : `アイコンにした上位${top.length}品`, top);
    };
    $("view-ctrl").oninput = draw;
    draw();
  }

  // ---------- 13. アイコンごとにまとめる(今の検索ページと同じ軸) ----------
  // 同じ列(足りない食材の数)・同じ時間(または時間帯)・同じアイコンの料理を1つの丸にまとめ、大きさと数字で品数を出す
  const TIME_BANDS = [[0, 10], [10, 20], [20, 30], [30, 45], [45, 60], [60, 999]];
  function viewAgg() {
    const opt = (sel, list) => list.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");
    ctrl(`<label>まとめ方 <select id="ag-by">${opt("band", [["band", "時間帯 × アイコン"], ["exact", "同じ調理時間 × アイコン"]])}</select></label>
      <label>足りない食材 <select id="ag-x">${opt("5", [["2", "0〜2個"], ["3", "0〜3個"], ["5", "0〜5個(今の検索ページ)"]])}</select></label>
      <label><input type="checkbox" id="ag-other" checked> 2品以下のアイコンは「ほか」にまとめる</label>`);
    const draw = () => {
      const band = $("ag-by").value === "band", xmax = +$("ag-x").value, input = state.have.length > 0, other = $("ag-other").checked;
      const svg = setup(), g = svg.append("g");
      const cols = d3.range(xmax + 1);
      const x = d3.scaleBand(cols, [M.l, W - M.r]), colW = x.bandwidth();
      const pool = state.recipes.filter(r => r._missing <= xmax);
      // 段(縦): 時間帯、または調理時間の値ごと。下ほど短い
      const tOf = r => Math.min(r.time_min, 120);
      const rowsOf = band ? TIME_BANDS.map((b, i) => i) : state.times;
      const rowOf = band ? (r => TIME_BANDS.findIndex(([a, b]) => r.time_min > a && r.time_min <= b)) : tOf;
      const rowLabel = v => (band ? (TIME_BANDS[v][1] > 120 ? `${TIME_BANDS[v][0]}分〜` : `〜${TIME_BANDS[v][1]}分`) : `${v}分`);
      const y = d3.scaleBand(rowsOf, [H - M.b, M.t]).paddingInner(0.06);
      // まとめる: 列 × 段 × アイコン
      let raw = d3.groups(pool, r => `${r._missing}|${rowOf(r)}|${r.emoji || "🍽️"}`);
      if (other) {   // マスごとに、2品以下のアイコンを「ほか」の丸1つにまとめる
        const small = raw.filter(([, rs]) => rs.length <= 2);
        raw = raw.filter(([, rs]) => rs.length > 2).concat(d3.groups(small.flatMap(([, rs]) => rs), r => `${r._missing}|${rowOf(r)}|ほか`));
      }
      const groups = raw.map(([key, rs]) => {
        const [m, t, emoji] = key.split("|");
        return { key, m: +m, t: +t, emoji, rs, r: Math.sqrt(rs.length),
                 best: d3.max(rs, r => r._match), style: d3.greatest(d3.rollups(rs, v => v.length, r => r.style), d => d[1])[0] };
      });
      // マスごとに、品数の多い丸から左→右に並べ、入りきらなければ次の段へ折り返す。
      // 丸の縮尺 k は全部のマスで同じにし、全部のマスに収まるいちばん大きな値を二分探索で探す
      const cellW = x.bandwidth(), cellH = y.bandwidth(), pad = 4, gap = 2;
      const cells = d3.groups(groups, d => `${d.m}|${d.t}`).map(([, list]) => list.sort((a, b) => b.r - a.r));
      const flow = (list, k) => {   // -> 置いた位置(マスの左上が原点)と、使った高さ。幅に1つも入らなければ null
        const rows = [];
        let row = { items: [], w: 0, h: 0 };
        for (const d of list) {
          const dia = 2 * d.r * k;
          if (dia > cellW - 2 * pad) return null;
          if (row.items.length && row.w + gap + dia > cellW - 2 * pad) { rows.push(row); row = { items: [], w: 0, h: 0 }; }
          row.items.push({ d, dia }); row.w += (row.items.length > 1 ? gap : 0) + dia; row.h = Math.max(row.h, dia);
        }
        rows.push(row);
        return { rows, h: d3.sum(rows, r => r.h) + gap * (rows.length - 1) };
      };
      const fits = k => cells.every(list => { const f = flow(list, k); return f && f.h <= cellH - 2 * pad; });
      let lo = 0.5, hi = 40;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      const k = lo, nodes = [];
      for (const list of cells) {
        const f = flow(list, k), x0 = x(list[0].m), y0 = y(list[0].t) + (cellH - f.h) / 2;
        let yy = y0;
        for (const row of f.rows) {
          let xx = x0 + (cellW - row.w) / 2;
          for (const it of row.items) { nodes.push({ ...it.d, x: xx + it.dia / 2, y: yy + row.h / 2, rad: it.dia / 2 }); xx += it.dia + gap; }
          yy += row.h + gap;
        }
      }

      // 背景・軸(「今すぐ作れる」の列と、段のしま模様)
      g.append("rect").attr("x", x(0)).attr("y", M.t).attr("width", colW).attr("height", H - M.b - M.t).attr("fill", "#eef7f1");
      g.append("g").selectAll("rect").data(rowsOf.filter((v, i) => i % 2)).join("rect")
        .attr("x", M.l).attr("width", W - M.r - M.l).attr("y", v => y(v)).attr("height", cellH).attr("fill", "#000").attr("fill-opacity", 0.025);
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).tickFormat(v => (v === 0 ? "0個(今すぐ)" : `${v}個`)));
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).tickFormat(rowLabel));
      g.append("text").attr("x", W - M.r).attr("y", H - 6).attr("text-anchor", "end").text("足りない食材の数");
      g.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text("調理時間");
      const node = g.append("g").selectAll("g").data(nodes).join("g").attr("class", "dot")
        .attr("transform", d => `translate(${d.x},${d.y})`).style("cursor", "pointer")
        .on("mousemove", (e, d) => tipOn(e, `<b>${d.emoji} ${d.rs.length}品</b>(足りない食材 ${d.m}個・${rowLabel(d.t)})<br>`
          + d.rs.slice().sort((a, b) => b._match - a._match).slice(0, 5).map(r => esc(r.name)).join("<br>") + (d.rs.length > 5 ? "<br>…" : "")))
        .on("mouseleave", tipOff)
        .on("click", (e, d) => { e.stopPropagation(); showList(`${d.emoji} 足りない食材${d.m}個・${rowLabel(d.t)}の料理`, d.rs); });
      // 縁の色 = 中でいちばん多い系統(今の検索ページと同じ考え方)。食材を入れているときは、マッチ度が高い丸ほど濃く
      node.append("circle").attr("r", d => d.rad).attr("fill", d => (d.emoji === "ほか" ? "#f1ebe4" : "#fff"))
        .attr("stroke", d => (d.emoji === "ほか" ? "#b8aea3" : styleColor(d.style))).attr("stroke-width", d => (d.emoji === "ほか" ? 1.2 : 2.5))
        .attr("opacity", d => (input ? 0.45 + 0.55 * Math.min(1, d.best / 0.7) : 1));
      node.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("font-size", d => `${Math.max(7, Math.round(d.rad * 1.05))}px`).text(d => (d.emoji === "ほか" ? "…" : d.emoji));
      const badge = node.filter(d => d.rs.length > 1 && d.rad >= 9).append("g").attr("transform", d => `translate(${d.rad * 0.72},${d.rad * 0.72})`);
      badge.append("rect").attr("x", -9).attr("y", -7).attr("width", 18).attr("height", 14).attr("rx", 7).attr("fill", "#2b2620");
      badge.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("font-size", "9px").style("font-weight", 700).style("fill", "#fff")
        .text(d => (d.rs.length > 99 ? "99+" : d.rs.length));

      styleLegend(`<span>丸 ${nodes.length}個にまとめた(料理 ${pool.length}品)。丸の面積と数字 = 品数(全部のマスで同じ縮尺)、縁の色 = 中でいちばん多い系統${input ? "、濃い丸ほどマッチ度の高い料理を含む" : ""}。丸はマスの中に並べているので、マスの外にはずれません${other ? "。灰色の「…」は、2品以下のアイコンをまとめた「ほか」" : ""}</span><br>`);
      showList(input ? `マッチ度の高い順(${xmax}個以下の全${pool.length}品)` : `足りない食材${xmax}個以下の全${pool.length}品`, pool);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 9. 棒グラフ(マッチ度の順に並べ、棒の高さ = 調理時間) ----------
  const MISS_COLORS = ["#2e9d6f", "#e7b416", "#e5793a", "#c0392b"];   // 買い足し 0 / 1 / 2 / 3個以上(tree-playground と同じ)
  function viewBars() {
    ctrl(`<label>並べる数 <input type="range" id="bn" min="10" max="80" step="5" value="30"> <span id="bn-v">30</span>品</label>
      <label><input type="radio" name="bc" value="miss" checked> 色 = 買い足しの数</label>
      <label><input type="radio" name="bc" value="style"> 色 = 系統</label>`);
    const draw = () => {
      $("bn-v").textContent = $("bn").value;
      const n = +$("bn").value, byStyle = document.querySelector('input[name="bc"]:checked').value === "style";
      const input = state.have.length > 0;
      // マッチ度が同じなら、調理時間の短い順(食材を入れていないときは、定番を時間の短い順)
      const list = (input ? state.recipes : staples()).slice()
        .sort((a, b) => b._match - a._match || a.time_min - b.time_min).slice(0, n);
      const mb = 118;   // 料理名を斜めに書く分の下の余白
      const w0 = Math.max(320, $("chart").clientWidth || 800);
      const svg = setup(Math.max(460, Math.min(620, w0 * 0.5)) + mb - M.b), g = svg.append("g");
      const x = d3.scaleBand(list.map(r => r.id), [M.l + 30, W - M.r]).padding(0.12);   // 左端の料理名が切れないよう少し空ける
      const y = d3.scaleLinear([0, Math.max(30, d3.max(list, r => Math.min(r.time_min, 120)))], [H - mb, M.t + 16]).nice();
      g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(6).slice(1)).join("line")
        .attr("x1", M.l).attr("x2", W - M.r).attr("y1", y).attr("y2", y);
      const fill = r => (byStyle ? styleColor(r.style) : MISS_COLORS[Math.min(r._missing, 3)]);
      g.append("g").selectAll("rect").data(list).join("rect").attr("class", "dot")
        .attr("x", r => x(r.id)).attr("width", x.bandwidth())
        .attr("y", r => y(Math.min(r.time_min, 120))).attr("height", r => y(0) - y(Math.min(r.time_min, 120))).attr("fill", fill)
        .on("mousemove", (e, r) => tipOn(e, recipeTip(r))).on("mouseleave", tipOff)
        .on("click", (e, r) => { e.stopPropagation(); showList(r.name, [r]); });
      // マッチ度が変わるところに縦の点線(同じマッチ度の中は時間の短い順なので、ここで高さがリセットされる)
      g.append("g").selectAll("line").data(list.filter((r, i) => i && pct(r._match) !== pct(list[i - 1]._match))).join("line")
        .attr("x1", r => x(r.id) - x.step() * x.padding() / 2).attr("x2", r => x(r.id) - x.step() * x.padding() / 2)
        .attr("y1", M.t + 16).attr("y2", H - mb).attr("stroke", "#b8aea3").attr("stroke-dasharray", "3 3");
      // 棒の上にマッチ度(同じ値が続くときは、変わったところだけ)
      if (input) g.append("g").selectAll("text").data(list.filter((r, i) => !i || pct(r._match) !== pct(list[i - 1]._match))).join("text")
        .attr("x", r => x(r.id) + x.bandwidth() / 2).attr("y", r => y(Math.min(r.time_min, 120)) - 4).attr("text-anchor", "middle")
        .style("font-size", "10px").style("fill", "#1f6e4d").style("font-weight", 700).text(r => pct(r._match));
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v => `${v}分`));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mb})`).call(d3.axisBottom(x).tickSize(3).tickFormat(""));
      const fs = Math.max(9, Math.min(11, x.step() * 0.75));
      g.append("g").selectAll("text").data(list).join("text")
        .attr("transform", r => `translate(${x(r.id) + x.bandwidth() / 2},${H - mb + 8}) rotate(-55)`).attr("text-anchor", "end").attr("dy", "0.35em")
        .style("font-size", `${fs}px`).text(r => (r.name.length > 11 ? r.name.slice(0, 10) + "…" : r.name));
      g.append("text").attr("x", M.l - 50).attr("y", M.t + 4).text("↑ 調理時間");
      g.append("text").attr("x", W - M.r).attr("y", M.t + 4).attr("text-anchor", "end").style("fill", "#7a7168")
        .text(input ? "← マッチ度が高い　　マッチ度が低い →" : "定番(「基本の〜」)を調理時間の短い順");
      $("legend").innerHTML = (byStyle ? STYLES.map(s => `<span><i style="background:${styleColor(s)}"></i>${s}</span>`)
        : ["買い足しなし", "1個", "2個", "3個以上"].map((t, i) => `<span><i style="background:${MISS_COLORS[i]}"></i>${t}</span>`)).join("")
        + `<span>棒の上の数字 = マッチ度(変わったところだけ)。120分より長い料理は120分で切っています</span>`;
      showList(input ? `マッチ度の高い上位${list.length}品` : `定番(時間の短い順に${list.length}品)`, list);
    };
    $("view-ctrl").oninput = draw;
    draw();
  }

  // ---------- 新しい見せ方: 共通 ----------
  const askHave = (svg, text = "上の「今ある食材」を入れると、この図が出ます") => {
    svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").style("font-size", "13px").style("fill", "#7a7168").text(text);
    $("legend").innerHTML = "";
  };
  const missLegend = (extra = "") => ["買い足しなし", "1個", "2個", "3個以上"]
    .map((t, i) => `<span><i style="background:${MISS_COLORS[i]}"></i>${t}</span>`).join("") + (extra ? `<span>${extra}</span>` : "");

  // ---------- 10. 時計の文字盤 ----------
  // 角度 = 調理時間(12時が0分、時計回り。時間はとびとびなので順番だけの目盛り)、中心からの距離 = 1 − マッチ度。
  // 真ん中に近いほど手持ちの食材に合い、12時に近いほど早く作れる
  function viewClock() {
    ctrl(`<label>アイコンにする数 <input type="range" id="ck-n" min="20" max="80" step="5" value="40"> <span id="ck-n-v">40</span>品</label>
      <label><input type="checkbox" id="ck-names" checked> 名前を出す</label>`);
    const draw = () => {
      $("ck-n-v").textContent = $("ck-n").value;
      const input = state.have.length > 0, n = +$("ck-n").value;
      const w0 = Math.max(320, $("chart").clientWidth || 800);
      const svg = setup(Math.round(Math.min(720, Math.max(420, w0 * 0.72)))), g = svg.append("g");
      const cx = W / 2, cy = H / 2, R0 = Math.min(W, H) / 2 - 40, Rin = 16, Ri = W < 600 ? 10 : 13;
      const T = [...new Set(state.times.map(t => Math.min(t, 60)))];   // 60分より長い料理は最後の1つにまとめる
      const angOf = t => (T.indexOf(Math.min(t, 60)) + 0.5) / T.length * 2 * Math.PI;
      // 食材を入れていないときは、材料の少ない定番ほど真ん中に置く
      const score = r => (input ? r._match : 1 - Math.min(r.ingredients.length, 12) / 12);
      const list = (input ? state.recipes : staples()).slice()
        .sort((a, b) => score(b) - score(a) || a.time_min - b.time_min).slice(0, n);
      // 中心からの距離は、出している料理のマッチ度の範囲に合わせる(上位だけだと内側に固まるため)。目盛りの数字も合わせる
      const lo = Math.max(0, Math.floor((d3.min(list, score) ?? 0) * 10) / 10 - 0.05), hi = Math.min(1, Math.ceil((d3.max(list, score) ?? 1) * 10) / 10);
      const rs = d3.scaleLinear([hi, lo], [Rin, R0]).clamp(true);
      const radOf = r => rs(score(r));

      // お皿と目盛り(マッチ度の同心円・時間の区切りの放射線)
      g.append("circle").attr("cx", cx).attr("cy", cy).attr("r", R0 + 8).attr("fill", "#fff").attr("stroke", "#e7ddd2").attr("stroke-width", 6);
      for (const m of d3.range(3).map(i => lo + (hi - lo) * (i + 1) / 4)) {
        const rr = rs(m);
        g.append("circle").attr("cx", cx).attr("cy", cy).attr("r", rr).attr("fill", "none").attr("stroke", "#efe6dc").attr("stroke-dasharray", "3 3");
        if (input) g.append("text").attr("x", cx + 3).attr("y", cy - rr - 3).style("font-size", "10px").style("fill", "#a2978c").text(`マッチ度${pct(m)}`);
      }
      T.forEach((t, i) => {
        const a0 = i / T.length * 2 * Math.PI, a = (i + 0.5) / T.length * 2 * Math.PI;
        g.append("line").attr("x1", cx + Rin * Math.sin(a0)).attr("y1", cy - Rin * Math.cos(a0))
          .attr("x2", cx + R0 * Math.sin(a0)).attr("y2", cy - R0 * Math.cos(a0)).attr("stroke", "#f3ece4");
        const last = i === T.length - 1 && state.times.some(x => x > 60);
        g.append("text").attr("x", cx + (R0 + 24) * Math.sin(a)).attr("y", cy - (R0 + 24) * Math.cos(a) + 4).attr("text-anchor", "middle")
          .style("font-weight", 700).style("fill", "#ad4315").text(last ? `${t}分+` : `${t}分`);
      });

      // アイコン。目標の位置に引き寄せながら、重ならないように少しだけ押し合わせる
      const nodes = list.map(r => {
        const a = angOf(r.time_min), rr = radOf(r);
        const tx = cx + rr * Math.sin(a), ty = cy - rr * Math.cos(a);
        return { r, tx, ty, x: tx, y: ty };
      });
      const sim = d3.forceSimulation(nodes).randomSource(d3.randomLcg(7)).stop()
        .force("x", d3.forceX(d => d.tx).strength(0.5)).force("y", d3.forceY(d => d.ty).strength(0.5))
        .force("collide", d3.forceCollide(Ri + 1.5));
      for (let i = 0; i < 200; i++) sim.tick();
      const icon = g.append("g").selectAll("g").data(nodes).join("g").attr("class", "dot")
        .attr("transform", d => `translate(${d.x},${d.y})`).style("cursor", "pointer")
        .on("mousemove", (e, d) => tipOn(e, recipeTip(d.r))).on("mouseleave", tipOff)
        .on("click", (e, d) => { e.stopPropagation(); showList(d.r.name, [d.r]); });
      icon.append("circle").attr("r", Ri).attr("fill", "#fff").attr("stroke-width", 2.5)
        .attr("stroke", d => (input ? MISS_COLORS[Math.min(d.r._missing, 3)] : styleColor(d.r.style)));
      icon.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("font-size", `${Math.round(Ri * 1.15)}px`).text(d => d.r.emoji || "🍽️");
      if ($("ck-names").checked) placeLabels(g, nodes.map(d => ({ x: d.x, y: d.y, text: d.r.name })), 2, W - 2);

      if (input) $("legend").innerHTML = missLegend("(アイコンの縁の色)真ん中に近いほど手持ちの食材に合い、12時に近いほど早く作れます");
      else styleLegend(`<span>食材が未入力なので、定番(「基本の〜」)を、材料が少ないほど真ん中に置いています。縁の色 = 系統</span>`);
      showList(input ? `マッチ度の高い上位${list.length}品` : `定番(材料の少ない順に${list.length}品)`, list);
    };
    $("view-ctrl").oninput = draw;
    draw();
  }

  // ---------- 11. 買い足しの階段 ----------
  // 今ある食材だけで作れる料理の数から始め、1つ買い足すごとに作れる料理が一番増える食材を選んでいく(貪欲法)
  function viewStairs() {
    const opt = (sel, list) => list.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");
    ctrl(`<label>調理時間 <select id="st-t">${opt("999", [["15", "15分以内"], ["30", "30分以内"], ["60", "60分以内"], ["999", "制限なし"]])}</select></label>
      <label><input type="checkbox" id="st-all"> 手持ちの食材を1つも使わない料理も数える</label>`);
    const draw = () => {
      const svg = setup(), g = svg.append("g");
      if (!state.have.length) return askHave(svg);
      const maxT = +$("st-t").value;
      const all = $("st-all").checked;
      const pool = state.recipes.filter(r => r.time_min <= maxT && (all || r._usedHave.length)).map(r => ({ r, need: [...new Set(r._missingNames)] }));
      const bought = new Set(), made = new Set();
      const newlyMade = () => pool.filter(p => !made.has(p.r) && p.need.every(n => bought.has(n))).map(p => p.r);
      const first = newlyMade(); first.forEach(r => made.add(r));
      const steps = [{ buy: null, total: made.size, added: first }];
      for (let k = 0; k < 8; k++) {
        const gain = new Map(), near = new Map();
        for (const p of pool) {
          if (made.has(p.r)) continue;
          const rest = p.need.filter(n => !bought.has(n));
          if (rest.length === 1) gain.set(rest[0], (gain.get(rest[0]) || 0) + 1);
          if (rest.length <= 3) for (const n of rest) near.set(n, (near.get(n) || 0) + 1 / rest.length);
        }
        const byVal = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja");
        // どれを買っても1品も増えないときは、あと少しで作れる料理に多く出てくる食材を選ぶ(先を見て選ぶ)
        const best = [...gain].sort(byVal)[0] || [...near].sort(byVal)[0];
        if (!best) break;
        bought.add(best[0]);
        const added = newlyMade(); added.forEach(r => made.add(r));
        steps.push({ buy: best[0], total: made.size, added });
      }

      const x = d3.scaleBand(d3.range(steps.length), [M.l, W - M.r]).padding(0.18);
      const y = d3.scaleLinear([0, d3.max(steps, s => s.total) || 1], [H - M.b - 22, M.t + 26]).nice();
      g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5).slice(1)).join("line")
        .attr("x1", M.l).attr("x2", W - M.r).attr("y1", y).attr("y2", y);
      const col = g.append("g").selectAll("g").data(steps).join("g").style("cursor", "pointer")
        .on("click", (e, s) => showList(s.buy ? `${s.buy}を買うと新しく作れる料理` : "今ある食材だけで作れる料理", s.added))
        .on("mousemove", (e, s) => tipOn(e, s.buy ? `<b>${esc(s.buy)}</b>を買うと +${s.added.length}品(合計 ${s.total}品)` : `今ある食材だけで ${s.total}品`)).on("mouseleave", tipOff);
      // 前の段までの分(薄い色)と、この段で増えた分(濃い色)
      col.append("rect").attr("x", (s, i) => x(i)).attr("width", x.bandwidth()).attr("rx", 3)
        .attr("y", s => y(s.total - s.added.length)).attr("height", s => y(0) - y(s.total - s.added.length)).attr("fill", "#e9e1d8");
      col.append("rect").attr("x", (s, i) => x(i)).attr("width", x.bandwidth()).attr("rx", 3)
        .attr("y", s => y(s.total)).attr("height", s => y(s.total - s.added.length) - y(s.total)).attr("fill", (s, i) => (i ? "#e5793a" : MISS_COLORS[0]));
      col.append("text").attr("x", (s, i) => x(i) + x.bandwidth() / 2).attr("y", s => y(s.total) - 6).attr("text-anchor", "middle")
        .style("font-weight", 700).style("fill", (s, i) => (i ? "#c2410c" : "#1f6e4d")).text((s, i) => (i ? `+${s.added.length}品` : `${s.total}品`));
      // 段の上をつなぐ階段の線(最後の段の右端まで)
      const stairPts = steps.map((s, i) => [x(i), y(s.total)]).concat([[x(steps.length - 1) + x.bandwidth(), y(steps[steps.length - 1].total)]]);
      g.append("path").attr("fill", "none").attr("stroke", "#2b2620").attr("stroke-width", 1.5)
        .attr("d", d3.line().curve(d3.curveStepAfter)(stairPts));
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(v => `${v}品`));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b - 22})`).call(d3.axisBottom(x).tickSize(0).tickFormat(i => (i ? `${i}個目` : "今ある食材")));
      g.append("g").selectAll("text").data(steps).join("text").attr("x", (s, i) => x(i) + x.bandwidth() / 2).attr("y", H - M.b + 14)
        .attr("text-anchor", "middle").style("font-weight", 700).style("font-size", "12px").text(s => s.buy || "だけ");
      g.append("text").attr("x", M.l - 50).attr("y", M.t + 8).text("↑ 作れる料理の数(合計)");
      $("legend").innerHTML = `<span><i style="background:${MISS_COLORS[0]}"></i>今ある食材だけで作れる</span><span><i style="background:#e5793a"></i>その食材を買って新しく作れる</span>`
        + `<span>買う順番は、1つ買うごとに作れる料理が一番増える食材です。どれを買っても増えない段は、あと少しで作れる料理に多く出てくる食材を選んでいます。段をクリックすると、増えた料理が右に出ます</span>`;
      showList(`${steps.length - 1}個買い足すと作れる料理(全${made.size}品)`, [...made]);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 12. 組み合わせ表(UpSet) ----------
  // 手持ちの食材の「どれとどれを一緒に使う料理」が何品あるかを、棒(上)と点と線の表(下)で見せる
  function viewUpset() {
    const opt = (sel, list) => list.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");
    ctrl(`<label>買い足し <select id="up-m">${opt("2", [["0", "0個(今すぐ作れる)"], ["1", "1個まで"], ["2", "2個まで"], ["3", "3個まで"], ["99", "制限なし"]])}</select></label>`);
    const draw = () => {
      const have = state.have, rowH = 26;
      const svg = setup(Math.max(420, 300 + have.length * rowH)), g = svg.append("g");
      if (!have.length) return askHave(svg);
      const maxM = +$("up-m").value;
      const pool = state.recipes.filter(r => r._usedHave.length && r._missing <= maxM);
      // ちょうど同じ組み合わせの手持ちを使う料理ごとにまとめる(入力した順に並べた名前でまとめる)
      const groups = d3.groups(pool, r => have.filter(h => r._usedHave.includes(h)).join("+"))
        .map(([key, rs]) => ({ key, sets: key.split("+"), rs, by: [0, 1, 2, 3].map(k => rs.filter(r => Math.min(r._missing, 3) === k).length) }))
        .sort((a, b) => b.rs.length - a.rs.length || b.sets.length - a.sets.length).slice(0, 15);
      const LW = 150, mTop = H - M.b - have.length * rowH;   // 左の欄の幅・表の上端
      const x = d3.scaleBand(groups.map(c => c.key), [M.l + LW, W - M.r]).padding(0.25);
      const y = d3.scaleLinear([0, d3.max(groups, c => c.rs.length) || 1], [mTop - 14, M.t + 22]).nice();
      const rowY = i => mTop + i * rowH + rowH / 2;
      // 表のしま模様と、左の欄(食材ごとの合計の棒と名前)
      g.append("g").selectAll("rect").data(have).join("rect").attr("x", M.l).attr("width", W - M.r - M.l)
        .attr("y", (h, i) => mTop + i * rowH).attr("height", rowH).attr("fill", (h, i) => (i % 2 ? "#fff" : "#faf5ef"));
      const totals = have.map(h => pool.filter(r => r._usedHave.includes(h)).length);
      const tb = d3.scaleLinear([0, d3.max(totals) || 1], [0, 56]);
      g.append("g").selectAll("rect").data(have).join("rect").attr("x", (h, i) => M.l + 56 - tb(totals[i])).attr("width", (h, i) => tb(totals[i]))
        .attr("y", (h, i) => rowY(i) - 6).attr("height", 12).attr("fill", "#cdbfb1")
        .on("mousemove", (e, h) => tipOn(e, `${esc(h)}を使う料理 ${totals[have.indexOf(h)]}品`)).on("mouseleave", tipOff);
      g.append("g").selectAll("text").data(have).join("text").attr("x", M.l + 62).attr("y", (h, i) => rowY(i) + 4)
        .style("font-weight", 700).text(h => (h.length > 7 ? h.slice(0, 6) + "…" : h));
      // 上の棒(買い足しの数で積み上げ)
      const colG = g.append("g").selectAll("g").data(groups).join("g").style("cursor", "pointer")
        .on("click", (e, c) => showList(`${c.sets.join("・")}を使う料理${c.sets.length < have.length ? `(ほかの手持ちは使わない)` : ""}`, c.rs))
        .on("mousemove", (e, c) => tipOn(e, `<b>${esc(c.sets.join(" + "))}</b><br>${c.rs.length}品(今すぐ ${c.by[0]}・買い足し1個 ${c.by[1]}・2個 ${c.by[2]}・3個以上 ${c.by[3]})`))
        .on("mouseleave", tipOff);
      colG.each(function (c) {
        let acc = 0;
        for (let k = 0; k < 4; k++) {
          if (!c.by[k]) continue;
          d3.select(this).append("rect").attr("x", x(c.key)).attr("width", x.bandwidth())
            .attr("y", y(acc + c.by[k])).attr("height", y(acc) - y(acc + c.by[k])).attr("fill", MISS_COLORS[k]);
          acc += c.by[k];
        }
      });
      colG.append("text").attr("x", c => x(c.key) + x.bandwidth() / 2).attr("y", c => y(c.rs.length) - 5).attr("text-anchor", "middle")
        .style("font-weight", 700).text(c => c.rs.length);
      // 下の表: 使う食材は塗った丸を縦線で結び、使わない食材は薄い丸
      colG.append("line").attr("x1", c => x(c.key) + x.bandwidth() / 2).attr("x2", c => x(c.key) + x.bandwidth() / 2)
        .attr("y1", c => rowY(have.indexOf(c.sets[0]))).attr("y2", c => rowY(have.indexOf(c.sets[c.sets.length - 1])))
        .attr("stroke", "#2b2620").attr("stroke-width", 2.5);
      colG.each(function (c) {
        d3.select(this).selectAll("circle").data(have).join("circle").attr("cx", x(c.key) + x.bandwidth() / 2).attr("cy", (h, i) => rowY(i))
          .attr("r", Math.min(7, x.bandwidth() / 2)).attr("fill", h => (c.sets.includes(h) ? "#2b2620" : "#e7ddd2"));
      });
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l + LW - 8},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(v => `${v}品`));
      g.append("text").attr("x", M.l + LW - 8).attr("y", M.t + 8).text("↑ ちょうどこの組み合わせの手持ちを使う料理の数");
      $("legend").innerHTML = missLegend(`(棒の色 = 買い足しの数)下の表の黒い丸が、その列の料理が使う手持ちの食材です。料理の多い組み合わせ${groups.length}列を表示。列をクリックすると料理が右に出ます`);
      showList(groups.length ? `${groups[0].sets.join("・")}を使う料理` : "該当なし", groups.length ? groups[0].rs : []);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 1. マス目のヒートマップ ----------
  function viewHeat() {
    ctrl(`<label><input type="radio" name="hc" value="count" checked> 色 = レシピの数</label>
      <label><input type="radio" name="hc" value="ready"> 色 = 買い足し1個以内で作れる数</label>`);
    const mode = () => document.querySelector('input[name="hc"]:checked').value;
    const draw = () => {
      const svg = setup();
      const yb = AX[state.ykey].bins || [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, Infinity];
      const x = d3.scaleBand(TIME_BINS.map(b => b[1]), [M.l, W - M.r]).padding(0.04);
      const y = d3.scaleBand(yb.slice(0, -1), [H - M.b, M.t]).padding(0.04);
      const yv = r => AX[state.ykey].get(r), tv = r => AX.time.get(r);
      const cells = [];
      for (const tb of TIME_BINS) for (let k = 0; k < yb.length - 1; k++) {
        const rs = state.recipes.filter(r => tv(r) > tb[0] && tv(r) <= tb[1] && yv(r) >= yb[k] && yv(r) < yb[k + 1]);
        cells.push({ tb, k, rs, ready: rs.filter(r => r._missing <= 1).length });
      }
      const val = c => (mode() === "count" ? c.rs.length : c.ready);
      const color = d3.scaleSequentialSqrt([0, d3.max(cells, val) || 1], mode() === "count" ? d3.interpolateOranges : d3.interpolateGreens);
      const label = k => (yb[k + 1] === Infinity ? `${yb[k]}${AX[state.ykey].unit}以上` : `${yb[k]}〜${yb[k + 1]}${AX[state.ykey].unit}`);
      const g = svg.append("g");
      g.selectAll("rect").data(cells).join("rect").attr("class", "cell")
        .attr("x", c => x(c.tb[1])).attr("y", c => y(yb[c.k])).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 4)
        .attr("fill", c => (val(c) ? color(val(c)) : "#f7f2ec"))
        .on("click", (e, c) => { g.selectAll(".cell").classed("sel", d => d === c); showList(`${c.tb[1]}分以内・${label(c.k)}`, c.rs); })
        .on("mousemove", (e, c) => tipOn(e, `${c.tb[0]}〜${c.tb[1]}分・${label(c.k)}<br>${c.rs.length}品(買い足し1個以内 ${c.ready}品)`)).on("mouseleave", tipOff);
      g.selectAll("text.n").data(cells.filter(c => val(c))).join("text").attr("class", "n").attr("text-anchor", "middle")
        .attr("x", c => x(c.tb[1]) + x.bandwidth() / 2).attr("y", c => y(yb[c.k]) + y.bandwidth() / 2 + 4)
        .style("pointer-events", "none").style("font-weight", 700)
        .style("fill", c => (val(c) > color.domain()[1] * 0.45 ? "#fff" : "#4a423c")).text(val);
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).tickFormat(d => `〜${d}分`));
      g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).tickFormat((d, i) => (yb[i + 1] === Infinity ? `${d}+` : d)));
      g.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text(AX[state.ykey].label);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 2. 六角形ビン・等高線(参考: このデータには不向き) ----------
  function viewHex() {
    ctrl(`<label><input type="radio" name="hx" value="hex" checked> 六角形ビン</label><label><input type="radio" name="hx" value="contour"> 等高線(密度)</label>
      <label>六角形の大きさ <input type="range" id="hexr" min="8" max="26" value="14"></label>`);
    const draw = () => {
      const svg = setup(), g = svg.append("g");
      const { X, Yc } = basic(svg, g);
      const pts = state.recipes.map(r => [posOf(X, r), posOf(Yc, r), r]);
      if (document.querySelector('input[name="hx"]:checked').value === "hex") {
        const R = +$("hexr").value, w = Math.sqrt(3) * R, hgt = 1.5 * R, bins = new Map();
        for (const p of pts) {
          const row = Math.round(p[1] / hgt), col = Math.round((p[0] - (row & 1 ? w / 2 : 0)) / w);
          let best = null, bd = Infinity;
          for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) {
            const rr = row + dr, cc = col + dc, cx = cc * w + (rr & 1 ? w / 2 : 0), cy = rr * hgt, dd = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
            if (dd < bd) { bd = dd; best = [rr, cc, cx, cy]; }
          }
          const k = best[0] + ":" + best[1];
          if (!bins.has(k)) bins.set(k, { cx: best[2], cy: best[3], rs: [] });
          bins.get(k).rs.push(p[2]);
        }
        const list = [...bins.values()];
        const color = d3.scaleSequentialSqrt([0, d3.max(list, b => b.rs.length)], d3.interpolateOranges);
        const hex = d3.range(6).map(i => [R * Math.cos(Math.PI / 6 + i * Math.PI / 3), R * Math.sin(Math.PI / 6 + i * Math.PI / 3)]);
        g.selectAll("path.hex").data(list).join("path").attr("class", "hex").attr("d", "M" + hex.join("L") + "Z")
          .attr("transform", b => `translate(${b.cx},${b.cy})`).attr("fill", b => color(b.rs.length)).attr("stroke", "#fff")
          .on("click", (e, b) => { g.selectAll(".hex").classed("sel", d => d === b); showList("この六角形のレシピ", b.rs); })
          .on("mousemove", (e, b) => tipOn(e, `${b.rs.length}品`)).on("mouseleave", tipOff);
        $("legend").innerHTML = `<span>時間がとびとびなので、六角形が縦の縞になり、間の六角形(レシピのない時間)が空く</span>`;
      } else {
        const dens = d3.contourDensity().x(p => p[0]).y(p => p[1]).size([W, H]).bandwidth(14).thresholds(14)(pts);
        const color = d3.scaleSequential([0, d3.max(dens, d => d.value)], d3.interpolateOranges);
        g.append("g").selectAll("path").data(dens).join("path").attr("d", d3.geoPath()).attr("fill", d => color(d.value)).attr("fill-opacity", 0.8)
          .attr("stroke", "#c76a2c").attr("stroke-opacity", 0.25);
        svg.on("click", e => {
          const [mx, my] = d3.pointer(e);
          showList("クリックした場所の近く(半径20px)", pts.filter(p => (p[0] - mx) ** 2 + (p[1] - my) ** 2 < 400).map(p => p[2]));
        });
        $("legend").innerHTML = `<span>なめらかにするので、実際にはレシピがない時間(たとえば25分や75分)にも山や裾野ができてしまう。時間の軸を「ふつう」にすると特にわかりやすい</span>`;
      }
    };
    $("view-ctrl").onchange = draw; $("view-ctrl").oninput = draw;
    draw();
  }

  // ---------- 3. 背景(マス目)+ 前景(マッチ度の上位) ----------
  function viewFocus() {
    ctrl(`<label>前に出す数 <input type="range" id="topn" min="10" max="80" step="5" value="30"> <span id="topn-v">30</span>品</label>
      <label><input type="checkbox" id="fc-names" checked> 名前を出す</label>`);
    const draw = () => {
      $("topn-v").textContent = $("topn").value;
      const svg = setup(), g = svg.append("g");
      const { X, Yc } = basic(svg, g);
      gridBackground(g, X, Yc);
      const n = +$("topn").value, input = state.have.length > 0;
      // 食材を入れていないときは、定番(「基本の〜」)を前に出す
      const top = input
        ? state.recipes.slice().sort((a, b) => b._match - a._match || a.time_min - b.time_min).slice(0, n)
        : staples().sort((a, b) => a.ingredients.length - b.ingredients.length || a.time_min - b.time_min).slice(0, n);
      dotEvents(g.append("g").selectAll("circle").data(top).join("circle").attr("class", "dot")
        .attr("cx", r => posOf(X, r)).attr("cy", r => posOf(Yc, r)).attr("r", r => (input ? 4 + 6 * r._match : 6))
        .attr("fill", r => styleColor(r.style)).attr("stroke", "#fff").attr("stroke-width", 1.5));
      if ($("fc-names").checked) placeLabels(g, top.map(r => ({ x: posOf(X, r), y: posOf(Yc, r), text: r.name })));
      styleLegend(`<span>背景のマス = 全${state.recipes.length}品の数(濃いほど多い・クリックで中身)　点 = ${input ? `マッチ度の高い上位${top.length}品(大きいほど高い)` : `食材が未入力なので、定番(「基本の〜」${staples().length}品のうち材料の少ない${top.length}品)`}</span>`);
      showList(input ? `マッチ度の高い上位${top.length}品` : `定番(材料の少ない順に${top.length}品)`, top);
    };
    $("view-ctrl").oninput = draw;
    draw();
  }

  // ---------- 4. 拡大すると点が出てくる ----------
  function viewZoom() {
    ctrl(`<span class="small">ホイールで拡大、ドラッグで移動。引いているときはマス目、2倍以上で点、5倍以上で名前が出ます。</span> <button type="button" id="zr">元に戻す</button>`);
    const svg = setup();
    const X0 = makeScale("time", [M.l, W - M.r]), Y0 = makeScale(state.ykey, [H - M.b, M.t]);
    Y0.s.clamp(false);   // 拡大したとき、画面の外の点が端に張り付かないように
    svg.append("defs").append("clipPath").attr("id", "clip").append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b);
    const gAxis = svg.append("g"), gBody = svg.append("g").attr("clip-path", "url(#clip)");
    const zoomInfo = svg.append("text").attr("x", W - M.r).attr("y", M.t + 12).attr("text-anchor", "end").style("font-weight", 700);
    const render = t => {
      tipOff();
      const X = { ...X0, s: t.rescaleX(X0.s), jw: X0.jw * t.k }, Yc = { ...Y0, s: t.rescaleY(Y0.s), jw: Y0.jw * t.k };
      gAxis.selectAll("*").remove(); gBody.selectAll("*").remove();
      drawAxis(gAxis, Yc, "left", M.l, { grid: [M.l, W - M.r] });
      drawAxis(gAxis, X, "bottom", H - M.b);
      gAxis.append("text").attr("x", M.l - 50).attr("y", M.t - 6).text(AX[state.ykey].label);
      zoomInfo.text(`${t.k.toFixed(1)}倍`);
      if (t.k < 2) {
        const Yclamp = { ...Yc, s: Yc.s.copy().clamp(true) };
        gridBackground(gBody, X, Yclamp, "#fdebd9", "#c2410c");
      } else {
        const inView = r => { const a = posOf(X, r), b = posOf(Yc, r); return a >= M.l && a <= W - M.r && b >= M.t && b <= H - M.b; };
        const vis = state.recipes.filter(inView);
        dotEvents(gBody.selectAll("circle").data(vis).join("circle").attr("class", "dot").attr("cx", r => posOf(X, r)).attr("cy", r => posOf(Yc, r))
          .attr("r", Math.min(7, 2 + t.k * 0.4)).attr("fill", r => styleColor(r.style)).attr("fill-opacity", 0.75));
        if (t.k >= 5) placeLabels(gBody, vis.slice().sort((a, b) => b._match - a._match).slice(0, 120).map(r => ({ x: posOf(X, r), y: posOf(Yc, r), text: r.name })));
      }
    };
    const zoom = d3.zoom().scaleExtent([1, 30]).translateExtent([[M.l, M.t], [W - M.r, H - M.b]]).extent([[M.l, M.t], [W - M.r, H - M.b]])
      .on("zoom", e => render(e.transform));
    svg.call(zoom);
    $("zr").onclick = () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
    render(d3.zoomIdentity);
    styleLegend();
  }

  // ---------- 5. 損しない料理だけ(パレート最適) ----------
  function viewPareto() {
    ctrl(`<label>比べるもの <select id="pk"><option value="match">調理時間 と マッチ度</option><option value="y">調理時間 と 縦軸の値</option></select></label>
      <label>対象 <select id="pp"><option value="all">全部の料理</option><option value="ready" selected>買い足し1個以内で作れる料理</option></select></label>
      <label>線 <select id="pc"><option value="one">全体で1本</option><option value="cat" selected>分類(主食・主菜…)ごと</option></select></label>`);
    const draw = () => {
      const byMatch = $("pk").value === "match", perCat = $("pc").value === "cat";
      const yk = byMatch ? "match" : state.ykey;
      const svg = setup(), g = svg.append("g");
      const { X, Yc } = basic(svg, g, yk);
      const better = AX[yk].lowerBetter ? (a, b) => a < b : (a, b) => a > b;
      const yv = r => AX[yk].get(r), tv = r => AX.time.get(r);
      const pool = state.recipes.filter(r => $("pp").value === "all" || r._missing <= 1);
      // 時間が短い順に見て、縦の値がそれまでより良くなったものだけを残す
      // = 「もっと速くて、しかも縦の値も良い料理」がほかにない料理
      const frontOf = rs => {
        const sorted = rs.slice().sort((a, b) => tv(a) - tv(b) || (better(yv(a), yv(b)) ? -1 : better(yv(b), yv(a)) ? 1 : 0));
        const f = [];
        for (const r of sorted) if (!f.length || better(yv(r), yv(f[f.length - 1]))) { if (f.length && tv(f[f.length - 1]) === tv(r)) f.pop(); f.push(r); }
        return f;
      };
      const groups = perCat ? CATS.map(c => [c, frontOf(pool.filter(r => r.category === c))]) : [["全体", frontOf(pool)]];
      const inPool = new Set(pool);
      g.append("g").selectAll("circle").data(state.recipes).join("circle").attr("cx", r => posOf(X, r)).attr("cy", r => posOf(Yc, r)).attr("r", 2)
        .attr("fill", r => (inPool.has(r) ? "#d9c3ad" : "#efe8df"));
      const all = [];
      for (const [c, f] of groups) {
        if (!f.length) continue;
        const col = perCat ? catColor(c) : "#ad4315";
        g.append("path").datum(f).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2)
          .attr("d", d3.line().curve(d3.curveStepAfter).x(r => posOf(X, r, false)).y(r => posOf(Yc, r, false)));
        dotEvents(g.append("g").selectAll("circle").data(f).join("circle").attr("class", "dot").attr("cx", r => posOf(X, r, false)).attr("cy", r => posOf(Yc, r, false))
          .attr("r", 6).attr("fill", col).attr("stroke", "#fff").attr("stroke-width", 1.5));
        all.push(...f);
      }
      placeLabels(g, all.map(r => ({ x: posOf(X, r, false), y: posOf(Yc, r, false), text: r.name })));
      const what = byMatch ? "マッチ度も高い" : (AX[yk].lowerBetter ? `${AX[yk].label.replace(/\(.*/, "")}も小さい` : `${AX[yk].label.replace(/\(.*/, "")}も大きい`);
      $("legend").innerHTML = (perCat ? CATS.map(c => `<span><i style="background:${catColor(c)}"></i>${c}</span>`).join("") : "") +
        `<span>${$("pp").value === "all" ? "全部" : "買い足し1個以内で作れる"}${pool.length}品のうち、「もっと速くて、しかも${what}料理」がない${all.length}品${perCat ? "(分類ごと)" : ""}</span>`;
      showList(`損しない料理(${all.length}品)`, all);
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 6. 小さなグラフを並べる ----------
  function viewSmall() {
    ctrl(`<label>分け方 <select id="facet"><option value="category">分類(主食・主菜…)</option><option value="style">系統(和風・洋風…)</option></select></label>
      <label>色 <select id="sm-color"><option value="match">マッチ度</option><option value="style">系統</option></select></label>`);
    const draw = () => {
      const key = $("facet").value, keys = key === "category" ? CATS : STYLES;
      const full = Math.max(320, $("chart").clientWidth || 800), cols = full > 900 ? (keys.length > 5 ? 4 : 3) : 2;
      const cw = full / cols, ch = 210, svg = setup(Math.ceil(keys.length / cols) * ch + 10);
      keys.forEach((k, i) => {
        const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch, g = svg.append("g");
        const X = makeScale("time", [ox + 42, ox + cw - 10]), Yc = makeScale(state.ykey, [oy + ch - 26, oy + 22]);
        drawAxis(g, Yc, "left", ox + 42, { small: true, grid: [ox + 42, ox + cw - 10] });
        drawAxis(g, X, "bottom", oy + ch - 26, { small: true });
        const rs = state.recipes.filter(r => r[key] === k);
        g.append("text").attr("class", "facet-title").attr("x", ox + 42).attr("y", oy + 14).text(`${k}(${rs.length}品)`);
        dotEvents(g.append("g").selectAll("circle").data(rs.slice().sort((a, b) => a._match - b._match)).join("circle").attr("class", "dot")
          .attr("cx", r => posOf(X, r)).attr("cy", r => posOf(Yc, r)).attr("r", 2.2)
          .attr("fill", r => ($("sm-color").value === "match" ? matchColor(r._match) : styleColor(r.style))).attr("fill-opacity", 0.7));
      });
      if ($("sm-color").value === "match") $("legend").innerHTML = `<span><i style="background:${matchColor(0)}"></i>マッチ度 低い</span><span><i style="background:${matchColor(0.35)}"></i>中くらい</span><span><i style="background:${matchColor(0.7)}"></i>高い(濃い点は上に描いています)</span>`;
      else styleLegend();
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  // ---------- 7. 1つの値を系統ごとに見る(バイオリン図 + 箱ひげ + 代表の料理) ----------
  function viewViolin() {
    ctrl(`<label>横軸 <select id="vv"><option value="time">調理時間</option><option value="y">縦軸で選んだ値</option></select></label>
      <label>分け方 <select id="vfacet"><option value="style">系統(和風・洋風…)</option><option value="category">分類(主食・主菜…)</option></select></label>
      <label>点で出す料理 <select id="vn"><option value="3">各行3品</option><option value="6" selected>各行6品</option><option value="0">出さない</option></select></label>`);
    const draw = () => {
      const key = $("vfacet").value, keys = (key === "category" ? CATS : STYLES).filter(k => state.recipes.some(r => r[key] === k));
      const xk = $("vv").value === "time" ? "time" : state.ykey;
      const rowH = 66, svg = setup(keys.length * rowH + M.t + M.b), g = svg.append("g");
      const X = makeScale(xk, [M.l + 44, W - M.r]);
      drawAxis(g, X, "bottom", H - M.b, { grid: [M.t, H - M.b] });
      g.append("text").attr("x", W - M.r).attr("y", H - 6).attr("text-anchor", "end").text(AX[xk].label);
      const nShow = +$("vn").value, input = state.have.length > 0;
      keys.forEach((k, i) => {
        const cy = M.t + i * rowH + rowH / 2, rs = state.recipes.filter(r => r[key] === k);
        const ps = rs.map(r => posOf(X, r, false));   // 位置(px)で密度を出す(順番だけの軸でも形が合う)
        const bw = 12, grid = d3.range(M.l + 44, W - M.r + 1, 3);
        const dens = grid.map(p => [p, d3.mean(ps, v => Math.exp(-0.5 * ((p - v) / bw) ** 2)) || 0]);
        const dm = d3.max(dens, d => d[1]) || 1, hgt = rowH * 0.4;
        g.append("path").datum(dens).attr("fill", key === "style" ? styleColor(k) : catColor(k)).attr("fill-opacity", 0.25)
          .attr("d", d3.area().curve(d3.curveBasis).x(d => d[0]).y0(d => cy - d[1] / dm * hgt).y1(d => cy + d[1] / dm * hgt));
        // 箱ひげ(四分位の範囲と中央値)
        const q = [0.25, 0.5, 0.75].map(p => d3.quantile(ps.slice().sort(d3.ascending), p));
        g.append("rect").attr("x", q[0]).attr("y", cy - 5).attr("width", Math.max(2, q[2] - q[0])).attr("height", 10).attr("fill", "none").attr("stroke", "#2b2620");
        g.append("line").attr("x1", q[1]).attr("x2", q[1]).attr("y1", cy - 9).attr("y2", cy + 9).attr("stroke", "#2b2620").attr("stroke-width", 2.5);
        g.append("text").attr("x", M.l + 34).attr("y", cy - 2).attr("text-anchor", "end").style("font-weight", 700).text(k);
        g.append("text").attr("x", M.l + 34).attr("y", cy + 12).attr("text-anchor", "end").style("fill", "#7a7168").text(`${rs.length}品`);
        g.append("rect").attr("x", M.l + 44).attr("y", cy - rowH / 2).attr("width", W - M.r - M.l - 44).attr("height", rowH).attr("fill", "transparent")
          .lower().on("click", () => showList(`${k}のレシピ`, rs));
        // 代表の料理だけを点で出す(食材を入れていればマッチ度の上位、なければ定番)
        if (nShow) {
          const pick = (input ? rs.slice().sort((a, b) => b._match - a._match) : rs.filter(r => r.name.startsWith("基本の")).concat(rs)).slice(0, nShow);
          const sel = [...new Set(pick)].slice(0, nShow);
          dotEvents(g.append("g").selectAll("circle").data(sel).join("circle").attr("class", "dot")
            .attr("cx", r => posOf(X, r, false)).attr("cy", (r, j) => cy + (j % 2 ? 1 : -1) * (6 + (j % 3) * 4)).attr("r", 4.5)
            .attr("fill", r => (input ? matchColor(r._match) : "#8a7c6e")).attr("stroke", "#fff"));
        }
      });
      $("legend").innerHTML = `<span>帯の太さ = その値のレシピの多さ　箱 = 真ん中の半分　太い縦線 = 中央値　点 = ${input ? "各行のマッチ度の上位" : "各行の定番(「基本の〜」)"}(行をクリックで全部の料理)</span>`;
    };
    $("view-ctrl").onchange = draw;
    draw();
  }

  const VIEWS = [
    { group: "まず試す", id: "quick", name: "0. 手軽な直し", fn: viewQuick,
      desc: "今の散布図のまま、点を少しずらす・半透明にして小さくする・時間の軸を「順番だけ」にする、の3つを試せます。上の「時間の軸」で切り替えてください。30分ほどで本番に入れられる直しです。",
      pros: "実装がいちばん軽い。今の操作(横軸=足りない食材の数)をそのまま残せる。時間がとびとびなので、ずらすだけでも重なりがかなり減る",
      cons: "点の数そのものは減らないので、混んでいる所(15〜30分・100〜200円など)はまだ読みにくい。名前は出せない" },
    { group: "まず試す", id: "topn", name: "8. 上位だけアイコン", fn: viewTopN,
      desc: "今の検索ページと同じ軸(横 = 足りない食材の数、縦 = 調理時間)とアイコンで、アイコンにするのをマッチ度の上位だけにし、残りは小さな点にします。「全部アイコン」に切り替えると今の検索ページと同じ描き方になります。凡例の「高さのずれ」は、アイコンが押し合いで本当の調理時間から何分ずれたかです。",
      pros: "今の検索ページの見た目と操作をほぼそのまま残せる(renderScatter の中だけの変更)。アイコンが減るので押し合いがほとんど起きず、縦の位置が本当の時間に戻る。小さな点で全体の混み具合も見える",
      cons: "上位に入らない料理はアイコンが出ないので、クリックしにくい。上位の決め方(マッチ度)しだいで見え方が変わる" },
    { group: "まず試す", id: "agg", name: "13. アイコンごとにまとめる", fn: viewAgg,
      desc: "今の検索ページと同じ軸で、同じ列(足りない食材の数)・同じ時間帯・同じアイコンの料理を1つの丸にまとめ、丸の大きさと右下の数字で品数を出します。丸をクリックすると、中の料理が右に出ます。アイコンは全部で13種類なので、2000品あっても丸は百数十個に収まります。",
      pros: "今の見た目(アイコン・軸)のまま、丸の数を1/10以下にできる。「4個足りない・20〜30分にサラダが30品」のような量が読める。丸が少ないので押し合いでのずれも小さい",
      cons: "1品ずつは見えない(クリックか、マウスを乗せると中身が出る)。アイコンが料理の種類を大まかにしか表さない(🥗に副菜がまとめて入る など)" },
    { group: "1品を選ぶ(検索ページ向け)", id: "focus", name: "3. 背景(マス目)+ 前景", fn: viewFocus,
      desc: "全レシピは薄いマス目(マスごとの数)にして背景に置き、今ある食材とのマッチ度が高い上位だけを点と名前で前に出します。食材を入れていないときは、定番(「基本の〜」)を前に出します。",
      pros: "「全体の中で、自分に合う料理がどこにあるか」が一目でわかる。点が少ないので名前まで出せる。今の検索の流れ(入力→マッチ度→選ぶ)に合う",
      cons: "前に出す料理の決め方(マッチ度・定番)しだいで見え方が変わる。背景のマスは時間の値の数(13列)だけの粗さ" },
    { group: "1品を選ぶ(検索ページ向け)", id: "zoom", name: "4. 拡大すると点が出てくる", fn: viewZoom,
      desc: "地図アプリのように、引いて見ているときはマス目、拡大すると個々の点、さらに拡大すると名前が出ます。",
      pros: "全体と細部の両方を1つのグラフで見られる。探検する楽しさがある",
      cons: "操作を知らないと気づかれにくい。スマホではピンチ操作が必要" },
    { group: "1品を選ぶ(検索ページ向け)", id: "pareto", name: "5. 損しない料理だけ", fn: viewPareto,
      desc: "「この料理より速くて、しかも〇〇も良い料理はほかにない」料理だけを線で結びます(パレート最適)。速くて安い副菜が線を独占しないように、分類ごとに線を引けます。",
      pros: "2468品あっても、見るべきは数品〜十数品に絞れる。「時間とマッチ度(や値段)のどちらを取るか」を選ぶ道具になる",
      cons: "2つの基準しか使えない。線から少し外れた良い料理は見えない。全体で1本にすると副菜やデザートに偏る" },
    { group: "1品を選ぶ(検索ページ向け)", id: "bars", name: "9. 棒グラフ(マッチ度順)", fn: viewBars,
      desc: "マッチ度の高い料理から左に並べ、棒の高さを調理時間にします。左にあるほど今ある食材に合い、棒が低いほど早く作れます。マッチ度が同じ料理は、時間の短い順です。",
      pros: "点の重なりがまったくない。順位と時間が一度に読め、料理名も全部出せる。「合う順に見て、短いものを選ぶ」という選び方にそのまま合う",
      cons: "並べられるのは数十品まで。上位に入らない料理は見えない。時間以外の値(値段など)を同時に比べるのは苦手" },
    { group: "傾向を見る(紹介・分析ページ向け)", id: "heat", name: "1. マス目のヒートマップ", fn: viewHeat,
      desc: "調理時間と縦軸の値をマス目に区切り、マスに入るレシピの数を色と数字で出します。時間がとびとびのデータと相性がよい方法です。",
      pros: "点の重なりが完全になくなる。数が読める。「10分以内・200円以下は何品?」にすぐ答えられる",
      cons: "1品1品は見えない(クリックが必要)。区切り方で印象が変わる" },
    { group: "傾向を見る(紹介・分析ページ向け)", id: "small", name: "6. 小さなグラフを並べる", fn: viewSmall,
      desc: "分類(主食・主菜…)や系統(和風・洋風…)ごとに小さな散布図を並べます。1枚あたりの点が数百に減ります。",
      pros: "グループどうしの違いを比べやすい(デザートは長めの料理も多い、など)。仕組みがわかりやすい",
      cons: "1枚が小さくなる。大きいグループ(和風・主菜)はまだ混み合う" },
    { group: "傾向を見る(紹介・分析ページ向け)", id: "violin", name: "7. 系統ごとの分布", fn: viewViolin,
      desc: "横軸を1つの値(調理時間など)にして、系統ごとに1行ずつ並べます。全部の点を積むと(ビースウォーム)2000品では収まらないので、分布はバイオリン図と箱ひげで見せ、点は代表の料理だけにしています。",
      pros: "「韓国風は短め、インド風は長め」のような比較がはっきり見える",
      cons: "2つの値の組み合わせ(時間と値段の関係)は見えない" },
    { group: "傾向を見る(紹介・分析ページ向け)", id: "hex", name: "2. 六角形・等高線(参考: 不向き)", fn: viewHex,
      desc: "ふつうは点が多いときの定番ですが、このデータには向かない例として残しています。時間がとびとびなので、六角形は縦の縞になり、等高線はレシピのない時間にも山を描いてしまいます。",
      pros: "値がなめらかに散らばっているデータ(値段どうし・栄養どうしなど)なら、分布の山が見やすい",
      cons: "このデータでは 1. のマス目よりはっきり劣る。正確な数は読みにくく、1品を選ぶ操作にも向かない" },
    { group: "新しい見せ方", id: "clock", name: "10. 時計の文字盤", fn: viewClock,
      desc: "お皿(円)の上に料理を置きます。角度 = 調理時間(12時が0分で時計回り)、中心からの距離 = マッチ度(真ん中ほど手持ちの食材に合う)。真ん中で、12時のすぐ右にある料理が「すぐ作れて、手持ちに合う料理」です。",
      pros: "「早さ」と「合い具合」の両方が良い料理が、真ん中の一か所に集まるので探しやすい。お皿と時計に見立てているので、説明がなくても読み方が伝わりやすい",
      cons: "角度は長さより比べにくく、時間の差は読み取りにくい。外側ほど円周が長いので、マッチ度の低い料理ほど広く散らばって見える" },
    { group: "新しい見せ方", id: "stairs", name: "11. 買い足しの階段", fn: viewStairs,
      desc: "今ある食材だけで作れる料理の数から始めて、1つ買い足すごとに作れる料理が一番増える食材を順に選び、作れる料理の数を階段で見せます。段をクリックすると、その食材で新しく作れるようになった料理が出ます。",
      pros: "「何を買えばいいか」に直接答えられる。買い物リストの順番そのものになる。調理時間の上限を変えて数え直せる",
      cons: "1つずつ一番増えるものを選ぶ方法(貪欲法)なので、2つ同時に買うと一気に増える組み合わせは見落とすことがある。代用できる食材は数えていない" },
    { group: "新しい見せ方", id: "upset", name: "12. 組み合わせ表(UpSet)", fn: viewUpset,
      desc: "手持ちの食材のうち「どれとどれを一緒に使う料理」が何品あるかを、上の棒と下の点と線の表で見せます(ベン図の代わりに使われる UpSet という形)。棒の色は買い足しの数です。",
      pros: "食材が3つ以上でも、組み合わせごとの数が正確に読める(ベン図は4つ以上で読めなくなる)。「卵と豚肉を一緒に使う料理」がそのまま1本の棒になる",
      cons: "見慣れない形なので、最初は読み方の説明が要る。1品1品の時間や値段は見えない" },
  ];

  function show(id) {
    state.view = id;
    const v = VIEWS.find(x => x.id === id);
    for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.id === id);
    $("view-title").textContent = v.name;
    $("view-desc").textContent = v.desc;
    $("view-pros").textContent = v.pros;
    $("view-cons").textContent = v.cons;
    $("view-ctrl").onchange = null; $("view-ctrl").oninput = null;
    tipOff();
    v.fn();
    try { history.replaceState(null, "", `?view=${id}`); } catch (_) { /* file:// などでは無視 */ }
  }

  RecipeData.load().then(data => {
    state.recipes = data.recipes;
    state.master = data.ingredients;
    state.times = [...new Set(data.recipes.map(r => Math.min(r.time_min, 120)))].sort((a, b) => a - b);
    for (const [name, info] of Object.entries(data.ingredients)) {
      state.aliasMap.set(norm(name), name);
      for (const a of info.aliases || []) state.aliasMap.set(norm(a), name);
    }
    let last = null, html = "";
    for (const v of VIEWS) {
      if (v.group !== last) { html += `<span class="group">${esc(v.group)}</span>`; last = v.group; }
      html += `<button type="button" data-id="${v.id}">${esc(v.name)}</button>`;
    }
    $("tabs").innerHTML = html;
    $("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) show(b.dataset.id); });
    readHave();
    let t;
    $("have").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { readHave(); show(state.view); }, 300); });
    $("ykey").addEventListener("change", () => { state.ykey = $("ykey").value; show(state.view); });
    $("tscale").addEventListener("change", () => { state.tscale = $("tscale").value; show(state.view); });
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => show(state.view), 250); });
    const v = new URLSearchParams(location.search).get("view");
    show(VIEWS.some(x => x.id === v) ? v : "quick");
  }).catch(err => { $("list").innerHTML = `<p class="small">データを読み込めませんでした: ${esc(err.message)}</p>`; });
})();
