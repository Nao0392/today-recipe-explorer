/**
 * vector-core.js — 料理の特徴量ベクトルに基づく類似検索（純粋な計算モジュール）。
 *
 * 意味埋め込み／AIモデルではなく、JSONに存在する項目から特徴量を作る。
 * 比較可能な項目だけで重みを再正規化し、欠損値を「0点」と混同しない。
 * ブラウザと Node.js の両方で実行でき、DOMや外部ライブラリに依存しない。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RecipeVectorCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const FIELDS = [
    { key: "ingredients", label: "食材", weight: 35, color: "#df804c" },
    { key: "taste", label: "味", weight: 20, color: "#bd6eaf" },
    { key: "category", label: "料理の区分", weight: 12, color: "#6f99c7" },
    { key: "nutrition", label: "栄養（推定）", weight: 10, color: "#82a56a" },
    { key: "tools", label: "調理器具", weight: 8, color: "#8b86c0" },
    { key: "style", label: "料理の系統", weight: 8, color: "#c6a052" },
    { key: "time", label: "調理時間（推定）", weight: 7, color: "#56a6a0" }
  ];

  const bounded = value => Math.max(0, Math.min(1, value));
  const hasNumber = value => typeof value === "number" && Number.isFinite(value);
  const nonempty = value => typeof value === "string" && value.trim().length > 0;
  const normalizeWord = value => String(value || "").normalize("NFKC").trim().toLowerCase();

  function names(items) {
    if (!Array.isArray(items)) return new Set();
    return new Set(items.map(x => normalizeWord(typeof x === "string" ? x : x && x.name)).filter(Boolean));
  }

  // 集合の Jaccard 係数。片方・両方の情報がないときは null を返す。
  function jaccard(a, b) {
    if (!a.size || !b.size) return null;
    const union = new Set([...a, ...b]);
    let intersection = 0;
    for (const name of a) if (b.has(name)) intersection++;
    return intersection / union.size;
  }

  // 頻出食材（例: 玉ねぎ）の影響を弱めるため IDF で重み付けする。
  // 各料理の食材を 0/1 ベクトルと見なし、重み付き Jaccard で比較する。
  function weightedJaccard(a, b, idf) {
    if (!a.size || !b.size) return null;
    const union = new Set([...a, ...b]);
    let common = 0, total = 0;
    for (const name of union) {
      const weight = idf.get(name) || 1;
      total += weight;
      if (a.has(name) && b.has(name)) common += weight;
    }
    return total ? common / total : null;
  }

  function features(recipe) {
    const t = recipe && recipe.taste_level || {};
    const n = recipe && recipe.nutrition || {};
    const taste = ["spicy", "sweet", "sour"].map(key =>
      hasNumber(t[key]) && t[key] >= 0 && t[key] <= 5 ? t[key] : null);
    return {
      id: String(recipe.id),
      name: String(recipe.name || recipe.id),
      ingredients: names(recipe.ingredients),
      taste,
      tasteTags: names(recipe.taste),
      category: nonempty(recipe.category) ? recipe.category : null,
      style: nonempty(recipe.style) ? recipe.style : null,
      tools: names(recipe.tools),
      nutrition: ["kcal", "protein", "fat", "carb"].map(key =>
        hasNumber(n[key]) && n[key] >= 0 ? n[key] : null),
      time: hasNumber(recipe.time_min) && recipe.time_min >= 0 ? recipe.time_min : null
    };
  }

  function compareTaste(a, b) {
    const pairs = a.taste.map((v, i) => [v, b.taste[i]])
      .filter(pair => pair[0] !== null && pair[1] !== null);
    if (pairs.length) {
      return bounded(1 - pairs.reduce((sum, p) => sum + Math.abs(p[0] - p[1]) / 5, 0) / pairs.length);
    }
    return jaccard(a.tasteTags, b.tasteTags);
  }

  function compareNutrition(a, b) {
    // 単位の異なる4変数を基準スケールで正規化した距離。
    // 一部が欠けている場合は利用可能な変数だけを用いる。
    const scales = [1000, 50, 60, 120];
    const distances = [];
    scales.forEach((scale, i) => {
      if (a.nutrition[i] !== null && b.nutrition[i] !== null) {
        distances.push(Math.abs(a.nutrition[i] - b.nutrition[i]) / scale);
      }
    });
    if (!distances.length) return null;
    return bounded(1 - distances.reduce((s, v) => s + v, 0) / distances.length);
  }

  function compareFeatures(a, b, idf, customWeights) {
    const comparisons = {
      ingredients: weightedJaccard(a.ingredients, b.ingredients, idf),
      taste: compareTaste(a, b),
      category: a.category && b.category ? Number(a.category === b.category) : null,
      nutrition: compareNutrition(a, b),
      tools: jaccard(a.tools, b.tools),
      style: a.style && b.style ? Number(a.style === b.style) : null,
      // 30分程度の違いで急激に類似度が消えないよう指数関数を利用する。
      time: a.time !== null && b.time !== null ? Math.exp(-Math.abs(a.time - b.time) / 30) : null
    };
    let activeWeight = 0, weightedSum = 0;
    const dimensions = FIELDS.map(field => {
      const raw = customWeights && Object.prototype.hasOwnProperty.call(customWeights, field.key)
        ? Number(customWeights[field.key]) : field.weight;
      const weight = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      const value = comparisons[field.key];
      if (value !== null && weight > 0) {
        activeWeight += weight;
        weightedSum += value * weight;
      }
      return {
        key: field.key, label: field.label, color: field.color, similarity: value,
        weight, contribution: 0
      };
    });
    // 欠損した項目の重みを除外し、残りの重みの合計を100%へ正規化。
    // 各特徴量の寄与度を計算する
    dimensions.forEach(d => {
      if (activeWeight > 0 && d.similarity !== null)
        d.contribution = d.similarity * d.weight / activeWeight;
    });

    // 比較可能な特徴量の割合を計算する
    const totalWeight = dimensions.reduce(
      (sum, d) => sum + d.weight, 0
    );

    return {
      id: b.id, name: b.name,
      score: activeWeight > 0 ? bounded(weightedSum / activeWeight) : null,
      coverage: totalWeight > 0 ? activeWeight / totalWeight : 0,
      dimensions,
      commonIngredients: [...a.ingredients].filter(x => b.ingredients.has(x)),
      onlyBase: [...a.ingredients].filter(x => !b.ingredients.has(x)),
      onlyCandidate: [...b.ingredients].filter(x => !a.ingredients.has(x))
    };
  }

  function createIndex(recipes) {
    if (!Array.isArray(recipes)) throw new TypeError("recipes は配列である必要があります");
    const valid = recipes.filter(r => r && r.id != null);
    const indexed = valid.map(features);
    const byId = new Map(indexed.map(f => [f.id, f]));
    const df = new Map();
    indexed.forEach(f => f.ingredients.forEach(name => df.set(name, (df.get(name) || 0) + 1)));
    const idf = new Map([...df].map(([name, freq]) =>
      [name, 1 + Math.log((indexed.length + 1) / (freq + 1))]));

    function compareIds(baseId, candidateId, weights) {
      const a = byId.get(String(baseId)), b = byId.get(String(candidateId));
      return a && b ? compareFeatures(a, b, idf, weights) : null;
    }
    function search(baseId, weights, count) {
      const a = byId.get(String(baseId));
      if (!a) return [];
      const limit = Math.max(0, Math.min(50, Number.isFinite(count) ? Math.floor(count) : 8));
      return indexed.filter(b => b.id !== a.id)
        .map(b => compareFeatures(a, b, idf, weights))
        .filter(item => item.score !== null)
        // 類似度が同点の場合、データの充足率が高いレシピを優先する。
        .sort((x, y) =>
          y.score - x.score ||
          y.coverage - x.coverage ||
          x.name.localeCompare(y.name, "ja") ||
          x.id.localeCompare(y.id)
        )
        .slice(0, limit);
    }
    return { fields: FIELDS, items: indexed, size: indexed.length, search, compareIds };
  }
  return { FIELDS, createIndex };
});
