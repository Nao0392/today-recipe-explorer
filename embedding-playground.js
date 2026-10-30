// レシピの埋め込み比べ(embedding-playground.html)
// ・data/embed_playground.json を読むだけ(temp_koba/embed/analyze_embeddings.py が作る)
// ・アプリ本体(search.html / app.js)とは独立していて、d3 だけを使う
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const STORE = "embed-playground-votes-v1";
  let D = null, cfgByKey = new Map(), nameIdx = new Map();
  const state = { seed: 0, blind: null, mapSel: null };

  fetch("data/embed_playground.json").then(r => r.json()).then(d => { D = d; init(); })
    .catch(() => { document.body.insertAdjacentHTML("beforeend", `<section><p>data/embed_playground.json を読み込めませんでした。</p></section>`); });

  function init() {
    D.configs.forEach(c => cfgByKey.set(c.key, c));
    D.recipes.forEach((r, i) => nameIdx.set(r.name, i));
    $("recipe-list").innerHTML = D.recipes.map(r => `<option value="${esc(r.name)}">`).join("");
    renderMetrics();
    // 「固定する」の選択肢は「比べるもの」に合わせて入れ替える
    for (const [axis, fix] of [["axis", "fix"], ["b-axis", "b-fix"], ["q-axis", "q-fix"]]) {
      const fill = () => {
        const byModel = $(axis).value === "model";
        const opts = byModel ? Object.entries(D.texts) : Object.entries(D.models);
        const prev = $(fix).value;
        $(fix).innerHTML = opts.map(([k, v]) => `<option value="${k}">${byModel ? "文章: " : "モデル: "}${esc(v)}</option>`).join("");
        if (opts.some(([k]) => k === prev)) $(fix).value = prev;
        else if (byModel) $(fix).value = D.texts.full && cfgByKey.has("qwen3__full") ? "full" : "name_ing_steps";   // 初めは結論の文章(+タグ)
      };
      fill();
      $(axis).addEventListener("change", () => { fill(); renderAll(); });
      $(fix).addEventListener("change", renderAll);
    }
    $("seed-input").addEventListener("change", () => {
      const i = nameIdx.get($("seed-input").value.trim());
      if (i != null) { state.seed = i; renderCompare(); }
    });
    $("seed-random").addEventListener("click", () => { state.seed = Math.floor(Math.random() * D.recipes.length); renderCompare(); });
    $("query").innerHTML = D.queries.map((q, i) => `<option value="${i}">${esc(q)}</option>`).join("");
    $("query").addEventListener("change", renderQuery);
    $("b-next").addEventListener("click", () => { state.blind = null; renderBlind(); });
    $("b-kind").addEventListener("change", () => { state.blind = null; renderBlind(); if (state.tallyOpen) renderTally(); else $("b-tally").textContent = ""; });
    $("b-show").addEventListener("click", () => renderTally());
    $("b-reset").addEventListener("click", () => { if (confirmReset()) { saveVotes([]); state.tallyOpen = false; $("b-tally").textContent = "結果を消しました"; } });
    // 地図
    $("m-cfg").innerHTML = D.configs.map(c => `<option value="${c.key}">${esc(D.models[c.model])} × ${esc(D.texts[c.text])}</option>`).join("");
    const def = D.configs.find(c => c.key === "qwen3__full") || D.configs[0];   // 地図の初めは結論の組み合わせ
    $("m-cfg").value = def.key;
    $("m-family").innerHTML += Object.keys(D.families).filter(f => D.families[f].length >= 3)
      .map(f => `<option value="${esc(f)}">${esc(f)}(${D.families[f].length}品)</option>`).join("");
    for (const id of ["m-cfg", "m-color", "m-family"]) $(id).addEventListener("change", renderMap);
    window.addEventListener("resize", () => { clearTimeout(state.rt); state.rt = setTimeout(renderMap, 300); });
    state.seed = nameIdx.get("基本の肉じゃが") ?? 0;
    renderAll();
    renderMap();
  }
  // 結果を消す前の確認は、ブラウザのダイアログを使わず、ボタンを2回押してもらう
  let resetArmed = false;
  function confirmReset() {
    if (resetArmed) { resetArmed = false; $("b-reset").textContent = "結果を消す"; return true; }
    resetArmed = true; $("b-reset").textContent = "本当に消す(もう一度押す)";
    setTimeout(() => { resetArmed = false; $("b-reset").textContent = "結果を消す"; }, 4000);
    return false;
  }

  function renderAll() { renderCompare(); renderQuery(); renderBlind(); }

  // 「比べるもの」と「固定する」から、並べる3つの組み合わせを決める
  function configsFor(axisId, fixId) {
    const byModel = $(axisId).value === "model", fix = $(fixId).value;
    return (byModel ? Object.keys(D.models) : Object.keys(D.texts))
      .map(k => cfgByKey.get(byModel ? `${k}__${fix}` : `${fix}__${k}`))
      .filter(Boolean);
  }
  const label = c => `${D.models[c.model]} × ${D.texts[c.text]}`;

  // ---------- 自動の指標 ----------
  function renderMetrics() {
    const cols = [["cat", "分類が同じ"], ["style", "系統が同じ"], ["family", "同じ種類の料理"], ["query", "言葉で探す(目安)"]];
    const best = Object.fromEntries(cols.map(([k]) => [k, d3.max(D.configs, c => c.metrics[k] ?? -1)]));
    $("metrics").innerHTML = `<table class="metrics"><tr><th>モデル</th><th>埋め込む文章</th>${cols.map(([, t]) => `<th>${t}</th>`).join("")}</tr>` +
      D.configs.map(c => `<tr><td>${esc(D.models[c.model])}</td><td>${esc(D.texts[c.text])}</td>` +
        cols.map(([k]) => c.metrics[k] == null ? `<td>-</td>` :
          `<td class="${c.metrics[k] === best[k] ? "best" : ""}">${(c.metrics[k] * 100).toFixed(1)}%<span class="bar" style="width:${c.metrics[k] * 60}px"></span></td>`).join("") +
        `</tr>`).join("") + `</table>`;
  }

  // ---------- 近い料理のリスト ----------
  function listHTML(idx, scores, seed) {
    const s = seed != null ? D.recipes[seed] : null;
    return `<ol class="list">` + idx.map((j, k) => {
      const r = D.recipes[j];
      const chip = (v, same) => v ? `<span class="chip${same ? " same" : ""}">${esc(v)}</span>` : "";
      return `<li>${esc(r.name)}<span class="s">${scores ? scores[k].toFixed(2) : ""}</span>` +
        chip(r.category, s && r.category === s.category) + chip(r.style, s && r.style === s.style) + `</li>`;
    }).join("") + `</ol>`;
  }
  function seedHTML(i) {
    const r = D.recipes[i];
    return `基準: <b>${esc(r.name)}</b><span class="chip">${esc(r.category || "")}</span><span class="chip">${esc(r.style || "")}</span>` +
      (r.taste.length ? `<span class="chip">${esc(r.taste.join("・"))}</span>` : "");
  }
  function renderCompare() {
    $("seed-info").innerHTML = seedHTML(state.seed);
    $("seed-input").value = D.recipes[state.seed].name;
    $("compare").innerHTML = configsFor("axis", "fix").map(c =>
      `<div class="col"><h3>${esc(label(c))}</h3>${listHTML(c.neighbors[state.seed], c.scores[state.seed], state.seed)}</div>`).join("");
  }
  function renderQuery() {
    const q = +$("query").value || 0;
    $("q-cols").innerHTML = configsFor("q-axis", "q-fix").map(c =>
      `<div class="col"><h3>${esc(label(c))}</h3>${c.query_results ? listHTML(c.query_results[q], c.query_scores[q], null) : "<p class='hint'>質問のベクトルがありません</p>"}</div>`).join("");
  }

  // ---------- 目隠し評価 ----------
  const loadVotes = () => { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { return []; } };
  const saveVotes = v => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* 保存できない環境では集計だけあきらめる */ } };
  // 評価するもの: 近い料理(ランダムな料理の近い10品)/ 言葉で探す(ランダムな質問の上位10品)
  const blindKind = () => $("b-kind").value;
  function renderBlind() {
    const kind = blindKind();
    const cfgs = configsFor("b-axis", "b-fix").filter(c => kind !== "query" || c.query_results);
    const key = kind + $("b-axis").value + $("b-fix").value;
    if (!state.blind || state.blind.key !== key) {
      const pick = kind === "query" ? Math.floor(Math.random() * D.queries.length) : Math.floor(Math.random() * D.recipes.length);
      state.blind = { key, pick, order: d3.shuffle(cfgs.map(c => c.key)) };
    }
    const { pick, order } = state.blind;
    $("b-seed").innerHTML = kind === "query" ? `質問: <b>${esc(D.queries[pick])}</b>` : seedHTML(pick);
    const L = ["A", "B", "C", "D"];
    const list = k => { const c = cfgByKey.get(k); return kind === "query" ? listHTML(c.query_results[pick], null, null) : listHTML(c.neighbors[pick], null, pick); };
    $("b-cols").innerHTML = order.map((k, i) => `<div class="col"><h3>${L[i]}</h3>${list(k)}</div>`).join("");
    $("b-vote").innerHTML = order.map((k, i) => `<button type="button" data-k="${k}">${L[i]} がいちばん良い</button>`).join("") +
      `<button type="button" data-k="">差がない・どれも同じ</button>`;
    for (const b of $("b-vote").querySelectorAll("button")) b.addEventListener("click", () => {
      const votes = loadVotes();
      votes.push({ kind, seed: kind === "query" ? D.queries[pick] : D.recipes[pick].id, axis: $("b-axis").value, fix: $("b-fix").value,
        shown: order, pick: b.dataset.k || null, at: Date.now() });
      saveVotes(votes);
      state.blind = null; renderBlind(); renderTally(true);
    });
  }
  // 選んだ直後は回数だけ。「結果を見る」を押したあとは、選ぶたびに集計表も更新する。集計は「評価するもの」ごとに分ける
  function renderTally(afterVote) {
    const kind = blindKind(), kindName = kind === "query" ? "言葉で探す" : "近い料理";
    const votes = loadVotes().filter(v => (v.kind || "neighbors") === kind);
    if (afterVote === true && !state.tallyOpen) { $("b-tally").textContent = `「${kindName}」を これまで ${votes.length}回 選びました(「結果を見る」で集計)`; return; }
    state.tallyOpen = true;
    const shown = new Map(), won = new Map();
    for (const v of votes) for (const k of v.shown) shown.set(k, (shown.get(k) || 0) + 1);
    for (const v of votes) if (v.pick) won.set(v.pick, (won.get(v.pick) || 0) + 1);
    const rows = [...shown.keys()].sort((a, b) => (won.get(b) || 0) / shown.get(b) - (won.get(a) || 0) / shown.get(a));
    $("b-tally").innerHTML = `<p>「${kindName}」を これまで ${votes.length}回 選びました(差がない: ${votes.filter(v => !v.pick).length}回)</p>` +
      (rows.length ? `<table><tr><th>組み合わせ</th><th>出た回数</th><th>選ばれた回数</th><th>選ばれた割合</th></tr>` +
        rows.map(k => { const c = cfgByKey.get(k); const w = won.get(k) || 0, n = shown.get(k);
          return `<tr><td>${esc(c ? label(c) : k)}</td><td>${n}</td><td>${w}</td><td>${(w / n * 100).toFixed(0)}%</td></tr>`; }).join("") + `</table>` : "");
  }

  // ---------- 料理の地図 ----------
  const COLORS = {
    category: d3.scaleOrdinal(["主菜", "副菜", "主食", "汁物", "デザート"], ["#e5793a", "#2e9d6f", "#4a98c5", "#c9a227", "#db6f9f"]),
    style: d3.scaleOrdinal(["和風", "洋風", "中華", "韓国風", "エスニック", "インド風", "メキシカン"], ["#f26b38", "#db6f9f", "#e09b1f", "#3fae84", "#4a98c5", "#7c6ed6", "#8bbf4a"]),
  };
  function renderMap() {
    const c = cfgByKey.get($("m-cfg").value);
    const mode = $("m-color").value, color = COLORS[mode];
    const fam = $("m-family").value ? new Set(D.families[$("m-family").value]) : null;
    const W = Math.max(320, $("map-box").clientWidth), H = Math.min(720, Math.max(360, W * 0.62)), P = 14;
    const x = d3.scaleLinear([0, 1000], [P, W - P]), y = d3.scaleLinear([0, 1000], [P, H - P]);
    const svg = d3.select("#map").attr("viewBox", [0, 0, W, H]).attr("height", H);
    svg.selectAll("*").remove();
    const gl = svg.append("g"), gp = svg.append("g"), gt = svg.append("g");
    const pts = gp.selectAll("circle").data(D.recipes.map((r, i) => ({ r, i, p: c.map[i] }))).join("circle")
      .attr("cx", d => x(d.p[0])).attr("cy", d => y(d.p[1])).attr("r", 3.2)
      .attr("fill", d => color(d.r[mode] || "")).attr("class", d => (fam && !fam.has(d.i) ? "dim" : ""))
      .on("mouseenter", (e, d) => tip(e, d.r)).on("mousemove", (e, d) => tip(e, d.r)).on("mouseleave", () => $("tip").hidden = true)
      .on("click", (e, d) => { state.mapSel = state.mapSel === d.i ? null : d.i; select(); });
    const select = () => {
      gl.selectAll("*").remove(); gt.selectAll("*").remove();
      const s = state.mapSel;
      if (s == null) { pts.classed("on", false).classed("dim", d => fam && !fam.has(d.i)); $("map-nb").innerHTML = ""; return; }
      const nb = new Set(c.neighbors[s]);
      pts.classed("on", d => d.i === s || nb.has(d.i)).classed("dim", d => d.i !== s && !nb.has(d.i));
      gl.selectAll("line").data(c.neighbors[s]).join("line")
        .attr("x1", x(c.map[s][0])).attr("y1", y(c.map[s][1])).attr("x2", j => x(c.map[j][0])).attr("y2", j => y(c.map[j][1]));
      // 地図には選んだ料理の名前だけを出す(近い料理は固まっていて名前が重なるので、下に一覧で出す)
      const right = x(c.map[s][0]) > W - 180;
      gt.append("text").attr("class", "lbl").style("font-weight", 700)
        .attr("x", x(c.map[s][0]) + (right ? -6 : 6)).attr("y", y(c.map[s][1]) - 6)
        .attr("text-anchor", right ? "end" : "start").text(D.recipes[s].name);
      $("map-nb").innerHTML = `<b>${esc(D.recipes[s].name)}</b> に近い10品: ` +
        c.neighbors[s].map(j => esc(D.recipes[j].name)).join("、");
    };
    select();
    const counts = d3.rollup(D.recipes, v => v.length, r => r[mode] || "");
    $("legend").innerHTML = color.domain().filter(k => counts.get(k)).map(k => `<span style="--c:${color(k)}">${esc(k)}(${counts.get(k)})</span>`).join("");
  }
  function tip(e, r) {
    const box = $("map-box").getBoundingClientRect();
    const t = $("tip");
    t.hidden = false;
    t.innerHTML = `<b>${esc(r.name)}</b><br>${esc(r.category || "")}・${esc(r.style || "")}${r.time ? `・${r.time}分` : ""}`;
    t.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 200)}px`;
    t.style.top = `${e.clientY - box.top + 12}px`;
  }
})();
