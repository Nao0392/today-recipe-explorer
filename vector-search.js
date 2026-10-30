/**
 * vector-search.js — 類似レシピ検索 UI と説明可能な D3 可視化。
 *
 * app.js の既存の条件検索とは別に動作する。料理の選択だけ
 * recipe-vector-select イベントで既存の詳細パネルに通知する。
 * したがって、食材フィルターの検索順位を変更することはない。
 */
(function () {
  "use strict";
  const root = document.getElementById("vector-search");
  if (!root || !window.RecipeVectorCore) return;

  const byId = id => document.getElementById(id);
  const seed = byId("vector-seed");
  const weightsEl = byId("vector-weight-controls");
  const resultsEl = byId("vector-results");
  const explainEl = byId("vector-explain");
  const statusEl = byId("vector-status");
  const scoreSvg = d3.select("#vector-score-chart");
  let index = null, recipes = [];
  let baseId = null, inspectedId = null;
  const weights = Object.fromEntries(RecipeVectorCore.FIELDS.map(x => [x.key, x.weight]));
  const MAX_RESULTS = 8;

  function makeElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function pct(value) { return value === null ? "データなし" : (value * 100).toFixed(1) + "%"; }

  // 重みはユーザーが自由に変えられる。合計値は検索時に正規化される。
  function createWeightControls() {
    for (const field of RecipeVectorCore.FIELDS) {
      const line = makeElement("label", "vector-weight-row");
      const title = makeElement("span", "vector-weight-label", field.label);
      const input = makeElement("input");
      input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1";
      input.value = field.weight; input.dataset.key = field.key;
      input.setAttribute("aria-label", field.label + "の重み");
      const value = makeElement("output", "vector-weight-number", String(field.weight));
      input.addEventListener("input", () => {
        weights[field.key] = Number(input.value);
        value.textContent = input.value;
        render();
      });
      line.append(title, input, value);
      weightsEl.appendChild(line);
    }
    byId("vector-reset").addEventListener("click", () => {
      RecipeVectorCore.FIELDS.forEach(field => { weights[field.key] = field.weight; });
      weightsEl.querySelectorAll("input").forEach(input => {
        input.value = weights[input.dataset.key];
        input.nextElementSibling.textContent = input.value;
      });
      render();
    });
  }

  function drawScoreChart(found) {
    const W = 570, left = 132, right = 58, top = 10, row = 31;
    const H = Math.max(45, top + found.length * row + 12);
    scoreSvg.attr("viewBox", "0 0 " + W + " " + H).attr("role", "img")
      .attr("aria-label", "類似度スコア上位" + found.length + "件の棒グラフ");
    const x = d3.scaleLinear().domain([0, 1]).range([left, W - right]);
    const groups = scoreSvg.selectAll("g.vector-bar-row")
      .data(found, d => d.id).join(
        enter => enter.append("g").attr("class", "vector-bar-row"),
        update => update,
        exit => exit.remove()
      ).attr("transform", (d, i) => "translate(0," + (top + i * row) + ")");
    groups.selectAll("text.vector-bar-name").data(d => [d]).join("text")
      .attr("class", "vector-bar-name").attr("x", left - 8).attr("y", 18)
      .attr("text-anchor", "end").text(d => d.name.length > 11 ? d.name.slice(0, 10) + "…" : d.name);
    groups.selectAll("rect.vector-bar-bg").data(d => [d]).join("rect")
      .attr("class", "vector-bar-bg").attr("x", left).attr("y", 3)
      .attr("height", 21).attr("rx", 4).attr("width", x(1) - x(0));
    groups.selectAll("rect.vector-bar-value").data(d => [d]).join("rect")
      .attr("class", "vector-bar-value").attr("x", left).attr("y", 3)
      .attr("height", 21).attr("rx", 4)
      .attr("width", d => Math.max(0, x(d.score) - x(0)))
      .classed("selected", d => inspectedId === d.id);
    groups.selectAll("text.vector-bar-value-text").data(d => [d]).join("text")
      .attr("class", "vector-bar-value-text").attr("x", W - 3).attr("y", 18)
      .attr("text-anchor", "end").text(d => pct(d.score));
    groups.attr("tabindex", "0").attr("role", "button")
      .attr("aria-label", d => d.name + "：類似度" + pct(d.score) + "、詳細を表示")
      .on("click", (_, d) => chooseResult(d.id))
      .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseResult(d.id); } });
    groups.selectAll("title").data(d => [d]).join("title")
      .text(d => d.name + " / " + pct(d.score));
  }

  // 何が似ているかを 7 次元に分解し、重み付き寄与を併記する。
  function drawExplanation(match) {
    explainEl.replaceChildren();
    if (!match) {
      explainEl.appendChild(makeElement("p", "vector-hint", "比較対象を選択してください。"));
      return;
    }
    const head = makeElement("h5", null, "「" + match.name + "」との比較");
    explainEl.appendChild(head);
    const note = makeElement("p", "vector-hint",
      "各行の棒はその次元での類似度、右側は総合スコアへの寄与（%ポイント）です。");
    explainEl.appendChild(note);
    const contributing = match.dimensions.filter(d => d.similarity !== null && d.weight > 0);
    if (!contributing.length) {
      explainEl.appendChild(makeElement("p", "vector-hint", "比較可能な特徴量がありません。"));
      return;
    }
    for (const d of match.dimensions) {
      const line = makeElement("div", "vector-dimension");
      line.appendChild(makeElement("span", "vector-dim-label", d.label));
      const meter = makeElement("div", "vector-meter");
      if (d.similarity !== null) {
        const fill = makeElement("div", "vector-meter-fill");
        fill.style.width = (100 * d.similarity) + "%";
        fill.style.backgroundColor = d.color;
        meter.appendChild(fill);
      }
      const value = d.similarity === null ? "欠損" :
        pct(d.similarity) + " / +" + (100 * d.contribution).toFixed(1) + "pt";
      line.append(meter, makeElement("span", "vector-dim-number", value));
      explainEl.appendChild(line);
    }
    const ingredients = makeElement("p", "vector-common");
    ingredients.appendChild(makeElement("strong", null, "共通の食材："));
    ingredients.appendChild(document.createTextNode(match.commonIngredients.length
      ? match.commonIngredients.join("、") : "一致なし"));
    explainEl.appendChild(ingredients);
    explainEl.appendChild(makeElement("p", "vector-hint",
      "スコアは選択した特徴量に対する相対的な近さです。好みの一致確率ではありません。"));
  }

  function chooseResult(id) {
    inspectedId = id;
    render();
    // 既存のレシピ詳細表示を再利用する。内部 state に直接アクセスしない。
    window.dispatchEvent(new CustomEvent("recipe-vector-select", { detail: { id } }));
  }

  function render() {
    if (!index || !baseId) return;
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    if (total <= 0) {
      statusEl.textContent = "重みがすべて0です。1項目以上の重みを設定してください。";
      resultsEl.replaceChildren(); drawScoreChart([]); drawExplanation(null); return;
    }
    const found = index.search(baseId, weights, MAX_RESULTS);
    if (found.length && !found.some(r => r.id === inspectedId)) inspectedId = found[0].id;
    if (!found.length) inspectedId = null;
    statusEl.textContent = index.size + "件中 " + found.length +
      "件を表示（基準の料理自身は除外・全レシピから検索）";
    resultsEl.replaceChildren();
    found.forEach((match, i) => {
      const button = makeElement("button", "vector-result");
      button.type = "button";
      button.classList.toggle("selected", inspectedId === match.id);
      button.setAttribute("aria-pressed", String(inspectedId === match.id));
      const info = makeElement("span", "vector-result-info");
      info.append(makeElement("strong", null, (i + 1) + ". " + match.name));
      const common = match.commonIngredients.length
        ? "共通食材：" + match.commonIngredients.join("・")
        : "共通食材なし（他の次元で評価）";
      info.append(makeElement("small", null, common));
      button.append(info, makeElement("b", "vector-result-score", pct(match.score)));
      button.addEventListener("click", () => chooseResult(match.id));
      resultsEl.appendChild(button);
    });
    drawScoreChart(found);
    const selected = found.find(r => r.id === inspectedId) || null;
    drawExplanation(selected);
  }

  createWeightControls();
  RecipeData.load()
    .then(data => {
      recipes = Array.isArray(data.recipes) ? data.recipes : [];
      index = RecipeVectorCore.createIndex(recipes);
      if (index.size < 2) throw new Error("比較には2件以上のレシピが必要です");
      recipes.slice().sort((a,b) => String(a.name).localeCompare(String(b.name), "ja"))
        .forEach(r => {
          const option = document.createElement("option");
          option.value = String(r.id); option.textContent = r.name;
          seed.appendChild(option);
        });
      const queryId = new URLSearchParams(location.search).get("open");
      baseId = recipes.some(r => String(r.id) === queryId) ? queryId : String(recipes[0].id);
      seed.value = baseId;
      seed.disabled = false;
      seed.addEventListener("change", () => { baseId = seed.value; inspectedId = null; render(); });
      render();
    })
    .catch(error => {
      console.error("Vector search initialization failed:", error);
      statusEl.textContent = "類似検索を読み込めませんでした。Live Server で起動し、レシピデータを確認してください。";
    });
})();
