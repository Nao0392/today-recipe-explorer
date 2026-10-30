/**
 * atlas-network.js — 料理間の強い類似関係をD3 forceSimulationで可視化する。
 * 線の太さは類似度、ノードの色はレシピの料理区分を表す。
 */
(function () {
  "use strict";
  const root = document.getElementById("network-panel");
  if (!root || !window.d3 || !window.RecipeAtlasCore) return;
  const svg = d3.select("#atlas-network");
  const threshold = document.getElementById("network-threshold");
  const label = document.getElementById("threshold-label");
  const message = document.getElementById("network-message");
  const W = 1020, H = 570;
  const palette = ["#eebf32", "#70bd93", "#fe8a65", "#7dbbd3", "#a98de8", "#c8a9cb", "#c89a65"];
  let simulation = null, state = null, actions = null;
  svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
  const edgeLayer = svg.append("g"), nodeLayer = svg.append("g"), textLayer = svg.append("g");
  function initialize(current, callbacks) {
    state = current; actions = callbacks;
    root.hidden = false;
    threshold.addEventListener("input", () => {
      label.textContent = `${Math.round(100 * Number(threshold.value))}%`;
      render(state, actions);
    });
    label.textContent = `${Math.round(100 * Number(threshold.value))}%`;
  }
  function render(current, callbacks) {
    state = current; actions = callbacks;
    if (simulation) simulation.stop();
    const cutoff = Number(threshold.value);
    // 可視性を優先して最大120料理まで表示。間引き数は必ず画面に示す。
    const maxNodes = 120;
    const ids = state.matrix.ids.slice(0, maxNodes);
    const idSet = new Set(ids);
    const edges = RecipeAtlasCore.links(state.matrix, cutoff, 6)
      .filter(e => idSet.has(e.source) && idSet.has(e.target));
    const categories = [...new Set(ids.map(id => String(state.byId.get(id)?.category || "不明")))].sort();
    const color = d3.scaleOrdinal().domain(categories).range(palette);
    const nodes = ids.map(id => {
      const recipe = state.byId.get(id);
      return { id, name: recipe?.name || id, category: String(recipe?.category || "不明") };
    });
    const lines = edgeLayer.selectAll("line.network-edge").data(edges, d => d.source + "-" + d.target)
      .join("line").attr("class", "network-edge")
      .attr("stroke-width", d => 1 + 8 * Math.pow(d.score, 3));
    const circles = nodeLayer.selectAll("circle.network-node").data(nodes, d => d.id)
      .join("circle").attr("class", d => "network-node" + (d.id === state.seed ? " selected" : ""))
      .attr("r", d => d.id === state.seed ? 11 : 7)
      .attr("fill", d => color(d.category))
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", d => `${d.name}、${d.category}`)
      .on("click", (_, d) => actions.selectPair(state.seed, d.id))
      .on("dblclick", (event, d) => { event.preventDefault(); actions.selectPair(d.id, state.target); })
      .on("keydown", (event, d) => {
        if (event.key === "Enter") { event.preventDefault(); actions.selectPair(state.seed, d.id); }
      });
    circles.selectAll("title").data(d => [d]).join("title")
      .text(d => `${d.name}（${d.category}） / クリック：比較 / ダブルクリック：基準に変更`);
    const labels = textLayer.selectAll("text.network-label").data(nodes, d => d.id)
      .join("text").attr("class", "network-label")
      .text(d => d.name.length > 12 ? d.name.slice(0, 11) + "…" : d.name);
    const edgeNodes = edges.map(e => ({ ...e }));
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edgeNodes).id(d => d.id)
        .distance(d => 140 - 75 * d.score).strength(d => 0.08 + d.score * 0.3))
      .force("charge", d3.forceManyBody().strength(-240))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide(25))
      .on("tick", () => {
        lines.data(edgeNodes).attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        circles.attr("cx", d => d.x).attr("cy", d => d.y);
        labels.attr("x", d => d.x + 11).attr("y", d => d.y + 4);
      });
    circles.call(d3.drag()
      .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));
    message.textContent = `表示：${nodes.length}料理 / ${edges.length}関係（閾値 ${Math.round(cutoff * 100)}% 以上、各料理6本まで）。`
      + (state.matrix.ids.length > maxNodes ? `全${state.matrix.ids.length}料理のうち先頭${maxNodes}料理を可視化。` : "")
      + "ノードをドラッグして配置を調整できます。";
  }
  window.RecipeAtlasNetwork = { initialize, render };
})();
