/**
 * atlas-weightlab.js — 1特徴量を0〜100に変化させたときの推薦順位を可視化。
 * 各重みで全レシピを再比較し、推薦順位のBump Chartを描画する。
 */
(function () {
  "use strict";
  const panel = document.getElementById("lab-panel");
  if (!panel || !window.d3 || !window.RecipeAtlasCore) return;
  const featureSelect = document.getElementById("lab-feature");
  const slider = document.getElementById("lab-weight");
  const output = document.getElementById("lab-weight-value");
  const reset = document.getElementById("lab-reset");
  const results = document.getElementById("lab-results");
  const svg = d3.select("#atlas-rank");
  const W = 980, H = 425, margin = { top: 40, right: 180, bottom: 55, left: 65 };
  const palette = ['#b54f25', '#299d81', '#d89647', '#7199c8', '#9872ba', '#8a9b57', '#d17888', '#687fae', '#bd9a45', '#937f72'];
  let state, actions, changing = false;
  function initialize(initial, callbacks) {
    state = initial; actions = callbacks;
    panel.hidden = false;
    for (const field of state.index.fields) {
      const option = document.createElement("option"); option.value = field.key;
      option.textContent = field.label; featureSelect.appendChild(option);
    }
    featureSelect.value = "ingredients";
    slider.value = state.weights.ingredients;
    output.textContent = slider.value;
    featureSelect.addEventListener("change", () => {
      slider.value = state.weights[featureSelect.value]; output.textContent = slider.value;
      render(state, actions);
    });
    slider.addEventListener("input", () => {
      output.textContent = slider.value;
      changing = true;
      actions.setWeights({ [featureSelect.value]: Number(slider.value) });
      changing = false;
    });
    reset.addEventListener("click", () => {
      const defaults = Object.fromEntries(state.index.fields.map(field => [field.key, field.weight]));
      slider.value = defaults[featureSelect.value]; output.textContent = slider.value;
      actions.setWeights(defaults);
    });
  }
  function render(current) {
    state = current;
    if (!changing) {
      slider.value = state.weights[featureSelect.value];
      output.textContent = slider.value;
    }
    const feature = featureSelect.value;
    if (!feature) return;
    const dataset = RecipeAtlasCore.sweep(state.index, state.recipes, state.seed, feature, state.weights, 10);
    const now = RecipeAtlasCore.rankAll(state.index, state.recipes, state.seed, state.weights);
    const candidates = now.slice(0, 7);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
    svg.selectAll("*").remove();
    if (!now.length) {
      results.textContent = "比較できる料理がありません。重みの設定を確認してください。";
      return;
    }
    const x = d3.scaleLinear().domain([0, 100]).range([margin.left, W - margin.right]);
    const maxRank = Math.max(8, now.length);
    const y = d3.scaleLinear().domain([1, maxRank]).range([margin.top, H - margin.bottom]);
    const colors = d3.scaleOrdinal().domain(candidates.map(c => c.id)).range(palette);
    const axisX = d3.axisBottom(x).ticks(10).tickFormat(d => d);
    const axisY = d3.axisLeft(y).tickValues(d3.range(1, Math.min(maxRank, 12) + 1));
    svg.append("g").attr("transform", `translate(0,${H - margin.bottom})`).call(axisX);
    svg.append("text").attr("x", (W - margin.right + margin.left) / 2).attr("y", H - 12)
      .attr("text-anchor", "middle").attr("class", "rank-label").text("選択した特徴量の重み（他の特徴量は固定）");
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(axisY);
    svg.append("text").attr("x", 13).attr("y", 25).attr("class", "rank-label").text("順位 ↑");
    const grid = svg.append("g");
    grid.selectAll("line").data(d3.range(1, Math.min(maxRank, 12) + 1)).join("line")
      .attr("x1", margin.left).attr("x2", W - margin.right)
      .attr("y1", d => y(d)).attr("y2", d => y(d))
      .attr("stroke", "#e5eeea").lower();
    const path = d3.line().defined(d => d != null)
      .x(d => x(d.weight)).y(d => y(d.rank)).curve(d3.curveMonotoneX);
    const trajectories = candidates.map(c => ({ recipe: c,
      points: dataset.map(p => {
        const found = p.ranks.find(r => r.id === c.id);
        return found ? { weight: p.weight, rank: found.rank } : null;
      }).filter(Boolean) }));
    const layer = svg.append("g");
    layer.selectAll("path.rank-line").data(trajectories, d => d.recipe.id).join("path")
      .attr("class", "rank-line").attr("stroke", d => colors(d.recipe.id))
      .attr("d", d => path(d.points));
    // 線の右端には現在の推薦順位と料理名を記す。
    svg.append("g").selectAll("text.rank-label").data(candidates, d => d.id).join("text")
      .attr("class", "rank-label").attr("x", W - margin.right + 13)
      .attr("y", (d, i) => margin.top + i * 23 + 8)
      .attr("fill", d => colors(d.id))
      .text((d, i) => `${i + 1}. ${d.name.length > 13 ? d.name.slice(0, 12) + "…" : d.name}`);
    const activeWeight = Number(slider.value);
    const marker = svg.append("g");
    marker.append("line").attr("x1", x(activeWeight)).attr("x2", x(activeWeight))
      .attr("y1", margin.top).attr("y2", H - margin.bottom)
      .attr("stroke", "#d78238").attr("stroke-width", 2).attr("stroke-dasharray", "5,3");
    const active = svg.append("g");
    for (const t of trajectories) {
      // 10刻みの評価点間は線形補間。表示の丸印は正確な現在順位に置く。
      const exactRank = now.findIndex(r => r.id === t.recipe.id) + 1;
      active.append("circle").attr("cx", x(activeWeight)).attr("cy", y(exactRank))
        .attr("r", 5).attr("class", "rank-dot").attr("fill", colors(t.recipe.id));
    }
    const initial = RecipeAtlasCore.rankAll(state.index, state.recipes, state.seed,
      Object.fromEntries(state.index.fields.map(f => [f.key, f.weight])));
    const initialRanks = new Map(initial.map((r, i) => [r.id, i + 1]));
    results.replaceChildren();
    const heading = document.createElement("strong"); heading.textContent = `現在の上位${candidates.length}品（変動は初期設定比）： `;
    results.appendChild(heading);
    const paragraph = document.createElement("span");
    paragraph.textContent = candidates.map((c, i) => {
      const movement = (initialRanks.get(c.id) || (i + 1)) - (i + 1);
      return `${c.name} ${i + 1}位${movement > 0 ? " ↑" + movement : movement < 0 ? " ↓" + (-movement) : " →"}`;
    }).join(" / ");
    results.appendChild(paragraph);
  }
  window.RecipeAtlasWeightLab = { initialize, render };
})();
