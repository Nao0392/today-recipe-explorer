/* Recipe navigation: search ⇄ Discovery Atlas. No changes to similarity calculation. */
(() => {
  'use strict';
  const KEY = 'bananamap-search-navigation-v1';
  const $ = id => document.getElementById(id);
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const inputIds = ['ing-input', 'ex-input', 'month', 'sort', 'y-axis', 'x-range',
    'time', 'price', 'kcal', 'protein', 'missing', 'results-page-size',
    'ready-compare-x', 'ready-compare-y', 'tree-level-1', 'tree-level-2',
    'network-limit', 'network-layout'];
  const flags = ['season-only', 'use-substitutes'];
  const sets = ['tools', 'tastes', 'styles', 'categories'];
  const scalars = ['maxTime', 'maxPrice', 'maxKcal', 'minProtein', 'maxMissing',
    'month', 'seasonOnly', 'sort', 'paletteMode', 'yAxis', 'xRangeMax',
    'discoveryView', 'compareXAxis', 'compareYAxis'];

  function saveSearchState() {
    if (typeof state === 'undefined' || !Array.isArray(state.recipes) || !state.recipes.length) return;
    const inputs = Object.fromEntries(inputIds.filter(id => $(id)).map(id => [id, $(id).value]));
    const checks = Object.fromEntries(flags.filter(id => $(id)).map(id => [id, $(id).checked]));
    const setValues = Object.fromEntries(sets.map(key => [key, [...state[key]]]));
    const values = Object.fromEntries(scalars.map(key => [key, state[key]]));
    const snapshot = {
      at: Date.now(), inputs, checks, sets: setValues, values,
      amounts: [...state.amounts], selected: state.selected,
      compareIds: [...state.compareIds],
      resultPage: typeof resultPage === 'number' ? resultPage : 0,
      resultPageSize: typeof resultPageSize === 'number' ? resultPageSize : 8,
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(snapshot)); }
    catch (error) { console.warn('[navigation] search context not saved', error); }
  }

  function restoreSearchState() {
    if (new URLSearchParams(location.search).get('from') !== 'atlas') return;
    if (typeof state === 'undefined' || !state.recipes?.length) return;
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return; }
    if (!saved || Date.now() - saved.at > 60 * 60 * 1000) return;

    for (const [id, value] of Object.entries(saved.inputs || {})) {
      if ($(id)) $(id).value = value;
    }
    for (const [id, value] of Object.entries(saved.checks || {})) {
      if ($(id)) $(id).checked = Boolean(value);
    }
    for (const key of scalars) {
      if (Object.hasOwn(saved.values || {}, key)) state[key] = saved.values[key];
    }
    for (const key of sets) {
      if (Array.isArray(saved.sets?.[key])) state[key] = new Set(saved.sets[key]);
    }
    if (Array.isArray(saved.amounts)) state.amounts = new Map(saved.amounts);
    if (Array.isArray(saved.compareIds)) state.compareIds = new Set(saved.compareIds);

    const matchingIds = new Set(state.recipes.map(recipe => String(recipe.id)));
    const requested = new URLSearchParams(location.search).get('open');
    const selected = matchingIds.has(String(requested)) ? requested : saved.selected;
    state.selected = selected != null && matchingIds.has(String(selected)) ? String(selected) : null;

    // Restore filter logic without pretending that setting an input fires an event.
    readHave(); readExclude();
    document.querySelectorAll('input[name="pmode"]').forEach(input => {
      input.checked = input.value === state.paletteMode;
    });
    for (const [id, key] of [['categories','categories'], ['styles','styles'], ['tastes','tastes']]) {
      $(id)?.querySelectorAll('button').forEach(button =>
        button.classList.toggle('on', state[key].has(button.textContent.trim())));
    }
    $('tools')?.querySelectorAll('label').forEach(label => {
      const input = label.querySelector('input[type="checkbox"]');
      if (input) input.checked = state.tools.has(label.textContent.trim());
    });
    // A fresh page starts with a new pagination/signature cache.
    resultPageSize = [8,16,24].includes(Number(saved.resultPageSize)) ? Number(saved.resultPageSize) : 8;
    if ($('results-page-size')) $('results-page-size').value = String(resultPageSize);
    lastAmountKey = '';
    refresh();
    // The initial refresh initializes the ready-ranking cache; reinstate comparisons afterwards.
    if (Array.isArray(saved.compareIds)) {
      state.compareIds = new Set(saved.compareIds.map(String).filter(id => matchingIds.has(id)));
      refresh();
    }
    resultPage = Math.max(0, Number(saved.resultPage) || 0);
    renderPagedRows(visibleRows, visibleHasInput, state.selected);
    // The saved data applies only to this one explicit Atlas return.
    try { sessionStorage.removeItem(KEY); } catch (_) { /* storage can be unavailable */ }
  }

  function searchPage() {
    document.addEventListener('click', event => {
      const link = event.target instanceof Element && event.target.closest('a[href*="atlas-discovery.html"]');
      if (!link) return;
      saveSearchState();
      const url = new URL(link.getAttribute('href'), location.href);
      const id = state.selected || $('vector-seed')?.value;
      if (id && id !== 'undefined') url.searchParams.set('seed', String(id));
      link.href = url.href;
    });
    // app.js registers RecipeData.load().then(init) before this file is executed.
    if (new URLSearchParams(location.search).get('from') === 'atlas') {
      RecipeData.load().then(() => restoreSearchState())
        .catch(error => console.warn('[navigation] restore postponed:', error));
    }
  }

  function atlasPage() {
    // Read the current seed at click-time: the Atlas can change its center interactively.
    document.addEventListener('click', event => {
      const link = event.target instanceof Element && event.target.closest('a[href]');
      if (!link || !link.getAttribute('href')?.startsWith('search.html')) return;
      const url = new URL(link.getAttribute('href'), location.href);
      url.searchParams.set('from', 'atlas');
      const seed = new URLSearchParams(location.search).get('seed');
      if (!url.searchParams.has('open') && seed) url.searchParams.set('open', seed);
      link.href = url.href;
    });
  }

  if (currentPage === 'search.html') searchPage();
  if (currentPage === 'atlas-discovery.html') atlasPage();
})();
