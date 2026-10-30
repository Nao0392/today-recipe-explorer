// お気に入りレシピの共通する食材・特徴から、既存の7次元類似度で推薦する。
(() => {
  'use strict';
  const KEY = 'world-recipe-explorer-favorites';
  const $ = id => document.getElementById(id);
  let recipes = [], index;

  function savedIds() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch { return new Set(); }
  }

  function card(item) {
    const { recipe, score, ingredients } = item;
    const article = document.createElement('article');
    article.className = 'favrec-card';
    const link = document.createElement('a');
    link.href = `search.html?open=${encodeURIComponent(recipe.id)}`;
    link.className = 'favrec-link';
    if (recipe.image) {
      const img = document.createElement('img');
      img.src = recipe.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      link.append(img);
    }
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = recipe.name;
    const rate = document.createElement('span');
    rate.className = 'favrec-score';
    rate.textContent = `類似度 ${(score * 100).toFixed(1)}%`;
    const explanation = document.createElement('small');
    explanation.textContent = ingredients.length
      ? `お気に入りと共通する食材: ${ingredients.join('・')}`
      : '食材以外の特徴（味・時間など）が近い料理';
    info.append(title, rate, explanation);
    link.append(info);
    article.append(link);
    return article;
  }

  function render() {
    if (!index) return;
    const saved = savedIds();
    const favorites = recipes.filter(r => saved.has(String(r.id)));
    const section = $('favorite-recommendations');
    section.hidden = favorites.length === 0;
    if (!favorites.length) return;

    const frequency = new Map();
    for (const recipe of favorites) {
      for (const name of new Set((recipe.ingredients || []).map(i => i.name))) {
        frequency.set(name, (frequency.get(name) || 0) + 1);
      }
    }
    const frequent = [...frequency].sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('favrec-ingredients').textContent = 'よく使われる食材: ' + frequent.map(([name]) => name).join('・');

    const ranked = recipes.filter(r => !saved.has(String(r.id))).map(recipe => {
      let sum = 0, weightSum = 0;
      for (const favorite of favorites) {
        const result = index.compareIds(favorite.id, recipe.id);
        if (result?.score == null || result.coverage <= 0) continue;
        // 特徴の欠損が多い組み合わせの影響を減らす。
        sum += result.score * result.coverage;
        weightSum += result.coverage;
      }
      const ingredients = [...new Set((recipe.ingredients || []).map(i => i.name))]
        .filter(name => frequency.has(name))
        .sort((a, b) => frequency.get(b) - frequency.get(a)).slice(0, 4);
      return { recipe, score: weightSum ? sum / weightSum : -1, ingredients };
    }).filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name, 'ja'))
      .slice(0, 8);

    const list = $('favrec-list');
    list.replaceChildren(...ranked.map(card));
    $('favrec-summary').textContent = `${favorites.length}件のお気に入りをもとに推薦 · 上位${ranked.length}件`;
  }

  RecipeData.load().then(data => {
    recipes = data.recipes.filter(r => r && r.id != null && r.name);
    index = RecipeVectorCore.createIndex(recipes);
    render();
    // 同じタブでお気に入りを外した場合、既存ページの件数更新を検出する。
    new MutationObserver(render).observe($('favorite-total'), { childList: true, characterData: true, subtree: true });
    window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) render(); });
  }).catch(error => {
    console.error('お気に入り推薦:', error);
    $('favrec-summary').textContent = '推薦データを読み込めませんでした。';
  });
})();
