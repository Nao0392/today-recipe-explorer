/**
 * atlas.js — bounded, on-demand similarity matrix for Recipe Similarity Atlas.
 *
 * Design constraints:
 * - All recipes remain available in the selectors and 7-feature similarity index.
 * - Only the seed, inspected recipe, and closest neighbours form the drawn matrix.
 * - The original RecipeVectorCore and RecipeAtlasCore formulas remain untouched.
 * - Ranking sweep is rendered only when the user opens the analysis section.
 */
(function () {
  'use strict';
  const get = id => document.getElementById(id);
  const state = {
    recipes: [], index: null, byId: new Map(), matrix: null,
    seed: null, target: null, weights: {}, displayLimit: 32,
    sourceCount: 0
  };
  const network = window.RecipeAtlasNetwork || null;
  const weightLab = window.RecipeAtlasWeightLab || null;
  let labOpen = false;

  function div(parent, cls, content) {
    const el = document.createElement('div');
    if (cls) el.className = cls;
    el.textContent = content;
    parent.appendChild(el);
    return el;
  }

  function renderExplanation() {
    const root = get('atlas-explain');
    root.replaceChildren();
    const comparison = state.index.compareIds(state.seed, state.target, state.weights);
    if (!comparison) return;
    const a = state.byId.get(state.seed), b = state.byId.get(state.target);
    const summary = div(root, 'score-card', '');
    div(summary, '', `${a.name} × ${b.name}`);
    div(summary, 'total-score', comparison.score == null ? '比較不可' : `${(comparison.score * 100).toFixed(1)}%`);
    div(summary, '', `データ充足率：${(100 * (comparison.coverage || 0)).toFixed(0)}%`);
    div(summary, '', '類似度は好みの一致確率ではありません。');
    const fields = div(root, 'dim-list', '');
    for (const d of comparison.dimensions) {
      const row = div(fields, 'dim-row', '');
      div(row, '', d.label);
      const track = div(row, 'dim-track', ''), bar = div(track, 'dim-fill', '');
      bar.style.background = d.color;
      bar.style.width = d.similarity == null ? '0%' : `${100 * d.similarity}%`;
      const contribution = d.contribution == null ? 0 : d.contribution;
      div(row, 'dim-value', d.similarity == null ? '欠損' : `${(100 * d.similarity).toFixed(0)}% / +${(100 * contribution).toFixed(1)}pt`);
    }
    div(root, 'common-ingredients', '共通する食材：' + (comparison.commonIngredients.join('、') || 'なし'));
  }

  // This full-dataset comparison is O(n), unlike an all-pairs matrix (O(n²)).
  function chooseDisplayedRecipes() {
    const selected = new Set([state.seed, state.target]);
    const ids = [...selected];
    // Existing shared engine ranks all recipes by the same seven dimensions.
    for (const item of RecipeAtlasCore.rankAll(state.index, state.recipes, state.seed, state.weights)) {
      if (ids.length >= state.displayLimit) break;
      if (selected.has(item.id)) continue;
      selected.add(item.id);
      ids.push(item.id);
    }
    // Include recipes that cannot be compared, only when needed to fill a small dataset.
    if (ids.length < Math.min(state.displayLimit, state.recipes.length)) {
      for (const recipe of state.recipes) {
        if (ids.length >= state.displayLimit) break;
        const id = String(recipe.id);
        if (!selected.has(id)) { selected.add(id); ids.push(id); }
      }
    }
    return ids.map(id => state.byId.get(id)).filter(Boolean);
  }

  function renderMatrix() {
    const { matrix, byId } = state;
    if (!matrix) return;
    const n = matrix.ids.length, cell = n > 48 ? 14 : n > 32 ? 17 : 22;
    const left = 146, top = 146;
    const order = RecipeAtlasCore.order(chooseRecipesInMatrix(), matrix, get('matrix-order').value);
    const svg = d3.select('#atlas-matrix')
      .attr('width', left + n * cell + 20)
      .attr('height', top + n * cell + 20);
    const color = d3.scaleSequential().domain([0, 1]).interpolator(d3.interpolate('#fff1e5', '#b54f25'));
    const name = id => byId.get(id)?.name || id;
    const rows = order.map((i, row) => ({ i, row, id: matrix.ids[i] }));
    const cells = [];
    for (const y of rows) for (const x of rows) {
      cells.push({ x: x.row, y: y.row, seed: y.id, target: x.id, score: matrix.values[y.i][x.i] });
    }
    const squares = svg.selectAll('rect.atlas-cell')
      .data(cells, d => `${d.seed}/${d.target}`)
      .join('rect')
      .attr('class', d => 'atlas-cell' + (d.seed === state.seed && d.target === state.target ? ' selected' : ''))
      .attr('x', d => left + d.x * cell).attr('y', d => top + d.y * cell)
      .attr('width', cell - 1).attr('height', cell - 1).attr('rx', 2)
      .attr('fill', d => d.score === null ? '#ded8d1' : color(d.score))
      .attr('tabindex', d => d.seed === state.seed && d.target === state.target ? 0 : -1)
      .attr('role', 'button')
      .attr('aria-label', d => `${name(d.seed)} と ${name(d.target)}：${d.score === null ? '比較不可' : (d.score * 100).toFixed(1) + '%'}`)
      .on('click', (_, d) => selectPair(d.seed, d.target))
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPair(d.seed, d.target); }
      });
    squares.selectAll('title').data(d => [d]).join('title')
      .text(d => `${name(d.seed)} × ${name(d.target)}：${d.score === null ? '比較不可' : (d.score * 100).toFixed(1) + '%'}`);
    svg.selectAll('text.atlas-row').data(rows, d => d.id).join('text')
      .attr('class', 'atlas-text atlas-row').attr('x', left - 7)
      .attr('y', d => top + d.row * cell + cell * .73).attr('text-anchor', 'end')
      .text(d => name(d.id).slice(0, 13)).on('click', (_, d) => selectPair(d.id, state.target));
    svg.selectAll('text.atlas-column').data(rows, d => d.id).join('text')
      .attr('class', 'atlas-text atlas-column')
      .attr('transform', d => `translate(${left + d.row * cell + cell / 2},${top - 7}) rotate(-64)`)
      .text(d => name(d.id).slice(0, 13)).on('click', (_, d) => selectPair(state.seed, d.id));
  }

  function chooseRecipesInMatrix() {
    return state.matrix.ids.map(id => state.byId.get(id));
  }

  function highlightSelection() {
    d3.select('#atlas-matrix').selectAll('rect.atlas-cell')
      .classed('selected', d => d.seed === state.seed && d.target === state.target)
      .attr('tabindex', d => d.seed === state.seed && d.target === state.target ? 0 : -1);
  }

  function updateStatistics() {
    const m = state.matrix.ids.length;
    get('atlas-count').textContent = `${state.recipes.length}品から ${m}品を表示 / ${m * m}セル`;
    get('matrix-scope').textContent = `全${state.recipes.length}品は選択・検索可能。基準料理と比較料理を含む、近い${m}品だけをヒートマップに描画（${m * m}セル）。全件の計算式は変更していません。`;
  }

  function redraw() {
    if (!state.index) return;
    const displayed = chooseDisplayedRecipes();
    state.matrix = RecipeAtlasCore.matrix(state.index, displayed, state.weights);
    renderMatrix();
    renderExplanation();
    updateStatistics();
    if (network) network.render(state, actions);
    if (weightLab && labOpen) weightLab.render(state, actions);
  }

  function selectPair(seed, target) {
    const a = String(seed), b = String(target);
    if (!state.byId.has(a) || !state.byId.has(b)) return;
    const seedChanged = a !== state.seed;
    state.seed = a;
    state.target = b;
    get('atlas-seed').value = a;
    get('atlas-target').value = b;
    // Avoid recomputing even the small matrix when only a displayed target changed.
    if (!seedChanged && state.matrix?.ids.includes(b)) {
      highlightSelection();
      renderExplanation();
      return;
    }
    redraw();
  }

  function setWeights(partial) {
    state.weights = { ...state.weights, ...partial };
    redraw();
  }

  const actions = { selectPair, setWeights, getState: () => state };

  function initialize() {
    return RecipeData.load().then(data => {
      state.recipes = (data.recipes || []).filter(r => r && r.id != null);
      if (state.recipes.length < 2) throw new Error('レシピが2件以上必要です。');
      state.byId = new Map(state.recipes.map(r => [String(r.id), r]));
      state.index = RecipeVectorCore.createIndex(state.recipes);
      state.weights = Object.fromEntries(state.index.fields.map(field => [field.key, field.weight]));
      state.seed = String(state.recipes[0].id);
      state.target = String(state.recipes[1].id);
      for (const key of ['atlas-seed', 'atlas-target']) {
        const select = get(key);
        state.recipes.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'))
          .forEach(recipe => {
            const option = document.createElement('option');
            option.value = String(recipe.id);
            option.textContent = recipe.name;
            select.appendChild(option);
          });
        select.disabled = false;
      }
      get('atlas-seed').value = state.seed;
      get('atlas-target').value = state.target;
      get('atlas-seed').addEventListener('change', () => selectPair(get('atlas-seed').value, state.target));
      get('atlas-target').addEventListener('change', () => selectPair(state.seed, get('atlas-target').value));
      get('matrix-order').addEventListener('change', renderMatrix);
      get('matrix-size').addEventListener('change', event => {
        state.displayLimit = Number(event.target.value);
        redraw();
      });
      if (network) network.initialize(state, actions);
      if (weightLab) {
        weightLab.initialize(state, actions);
        get('lab-panel').hidden = true;
        get('lab-toggle').addEventListener('click', () => {
          labOpen = !labOpen;
          get('lab-panel').hidden = !labOpen;
          get('lab-toggle').textContent = labOpen ? '重み・順位分析を閉じる ↑' : '重み・順位分析を開く ↓';
          get('lab-toggle').setAttribute('aria-expanded', String(labOpen));
          if (labOpen) weightLab.render(state, actions);
        });
      } else get('lab-toggle').hidden = true;
      redraw();
    });
  }
  initialize().catch(error => {
    console.error(error);
    get('atlas-error').hidden = false;
    get('atlas-error').textContent = `画面を初期化できませんでした。data/delish_teiban_photo.jsonとスクリプトを確認してください。 ${error.message}`;
    get('atlas-count').textContent = '読み込み失敗';
  });
})();
