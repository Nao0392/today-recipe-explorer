// favorites.js — 保存した料理だけを比較・閲覧するための専用ページ
(() => {
  "use strict";

  const FAVORITES_KEY = "world-recipe-explorer-favorites";
  const STYLE_ORDER = ["和風", "中華", "韓国風", "エスニック", "インド風", "中東風", "洋風", "メキシカン"];
  const STYLE_COLORS = ["#f26b38", "#f2ad3d", "#5bbf9a", "#4aa8c5", "#7c6ed6", "#db6f9f", "#8bbf4a", "#e7794f"];
  const styleColor = d3.scaleOrdinal(STYLE_ORDER, STYLE_COLORS);
  const $ = id => document.getElementById(id);

  const state = {
    data: null,
    favoriteIds: new Set(),
    selectedId: null,
    rendered: [],
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  function readFavoriteIds() {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
      return new Set(Array.isArray(stored) ? stored.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  function writeFavoriteIds() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favoriteIds]));
    } catch (_) {
      // private mode などで保存できない場合も、この表示中の操作は継続する。
    }
  }

  function displayRecipe(recipe) {
    return {
      ...recipe,
      // このページでは「今ある食材」を持ち込まない。食材の有無を推測しない中立状態にする。
      matched: [],
      missing: [],
      seasonal: [],
      servings: null,
      limiting: null,
      coverage: 0,
      reason: null,
    };
  }

  function favoriteRecipes() {
    if (!state.data) return [];
    const order = new Map([...state.favoriteIds].map((id, index) => [id, index]));
    return state.data.recipes
      .filter(recipe => state.favoriteIds.has(String(recipe.id)))
      .map(displayRecipe)
      // localStorage の末尾に新しく登録した料理を、先頭に表示する。
      .sort((a, b) => (order.get(String(b.id)) ?? -1) - (order.get(String(a.id)) ?? -1));
  }

  function recipeDescription(recipe) {
    return String(recipe.text?.description || recipe.description || recipe.catchcopy || "")
      .replace(/\s+/g, " ").trim();
  }

  function photo(recipe, className = "favorite-page-media") {
    const emoji = escapeHtml(recipe.emoji || "🍽️");
    if (!recipe.image) {
      return `<div class="${className} ${className}--emoji" aria-hidden="true">${emoji}</div>`;
    }
    return `<div class="${className}">
      <img src="${escapeHtml(recipe.image)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
      <span class="${className}__fallback" hidden aria-hidden="true">${emoji}</span>
    </div>`;
  }

  function announce(message) {
    $("favorite-live").textContent = "";
    window.requestAnimationFrame(() => { $("favorite-live").textContent = message; });
  }

  function updateCounts(count) {
    $("favorite-total").textContent = count;
    $("favorite-card-count").textContent = count;
    document.title = count ? `お気に入り ${count}件 | 今日のレシピ探索` : "お気に入りの料理 | 今日のレシピ探索";
  }

  function animateRemoval(card) {
    if (!card || !card.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ghost = card.cloneNode(true);
    ghost.classList.add("favorite-page-card--ghost");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      zIndex: "1000",
      pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    const removeGhost = () => ghost.remove();
    const animation = ghost.animate([
      { opacity: 1, transform: "translateY(0) scale(1)" },
      { opacity: 0, transform: "translateY(-10px) scale(.96)" },
    ], { duration: 230, easing: "ease-out", fill: "forwards" });
    animation.onfinish = removeGhost;
    window.setTimeout(removeGhost, 700);
  }

  function updateHeart(button, isFavorite) {
    if (!button) return;
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.setAttribute("aria-label", `${button.dataset.recipeName || "料理"}をお気に入りから削除`);
    button.textContent = isFavorite ? "♥" : "♡";
    button.classList.remove("favorite-pop");
    void button.getBoundingClientRect();
    button.classList.add("favorite-pop");
  }

  function toggleFavorite(id, button) {
    if (!state.favoriteIds.has(id)) return;
    updateHeart(button, false);
    const card = button.closest(".favorite-page-card");
    animateRemoval(card);
    state.favoriteIds.delete(id);
    if (state.selectedId === id) state.selectedId = null;
    writeFavoriteIds();
    render();
    announce(`${button.dataset.recipeName || "料理"}をお気に入りから削除しました`);
  }

  function renderLegend(recipes) {
    const styles = STYLE_ORDER.filter(style => recipes.some(recipe => recipe.style === style));
    d3.select("#favorite-legend").selectAll("span").data(styles, style => style).join(
      enter => enter.append("span").attr("class", "favorite-legend-item")
        .html(style => `<i style="background:${styleColor(style)}"></i>${escapeHtml(style)}`),
      update => update,
      exit => exit.remove(),
    );
  }

  function showTooltip(event, recipe) {
    const tooltip = $("favorite-tooltip");
    tooltip.hidden = false;
    tooltip.innerHTML = `<div class="favorite-tooltip-head">${photo(recipe, "favorite-tooltip-media")}
      <div><b>${escapeHtml(recipe.name)}</b><span>${escapeHtml(recipe.style)}・${escapeHtml(recipe.category)}</span></div></div>
      <p>材料 ${recipe.ingredients.length}品　⏱ ${recipe.time_min}分</p>`;
    const gap = 14;
    const maxX = window.innerWidth - 260;
    const maxY = window.innerHeight - 120;
    tooltip.style.left = `${Math.max(8, Math.min(maxX, event.clientX + gap))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(maxY, event.clientY + gap))}px`;
  }

  function hideTooltip() {
    $("favorite-tooltip").hidden = true;
  }

  function setHover(id = null) {
    d3.select("#favorite-scatter").selectAll("g.favorite-dot").classed("is-hover", recipe => recipe.id === id);
    document.querySelectorAll("#favorite-cards .favorite-page-card")
      .forEach(card => card.classList.toggle("is-hover", card.dataset.recipeId === id));
  }

  function selectRecipe(id) {
    state.selectedId = state.selectedId === id ? null : id;
    render();
  }

  function renderScatter(recipes) {
    const svg = d3.select("#favorite-scatter");
    const svgNode = svg.node();
    const containerWidth = svgNode.parentElement.getBoundingClientRect().width || 900;
    const width = Math.max(640, Math.round(containerWidth));
    const height = width < 700 ? 310 : 365;
    const margin = { top: 30, right: 26, bottom: 46, left: 58 };
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();

    const ingredientCounts = recipes.map(recipe => recipe.ingredients.length);
    const minIngredients = d3.min(ingredientCounts) ?? 0;
    const maxIngredients = d3.max(ingredientCounts) ?? 1;
    const xPadding = minIngredients === maxIngredients ? 1 : .55;
    const x = d3.scaleLinear()
      .domain([Math.max(0, minIngredients - xPadding), maxIngredients + xPadding])
      .range([margin.left, width - margin.right]);
    const yMax = Math.max(10, d3.max(recipes, recipe => recipe.time_min) || 10);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - margin.bottom, margin.top]);
    const xTicks = d3.range(Math.max(0, Math.floor(minIngredients)), Math.ceil(maxIngredients) + 1);
    const yGrid = d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat("");

    svg.append("g").attr("class", "favorite-grid")
      .attr("transform", `translate(${margin.left},0)`).call(yGrid);
    svg.append("g").attr("class", "favorite-axis favorite-axis-x")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(value => `${value}品`));
    svg.append("g").attr("class", "favorite-axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(value => `${value}分`));
    svg.append("text").attr("class", "favorite-axis-label")
      .attr("x", width - margin.right).attr("y", height - 9).attr("text-anchor", "end").text("主な材料の数");
    svg.append("text").attr("class", "favorite-axis-label")
      .attr("x", margin.left).attr("y", 15).text("調理時間");

    const nodes = recipes.map(recipe => ({
      id: recipe.id,
      recipe,
      targetX: x(recipe.ingredients.length),
      targetY: y(recipe.time_min),
      x: x(recipe.ingredients.length),
      y: y(recipe.time_min),
    }));
    const radius = width < 700 ? 15 : 18;
    const simulation = d3.forceSimulation(nodes).randomSource(d3.randomLcg(13)).stop()
      .force("x", d3.forceX(node => node.targetX).strength(.34))
      .force("y", d3.forceY(node => node.targetY).strength(.58))
      .force("collide", d3.forceCollide(radius + 3));
    for (let tick = 0; tick < 160; tick += 1) simulation.tick();
    for (const node of nodes) {
      node.x = Math.max(margin.left + radius, Math.min(width - margin.right - radius, node.x));
      node.y = Math.max(margin.top + radius, Math.min(height - margin.bottom - radius, node.y));
    }

    const dots = svg.append("g").attr("class", "favorite-dots").selectAll("g.favorite-dot")
      .data(nodes.map(node => node.recipe), recipe => recipe.id)
      .join("g")
      .attr("class", recipe => `favorite-dot${recipe.id === state.selectedId ? " selected" : ""}`)
      .attr("transform", recipe => {
        const node = nodes.find(item => item.id === recipe.id);
        return `translate(${node.x},${node.y})`;
      })
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", recipe => `${recipe.name}。材料${recipe.ingredients.length}品、調理${recipe.time_min}分`);
    dots.append("circle").attr("r", radius)
      .attr("fill", recipe => styleColor(recipe.style))
      .attr("fill-opacity", .16)
      .attr("stroke", recipe => styleColor(recipe.style));
    dots.append("text").attr("text-anchor", "middle").attr("dy", ".35em")
      .attr("font-size", Math.round(radius * 1.05)).text(recipe => recipe.emoji || "🍽️");
    dots.on("mouseenter", (event, recipe) => { setHover(recipe.id); showTooltip(event, recipe); })
      .on("mousemove", (event, recipe) => showTooltip(event, recipe))
      .on("mouseleave", () => { setHover(); hideTooltip(); })
      .on("click", (event, recipe) => { event.preventDefault(); selectRecipe(recipe.id); })
      .on("keydown", (event, recipe) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRecipe(recipe.id);
        }
      });

    const selected = recipes.find(recipe => recipe.id === state.selectedId);
    const summary = $("favorite-selection-summary");
    summary.hidden = !selected;
    summary.innerHTML = selected
      ? `<b>選択中:</b> ${escapeHtml(selected.name)} <span>材料 ${selected.ingredients.length}品・調理 ${selected.time_min}分・${escapeHtml(selected.style)}</span>`
      : "";
  }

  function renderCards(recipes) {
    const grid = $("favorite-cards");
    grid.innerHTML = recipes.map(recipe => {
      const description = recipeDescription(recipe);
      const tags = recipe.ingredients.slice(0, 4)
        .map(ingredient => `<span class="favorite-page-chip">${escapeHtml(ingredient.name)}</span>`).join("");
      const href = `search.html?open=${encodeURIComponent(recipe.id)}`;
      return `<article class="favorite-page-card${recipe.id === state.selectedId ? " selected" : ""}" data-recipe-id="${escapeHtml(recipe.id)}">
        <button class="favorite-page-heart is-favorite" type="button" data-favorite-id="${escapeHtml(recipe.id)}" data-recipe-name="${escapeHtml(recipe.name)}" aria-pressed="true" aria-label="${escapeHtml(recipe.name)}をお気に入りから削除">♥</button>
        <a class="favorite-page-card-link" href="${href}" aria-label="${escapeHtml(recipe.name)}の詳細をレシピ探索で開く">
          ${photo(recipe)}
          <div class="favorite-page-card-content">
            <h3>${escapeHtml(recipe.name)}</h3>
            <p class="favorite-page-card-sub">${escapeHtml(recipe.country)}・${escapeHtml(recipe.style)}・${escapeHtml(recipe.category)}</p>
            ${description ? `<p class="favorite-page-card-description">${escapeHtml(description)}</p>` : ""}
            <p class="favorite-page-card-meta">⏱ ${recipe.time_min}分　💰 ¥${recipe.price}　🔥 ${recipe.nutrition.kcal}kcal</p>
            <div class="favorite-page-chips">${tags}</div>
            <p class="favorite-page-card-foot">材料 ${recipe.ingredients.length}品 <span>レシピを見る →</span></p>
          </div>
        </a>
      </article>`;
    }).join("");
  }

  function render() {
    const recipes = favoriteRecipes();
    state.rendered = recipes;
    if (state.selectedId && !recipes.some(recipe => recipe.id === state.selectedId)) state.selectedId = null;
    updateCounts(recipes.length);
    $("favorites-empty-state").hidden = recipes.length !== 0;
    $("favorites-explorer").hidden = recipes.length === 0;
    $("favorite-cards-section").hidden = recipes.length === 0;
    if (!recipes.length) {
      d3.select("#favorite-scatter").selectAll("*").remove();
      $("favorite-legend").replaceChildren();
      $("favorite-selection-summary").hidden = true;
      $("favorite-selection-summary").textContent = "";
      return;
    }
    renderLegend(recipes);
    renderScatter(recipes);
    renderCards(recipes);
  }

  function bindEvents() {
    const grid = $("favorite-cards");
    // カードは再描画されるため、安定したグリッド要素で一度だけ受ける。
    grid.addEventListener("click", event => {
      const button = event.target.closest("[data-favorite-id]");
      if (!button || !grid.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(button.dataset.favoriteId, button);
    });
    grid.addEventListener("pointerover", event => {
      const card = event.target.closest(".favorite-page-card");
      if (card && grid.contains(card) && !card.contains(event.relatedTarget)) setHover(card.dataset.recipeId);
    });
    grid.addEventListener("pointerout", event => {
      const card = event.target.closest(".favorite-page-card");
      if (card && grid.contains(card) && !card.contains(event.relatedTarget)) setHover();
    });

    window.addEventListener("storage", event => {
      if (event.key === FAVORITES_KEY || event.key === null) {
        state.favoriteIds = readFavoriteIds();
        render();
      }
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (state.rendered.length) renderScatter(state.rendered);
      }, 120);
    });
  }

  bindEvents();
  RecipeData.load().then(data => {
    state.data = data;
    state.favoriteIds = readFavoriteIds();
    render();
  }).catch(error => {
    console.error(error);
    $("favorites-empty-state").hidden = false;
    $("favorites-explorer").hidden = true;
    $("favorite-cards-section").hidden = true;
    $("favorites-empty-state").querySelector("h2").textContent = "お気に入りを読み込めませんでした";
    $("favorites-empty-state").querySelector("p:not(.eyebrow)").textContent = "ページを再読み込みして、もう一度お試しください。";
  });
})();
