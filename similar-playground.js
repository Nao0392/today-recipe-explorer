// similar-playground.js — 埋め込みベクトルを使った「似た料理」の試作(チームへのデモ用)
// ・レシピはいつもの RecipeData(data-adapter.js)、似た料理と地図の座標は data/similar_qwen3.json
//   (temp_koba/embed/make_similar_data.py が Qwen3-Embedding-8B × 名前+材料+作り方+タグ から作る)
// ・① 似た料理(上位10品)② 似ていて、今ある食材で作れる料理(似た料理の上位30品から)④ 料理の地図
// ・search.html / app.js には触らない
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MISS_COLOR = ["#2e9d6f", "#e7b416", "#e5793a", "#cfc5ba"];   // 買い足し 0 / 1 / 2 / 3個以上
  const MISS_LABEL = ["買い足しなし", "買い足し1個", "買い足し2個", "3個以上"];
  const COLORS = {
    category: d3.scaleOrdinal(["主菜", "副菜", "主食", "汁物", "デザート"], ["#e5793a", "#2e9d6f", "#4a98c5", "#c9a227", "#db6f9f"]),
    style: d3.scaleOrdinal(["和風", "洋風", "中華", "韓国風", "エスニック", "インド風", "メキシカン"], ["#f26b38", "#db6f9f", "#e09b1f", "#3fae84", "#4a98c5", "#7c6ed6", "#8bbf4a"]),
  };
  const state = { recipes: [], master: {}, sim: null, aliasMap: new Map(), have: [], unknown: [], missing: [], selected: null, zoom: d3.zoomIdentity };

  // ---------- 食材の表記揺れ(tree-playground.js と同じ) ----------
  const norm = s => s.normalize("NFKC").trim().toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  function buildAliasMap(master) {
    const m = new Map();
    for (const [name, info] of Object.entries(master)) {
      m.set(norm(name), name);
      for (const a of info.aliases || []) m.set(norm(a), name);
    }
    return m;
  }
  // まとめの食材(app.js と同じ): 「鶏肉」と入れたら鶏もも肉・鶏むね肉…も持っているとみなす。
  // レシピ側がまとめの名前(部位の分からない「豆腐」など)なら、どれか1つの部位があればよい
  const membersOf = n => (state.master[n] || {}).members || [];
  const expandMembers = list => { const out = new Set(list); for (const n of list) for (const m of membersOf(n)) out.add(m); return out; };
  const hasIngredient = (set, n) => set.has(n) || membersOf(n).some(m => set.has(m));
  function readHave() {
    const known = [], unknown = [];
    for (const t of $("have").value.split(/[、,，\s]+/).filter(Boolean)) {
      const c = state.aliasMap.get(norm(t));
      if (c) { if (!known.includes(c)) known.push(c); } else unknown.push(t);
    }
    state.have = known; state.unknown = unknown;
    $("unknown").textContent = unknown.length ? `(見つからない食材: ${unknown.join("、")})` : "";
    // 料理ごとの足りない食材(調味料 = pantry は数えない)
    const have = expandMembers(known);
    state.missing = state.recipes.map(r => r.ingredients.map(i => i.name).filter(n => !hasIngredient(have, n)));
  }
  const allow = () => +$("allow").value;
  const canMake = i => state.missing[i].length <= allow();
  const missN = i => state.missing[i].length;

  // ---------- ①②: 右側の表示 ----------
  function select(i, { pan = true } = {}) {
    state.selected = i;
    $("pick").value = state.recipes[i].name;
    renderSide();
    renderMap({ pan });
  }
  function missBadge(i) {
    const m = state.missing[i];
    return m.length === 0 ? `<span class="badge ok">今ある食材で作れる</span>` :
      `<span class="badge miss">買い足し ${m.length}個: ${esc(m.slice(0, 4).join("・"))}${m.length > 4 ? " ほか" : ""}</span>`;
  }
  function itemHTML(j, score) {
    const r = state.recipes[j];
    return `<li><a data-i="${j}">${esc(r.name)}</a><span class="sim" title="似ている度合い ${score.toFixed(2)}"><i style="width:${Math.max(0, (score - 0.5) * 2) * 100}%"></i></span>` +
      `<span class="small">${esc(r.category)}・${esc(r.style)}・${r.time_min}分</span><br>${missBadge(j)}</li>`;
  }
  function renderSide() {
    const i = state.selected;
    if (i == null) return;
    const r = state.recipes[i], nb = state.sim.neighbors[i], sc = state.sim.scores[i];
    const m = state.missing[i];
    $("detail").innerHTML = `<div class="recipe-head"><h3>${esc(r.name)}</h3>
      <div class="meta">${esc(r.category)}・${esc(r.style)}・${r.time_min}分・¥${r.price}${(r.taste || []).length ? "・" + esc(r.taste.join("・")) : ""}</div>
      <div>${r.ingredients.map(x => `<span class="badge ${m.includes(x.name) ? "miss" : "have"}">${esc(x.name)}</span>`).join("")}</div>
      <p class="small">${m.length ? `足りない食材: <b class="need">${esc(m.join("・"))}</b>(赤)` : "今ある食材で作れます。"}
        <a href="search.html?open=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">いつもの検索ページで開く →</a></p></div>`;

    // ② 似ていて、今ある食材で作れる料理(似た料理の上位30品のうち、買い足しが「作れる」の範囲内のもの。似ている順)
    const alts = nb.map((j, k) => ({ j, s: sc[k] })).filter(x => canMake(x.j)).slice(0, 8);
    const range = allow() === 0 ? "今ある食材だけで" : `買い足し${allow()}個までで`;
    $("alt").innerHTML = `<h2>② 似ていて、${range}作れる料理</h2>` +
      (m.length <= allow() ? `<p class="hint">この料理自体が${range}作れます。似ていて同じように作れる料理はこちら。</p>` :
        `<p class="hint">「${esc(r.name)}」は ${esc(m.join("・"))} が足りません。似た料理(上位${state.sim.k}品)のうち、${range}作れるものを似ている順に出します。</p>`) +
      (alts.length ? `<ol class="list">${alts.map(x => itemHTML(x.j, x.s)).join("")}</ol>` :
        `<p class="empty">似た料理${state.sim.k}品の中には、${range}作れる料理がありませんでした。食材を足すか、「作れる」の範囲を広げてみてください。</p>`);

    // ① 似た料理(上位10品)
    $("similar").innerHTML = `<h2>① 似た料理(上位10品)</h2><p class="hint">棒が長いほど似ています。作れるかどうかに関係なく、似ている順です。</p>` +
      `<ol class="list">${nb.slice(0, 10).map((j, k) => itemHTML(j, sc[k])).join("")}</ol>`;
    for (const a of document.querySelectorAll(".side a[data-i]")) a.addEventListener("click", () => select(+a.dataset.i));
  }

  // ---------- ④ 料理の地図 ----------
  let svg, gAll, gLines, gDots, gLabels, zoom, X, Y, W, H;
  function initMap() {
    svg = d3.select("#map");
    gAll = svg.append("g");
    gLines = gAll.append("g"); gDots = gAll.append("g"); gLabels = gAll.append("g");
    zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", e => {
      state.zoom = e.transform;
      gAll.attr("transform", e.transform);
      // 拡大しても点と文字の大きさは変えない
      gDots.selectAll("circle").attr("r", 3.4 / e.transform.k).attr("stroke-width", null);
      gLabels.selectAll("text").style("font-size", `${12 / e.transform.k}px`).style("stroke-width", `${3.5 / e.transform.k}px`);
      gLines.selectAll("line").style("stroke-width", function () { return (this.classList.contains("alt") ? 1.8 : 1) / e.transform.k; });
    });
    svg.call(zoom);
    $("zoom-reset").addEventListener("click", () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
    layout();
  }
  function layout() {
    W = Math.max(320, $("map-wrap").clientWidth); H = Math.round(Math.min(760, Math.max(380, W * 0.72)));
    const P = 16;
    X = d3.scaleLinear([0, 1000], [P, W - P]); Y = d3.scaleLinear([0, 1000], [P, H - P]);
    svg.attr("viewBox", [0, 0, W, H]).attr("height", H);
    zoom.extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, H]]);
  }
  function colorOf(i) {
    const mode = $("color").value, r = state.recipes[i];
    return mode === "miss" ? MISS_COLOR[Math.min(missN(i), 3)] : COLORS[mode](r[mode] || "");
  }
  function renderMap({ pan = false } = {}) {
    const map = state.sim.map, k = state.zoom.k || 1;
    const sel = state.selected, nb = sel != null ? state.sim.neighbors[sel].slice(0, 10) : [];
    const alts = sel != null ? state.sim.neighbors[sel].filter(canMake).slice(0, 8) : [];
    const nbSet = new Set(nb), altSet = new Set(alts);
    const onlyOk = $("only-ok").checked;
    // 作れる料理を上に描く(重なったときに見えるように)
    const order = d3.range(state.recipes.length).sort((a, b) => missN(b) - missN(a));
    gDots.selectAll("circle").data(order, d => d).join("circle")
      .attr("cx", i => X(map[i][0])).attr("cy", i => Y(map[i][1])).attr("r", 3.4 / k)
      .attr("fill", colorOf)
      .attr("class", i => {
        const mark = i === sel ? "sel" : altSet.has(i) ? "alt" : nbSet.has(i) ? "nb" : "";
        return mark || (onlyOk && !canMake(i)) ? mark + (onlyOk && !canMake(i) && !mark ? " dim" : "") : "";   // 「作れる料理だけを濃く」のときは作れない料理を薄く(選んだ料理と似た料理は除く)
      })
      .on("mouseenter", (e, i) => tip(e, i)).on("mousemove", (e, i) => tip(e, i)).on("mouseleave", () => { $("tip").hidden = true; })
      .on("click", (e, i) => select(i, { pan: false }));
    gDots.selectAll("circle.alt, circle.nb, circle.sel").raise();
    const lines = sel == null ? [] : [...nb.map(j => ({ j, alt: altSet.has(j) })), ...alts.filter(j => !nbSet.has(j)).map(j => ({ j, alt: true }))];
    gLines.selectAll("line").data(lines, d => d.j).join("line")
      .attr("class", d => (d.alt ? "alt" : ""))
      .attr("x1", X(map[sel ?? 0][0])).attr("y1", Y(map[sel ?? 0][1])).attr("x2", d => X(map[d.j][0])).attr("y2", d => Y(map[d.j][1]))
      .style("stroke-width", d => (d.alt ? 1.8 : 1) / k);
    const labels = sel == null ? [] : [sel];
    gLabels.selectAll("text").data(labels).join("text")
      .attr("x", i => X(map[i][0]) + 6 / k).attr("y", i => Y(map[i][1]) - 6 / k)
      .style("font-size", `${12 / k}px`).style("stroke-width", `${3.5 / k}px`).text(i => state.recipes[i].name);
    // 選んだ料理が見えるように、地図を寄せる(拡大はしない)
    if (pan && sel != null && state.zoom.k > 1) {
      const t = d3.zoomIdentity.translate(W / 2 - X(map[sel][0]) * state.zoom.k, H / 2 - Y(map[sel][1]) * state.zoom.k).scale(state.zoom.k);
      svg.transition().duration(400).call(zoom.transform, t);
    }
    renderLegend();
  }
  function renderLegend() {
    const mode = $("color").value;
    if (mode === "miss") {
      const counts = [0, 0, 0, 0];
      state.missing.forEach(m => counts[Math.min(m.length, 3)]++);
      $("legend").innerHTML = MISS_LABEL.map((t, n) => `<span><i style="background:${MISS_COLOR[n]}"></i>${t}(${counts[n]}品)</span>`).join("") +
        `<span>・選んだ料理 = 黒い太い縁、似た料理 = 黒い縁、似ていて作れる料理 = 緑の太い縁</span>`;
    } else {
      const counts = d3.rollup(state.recipes, v => v.length, r => r[mode] || "");
      $("legend").innerHTML = COLORS[mode].domain().filter(k => counts.get(k)).map(k => `<span><i style="background:${COLORS[mode](k)}"></i>${esc(k)}(${counts.get(k)}品)</span>`).join("");
    }
  }
  function tip(e, i) {
    const r = state.recipes[i], box = $("map-wrap").getBoundingClientRect(), t = $("tip");
    t.hidden = false;
    t.innerHTML = `<b>${esc(r.name)}</b><br>${esc(r.category)}・${esc(r.style)}・${r.time_min}分<br>` +
      (missN(i) ? `買い足し: ${esc(state.missing[i].join("・"))}` : "今ある食材で作れる");
    t.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 200)}px`;
    t.style.top = `${e.clientY - box.top + 12}px`;
  }

  // ---------- 入力 ----------
  function initControls(data) {
    const freq = d3.rollup(data.recipes.flatMap(r => r.ingredients.map(i => i.name)), v => v.length, d => d);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(d => d[0]);
    const quick = $("quick");
    const sync = () => { for (const b of quick.children) b.classList.toggle("on", state.have.includes(b.textContent)); };
    for (const name of top) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = name;
      b.addEventListener("click", () => {
        readHave();
        const set = new Set(state.have);
        if (set.has(name)) set.delete(name); else set.add(name);
        $("have").value = [...set, ...state.unknown].join("、");
        update(); sync();
      });
      quick.appendChild(b);
    }
    let timer;
    const update = () => { readHave(); sync(); renderSide(); renderMap(); };
    $("have").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 250); });
    $("allow").addEventListener("change", update);
    for (const id of ["color", "only-ok"]) $(id).addEventListener("change", () => renderMap());
    $("recipe-list").innerHTML = state.recipes.map(r => `<option value="${esc(r.name)}">`).join("");
    const byName = new Map(state.recipes.map((r, i) => [r.name, i]));
    $("pick").addEventListener("change", () => { const i = byName.get($("pick").value.trim()); if (i != null) select(i); });
    $("random").addEventListener("click", () => select(Math.floor(Math.random() * state.recipes.length)));
    $("random-ng").addEventListener("click", () => {
      const ng = d3.range(state.recipes.length).filter(i => !canMake(i) && missN(i) <= 3);
      if (ng.length) select(ng[Math.floor(Math.random() * ng.length)]);
    });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => { layout(); renderMap(); }, 250); });
    readHave(); sync();
  }

  Promise.all([RecipeData.load(), fetch("data/similar_qwen3.json").then(r => r.json())]).then(([data, sim]) => {
    // 似た料理のデータ(ids の順)に合わせて、レシピを並べ直す
    const byId = new Map(data.recipes.map(r => [String(r.id), r]));
    const missingIds = sim.ids.filter(id => !byId.has(id));
    if (missingIds.length) console.warn("[similar] レシピデータに無いID:", missingIds.length);
    state.recipes = sim.ids.map(id => byId.get(id) || { id, name: id, ingredients: [], category: "", style: "", time_min: 0, price: 0 });
    state.sim = sim;
    state.master = data.ingredients;
    state.aliasMap = buildAliasMap(data.ingredients);
    initMap();
    initControls(data);
    const start = state.recipes.findIndex(r => r.name === "基本の酢豚");   // 例: にんじん・たけのこ…が無くても「豚肉と玉ねぎの甘酢あんかけ」なら作れる
    select(start >= 0 ? start : 0, { pan: false });
  }).catch(err => {
    console.error(err);
    $("detail").innerHTML = `<p class="empty">データを読み込めませんでした(data/similar_qwen3.json と data/delish_teiban_photo.json)。VSCode の Live Server などで開いてください。</p>`;
  });
})();
