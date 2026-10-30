(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const MAX_TIME = 120;
  const DETAIL_ZOOM = 2;
  const STYLE_COLORS = new Map([
    ["和風", "#d65f45"], ["洋風", "#4f8ed8"], ["中華", "#d9a72e"], ["韓国風", "#45a668"],
    ["エスニック", "#9564bf"], ["インド風", "#cf7544"], ["中東風", "#7b985b"], ["メキシカン", "#d65d87"]
  ]);
  const FALLBACK_COLOR = "#75869a";
  const state = { recipes: [], aliases: new Map(), visible: [], selected: null, transform: d3.zoomIdentity, zoom: null, draw: null, pointPositions: new Map() };

  const normalize = value => String(value || "").normalize("NFKC").trim().toLowerCase();
  const stable = value => {
    let hash = 2166136261;
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967295;
  };
  const readIngredients = () => new Set($("have-input").value.split(/[、,，\s]+/).filter(Boolean).map(name => state.aliases.get(normalize(name))).filter(Boolean));
  const missingCount = (recipe, have) => [...new Set((recipe.ingredients || []).map(item => item.name).filter(Boolean))].filter(name => !have.has(name)).length;
  const pointColor = recipe => STYLE_COLORS.get(recipe.style) || FALLBACK_COLOR;

  function prepare() {
    const have = readIngredients();
    const requested = $("missing-limit").value;
    const raw = state.recipes.map(recipe => ({ ...recipe, missing: missingCount(recipe, have) }))
      .filter(recipe => Number.isFinite(recipe.time_min) && recipe.time_min >= 0 && recipe.time_min <= MAX_TIME);
    const maxMissing = requested === "all" ? d3.max(raw, recipe => recipe.missing) || 0 : Number(requested);
    state.visible = raw.filter(recipe => recipe.missing <= maxMissing).sort((a, b) => stable(a.id) - stable(b.id));
    state.maxMissing = Math.max(1, maxMissing);
    $("count").replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = `${state.visible.length.toLocaleString("ja-JP")}件`;
    $("count").append("全 ", strong, " を表示対象にしています");
  }

  function showTooltip(event, recipe) {
    const tooltip = $("tooltip"), wrap = $("chart-wrap").getBoundingClientRect();
    tooltip.replaceChildren();
    const title = document.createElement("strong"); title.textContent = recipe.name;
    const meta = document.createElement("span"); meta.textContent = `${recipe.style || "分類なし"}・${recipe.category || "分類なし"}　調理 ${recipe.time_min}分`;
    const detail = document.createElement("span"); detail.textContent = `足りない食材 ${recipe.missing}個・使う材料 ${(recipe.ingredients || []).length}品`;
    tooltip.append(title, meta, document.createElement("br"), detail);
    tooltip.hidden = false;
    const width = tooltip.offsetWidth || 230, height = tooltip.offsetHeight || 70;
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX - wrap.left + 12, wrap.width - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(event.clientY - wrap.top + 12, wrap.height - height - 8))}px`;
  }
  const hideTooltip = () => { $("tooltip").hidden = true; };

  function layout(recipes, X, Y, radius) {
    // 同じ値の料理を規則正しい格子にはせず、マスの中で少し不規則に広げる。
    // 位置は ID から決まるので、描き直しても大きくちらつかない。
    const positions = new Map();
    const groups = d3.group(recipes, recipe => `${recipe.missing}|${Math.min(7, Math.floor(recipe.time_min / 15))}`);
    groups.forEach(group => {
      const sample = group[0], bucket = Math.min(7, Math.floor(sample.time_min / 15));
      const cellWidth = Math.abs(X(sample.missing + .5) - X(sample.missing - .5)) * .82;
      const cellHeight = Math.abs(Y(bucket * 15) - Y((bucket + 1) * 15)) * .82;
      const centerX = X(sample.missing), centerY = Y(bucket * 15 + 7.5);
      const left = centerX - cellWidth / 2 + radius, right = centerX + cellWidth / 2 - radius;
      const top = centerY - cellHeight / 2 + radius, bottom = centerY + cellHeight / 2 - radius;
      const nodes = group.map(recipe => {
        const targetX = centerX + (stable(`${recipe.id}:x`) - .5) * cellWidth * .76;
        const targetY = centerY + (stable(`${recipe.id}:y`) - .5) * cellHeight * .76;
        return { recipe, targetX, targetY, x: targetX, y: targetY };
      });
      const simulation = d3.forceSimulation(nodes).randomSource(d3.randomLcg(.618))
        .force("x", d3.forceX(node => node.targetX).strength(.17))
        .force("y", d3.forceY(node => node.targetY).strength(.17))
        .force("collide", d3.forceCollide(radius + 1.4).iterations(2))
        .stop();
      for (let tick = 0; tick < 140; tick += 1) {
        simulation.tick();
        nodes.forEach(node => {
          node.x = Math.max(left, Math.min(right, node.x));
          node.y = Math.max(top, Math.min(bottom, node.y));
        });
      }
      nodes.forEach(node => {
        positions.set(node.recipe.id, [node.x, node.y]);
      });
    });
    return positions;
  }

  function renderLegend() {
    const legend = $("legend");
    legend.replaceChildren();
    [...new Set(state.visible.map(recipe => recipe.style).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).forEach(style => {
      const item = document.createElement("span"), dot = document.createElement("i");
      dot.style.setProperty("--style-color", STYLE_COLORS.get(style) || FALLBACK_COLOR);
      item.append(dot, style);
      legend.append(item);
    });
  }

  function render() {
    const svg = d3.select("#chart"), element = svg.node();
    const width = Math.max(340, Math.floor(element.getBoundingClientRect().width || 900));
    const height = width < 600 ? 390 : 470;
    const margin = { top: 24, right: 22, bottom: 54, left: 62 };
    const x0 = d3.scaleLinear().domain([-.5, state.maxMissing + .5]).range([margin.left, width - margin.right]);
    const y0 = d3.scaleLinear().domain([MAX_TIME + .5, -.5]).range([margin.top, height - margin.bottom]);
    const columns = d3.range(0, state.maxMissing + 1);
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("height", height);

    const edges = d3.range(0, MAX_TIME + 16, 15);
    const cells = [];
    for (const column of columns) for (let index = 0; index < edges.length - 1; index += 1) {
      const low = edges[index], high = edges[index + 1];
      const recipes = state.visible.filter(recipe => recipe.missing === column && recipe.time_min >= low && (index === edges.length - 2 ? recipe.time_min <= high : recipe.time_min < high));
      if (recipes.length) cells.push({ column, low, high, count: recipes.length });
    }
    const density = d3.scaleSequentialSqrt([0, d3.max(cells, cell => cell.count) || 1], d3.interpolateRgb("#fff3e6", "#d9632b"));
    const defs = svg.selectAll("defs").data([0]).join("defs");
    defs.selectAll("clipPath").data([0]).join("clipPath").attr("id", "point-prototype-clip").selectAll("rect").data([0]).join("rect")
      .attr("x", margin.left).attr("y", margin.top).attr("width", width - margin.left - margin.right).attr("height", height - margin.top - margin.bottom);
    const background = svg.selectAll("g.background").data([0]).join("g").attr("class", "background").attr("clip-path", "url(#point-prototype-clip)");
    const foreground = svg.selectAll("g.foreground").data([0]).join("g").attr("class", "foreground").attr("clip-path", "url(#point-prototype-clip)");
    const axisX = svg.selectAll("g.axis-x").data([0]).join("g").attr("class", "axis axis-x");
    const axisY = svg.selectAll("g.axis-y").data([0]).join("g").attr("class", "axis axis-y");
    const label = svg.selectAll("text.axis-label").data([0]).join("text").attr("class", "axis-label");
    const zoomLabel = svg.selectAll("text.zoom-label").data([0]).join("text").attr("class", "zoom-label").attr("text-anchor", "end");

    function draw(transform, settled) {
      const X = transform.rescaleX(x0), Y = transform.rescaleY(y0), expanded = transform.k >= DETAIL_ZOOM;
      state.transform = transform;
      axisX.attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(X).tickValues(columns.filter(value => X(value) >= margin.left && X(value) <= width - margin.right)).tickFormat(value => value === 0 ? "0個（今すぐ）" : `${value}個`));
      axisY.attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(Y).tickValues([0, 30, 60, 90, 120].filter(value => Y(value) >= margin.top && Y(value) <= height - margin.bottom)).tickFormat(value => `${value}分`));
      label.attr("x", width - margin.right).attr("y", height - 13).attr("text-anchor", "end").text("足りない食材の数");
      zoomLabel.attr("x", width - margin.right).attr("y", margin.top + 15).text(transform.k > 1.01 ? `${transform.k.toFixed(1)}倍` : "");

      background.selectAll("line.grid").data([0, 30, 60, 90, 120]).join("line").attr("class", "grid").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", value => Y(value)).attr("y2", value => Y(value));
      background.selectAll("rect.cell").data(cells).join("rect").attr("class", "cell")
        .attr("x", cell => X(cell.column - .5) + 1).attr("y", cell => Y(cell.high) + 1)
        .attr("width", cell => Math.max(0, X(cell.column + .5) - X(cell.column - .5) - 2)).attr("height", cell => Math.max(0, Y(cell.low) - Y(cell.high) - 2))
        .attr("rx", 3).attr("fill", cell => density(cell.count)).attr("opacity", expanded ? .35 : .9)
        .on("mouseenter", (event, cell) => { if (!expanded) showTooltip(event, { name: `${cell.column}個・${cell.low}〜${cell.high}分`, style: `${cell.count}件`, category: "この範囲の料理", time_min: "", missing: "", ingredients: [] }); })
        .on("mouseleave", hideTooltip)
        .on("click", (event, cell) => {
          const zoom = Math.max(transform.k, 3), centerX = x0(cell.column), centerY = y0((cell.low + cell.high) / 2);
          svg.transition().duration(360).call(state.zoom.transform, d3.zoomIdentity.translate((margin.left + width - margin.right) / 2, (margin.top + height - margin.bottom) / 2).scale(zoom).translate(-centerX, -centerY));
        });
      background.selectAll("text.cell-count").data(expanded ? [] : cells.filter(cell => X(cell.column + .5) - X(cell.column - .5) > 34)).join("text").attr("class", "cell-count")
        .classed("dark", cell => cell.count > density.domain()[1] * .48).attr("x", cell => X(cell.column + .5) - 7).attr("y", cell => Y(cell.high) + 14).attr("text-anchor", "end").text(cell => cell.count);

      const viewport = recipe => X(recipe.missing) >= margin.left - 12 && X(recipe.missing) <= width - margin.right + 12 && Y(recipe.time_min) >= margin.top - 12 && Y(recipe.time_min) <= height - margin.bottom + 12;
      const topCount = Number($("top-limit").value);
      const shown = (expanded ? state.visible.filter(viewport) : state.visible.slice(0, topCount));
      // 拡大後は点も徐々に大きくして、密集した場所でも押しやすくする。
      const radius = expanded ? Math.min(10, 5 + (transform.k - DETAIL_ZOOM) * 1.1) : 5;
      const cached = new Map([...state.pointPositions].map(([id, point]) => [id, [transform.applyX(point[0]), transform.applyY(point[1])]]));
      let positions;
      if (settled) {
        positions = layout(shown, X, Y, radius);
        state.pointPositions = new Map([...positions].map(([id, point]) => [id, [transform.invertX(point[0]), transform.invertY(point[1])]]));
      } else positions = new Map(shown.map(recipe => [recipe.id, cached.get(recipe.id) || [X(recipe.missing), Y(recipe.time_min)]]));
      const dots = foreground.selectAll("circle.recipe-point").data(shown, recipe => recipe.id).join("circle").attr("class", "recipe-point")
        .attr("cx", recipe => positions.get(recipe.id)[0]).attr("cy", recipe => positions.get(recipe.id)[1]).attr("r", radius)
        .attr("fill", pointColor).attr("fill-opacity", expanded ? .56 : .66).attr("stroke", "#fff").attr("stroke-opacity", expanded ? .72 : .82).attr("stroke-width", expanded ? .75 : 1.2)
        .classed("selected", recipe => recipe.id === state.selected)
        .on("mouseenter", (event, recipe) => showTooltip(event, recipe)).on("mousemove", (event, recipe) => showTooltip(event, recipe)).on("mouseleave", hideTooltip)
        .on("click", (event, recipe) => { event.stopPropagation(); state.selected = recipe.id; $("selected").hidden = false; $("selected").textContent = `選択中：${recipe.name}（調理 ${recipe.time_min}分・足りない食材 ${recipe.missing}個）`; draw(transform, false); });
      if (state.selected) dots.filter(recipe => recipe.id === state.selected).raise();
    }

    if (!state.zoom) {
      state.zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", event => draw(event.transform, false)).on("end", event => draw(event.transform, true));
      svg.call(state.zoom).on("dblclick.zoom", null);
    }
    state.zoom.extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]).translateExtent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);
    state.draw = draw;
    draw(state.transform, true);
  }

  function refresh() {
    prepare();
    renderLegend();
    state.transform = d3.zoomIdentity;
    state.pointPositions.clear();
    if (state.zoom) d3.select("#chart").property("__zoom", d3.zoomIdentity);
    render();
  }

  RecipeData.load().then(data => {
    state.recipes = data.recipes;
    Object.entries(data.ingredients || {}).forEach(([name, info]) => {
      state.aliases.set(normalize(name), name);
      (info.aliases || []).forEach(alias => state.aliases.set(normalize(alias), name));
    });
    refresh();
    $("have-input").addEventListener("change", refresh);
    $("missing-limit").addEventListener("change", refresh);
    $("top-limit").addEventListener("change", () => state.draw?.(state.transform, true));
    $("zoom-in").addEventListener("click", () => d3.select("#chart").transition().duration(240).call(state.zoom.scaleBy, 1.6));
    $("zoom-out").addEventListener("click", () => d3.select("#chart").transition().duration(240).call(state.zoom.scaleBy, 1 / 1.6));
    $("zoom-reset").addEventListener("click", () => d3.select("#chart").transition().duration(240).call(state.zoom.transform, d3.zoomIdentity));
    let timer; window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  }).catch(error => { $("count").textContent = `料理データを読み込めませんでした: ${error.message}`; });
})();
