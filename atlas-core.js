/**
 * atlas-core.js — 料理間の関係を可視化するための純粋な計算処理。
 * 類似度の数式自体は既存の RecipeVectorCore に一本化する。
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RecipeAtlasCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function matrix(index, recipes, weights) {
    const ids = recipes.map(r => String(r.id));
    const values = ids.map(() => Array(ids.length).fill(null));
    for (let i = 0; i < ids.length; i++) {
      // 対角成分は自分自身との比較（正規化された自己類似度）を表す。
      values[i][i] = index.compareIds(ids[i], ids[i], weights)?.score ?? null;
      for (let j = i + 1; j < ids.length; j++) {
        const result = index.compareIds(ids[i], ids[j], weights);
        const score = result ? result.score : null;
        values[i][j] = score;
        values[j][i] = score;
      }
    }
    return { ids, values };
  }

  function order(recipes, mat, mode = "similar") {
    const byId = new Map(recipes.map(r => [String(r.id), r]));
    const positions = mat.ids.map((_, i) => i);
    if (mode === "name" || mode === "category") {
      return positions.sort((i, j) => {
        const a = byId.get(mat.ids[i]), b = byId.get(mat.ids[j]);
        if (mode === "category") {
          const categoryDiff = String(a.category || "").localeCompare(String(b.category || ""), "ja");
          if (categoryDiff) return categoryDiff;
        }
        return String(a.name).localeCompare(String(b.name), "ja");
      });
    }
    if (!positions.length) return [];
    // 類似度の平均が最も高い料理から開始し、隣に近い料理を順次配置する。
    // これは表示順のヒューリスティックであり、クラスタリングではない。
    const mean = i => mat.values[i].reduce((s, v) => s + (v === null ? 0 : v), 0);
    const first = positions.slice().sort((a, b) => mean(b) - mean(a) || a - b)[0];
    const answer = [first];
    const remaining = new Set(positions.filter(i => i !== first));
    while (remaining.size) {
      const prior = answer[answer.length - 1];
      const next = [...remaining].sort((a, b) =>
        (mat.values[prior][b] ?? -1) - (mat.values[prior][a] ?? -1) || a - b)[0];
      answer.push(next);
      remaining.delete(next);
    }
    return answer;
  }

  function links(mat, minScore = 0.5, maxDegree = 6) {
    const candidates = [];
    for (let i = 0; i < mat.ids.length; i++) {
      for (let j = i + 1; j < mat.ids.length; j++) {
        const score = mat.values[i][j];
        if (score !== null && score >= minScore) {
          candidates.push({ source: mat.ids[i], target: mat.ids[j], score });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    const degrees = new Map(), result = [];
    for (const edge of candidates) {
      const src = degrees.get(edge.source) || 0, dst = degrees.get(edge.target) || 0;
      if (src >= maxDegree || dst >= maxDegree) continue;
      result.push(edge);
      degrees.set(edge.source, src + 1);
      degrees.set(edge.target, dst + 1);
    }
    return result;
  }

  // 既存の比較関数だけを利用し、候補50件の上限を受けない全件順位を計算する。
  function rankAll(index, recipes, seedId, weights) {
    return recipes.filter(r => String(r.id) !== String(seedId))
      .map(r => index.compareIds(seedId, r.id, weights))
      .filter(result => result !== null && result.score !== null)
      .sort((a, b) => b.score - a.score || b.coverage - a.coverage ||
        a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));
  }

  function sweep(index, recipes, seedId, dimension, initialWeights, step = 10) {
    const base = Object.fromEntries(index.fields.map(f => [f.key, f.weight]));
    const weights = { ...base, ...initialWeights };
    const result = [];
    for (let weight = 0; weight <= 100; weight += step) {
      const rankings = rankAll(index, recipes, seedId, { ...weights, [dimension]: weight });
      result.push({ weight, ranks: rankings.map((r, i) => ({
        id: r.id, name: r.name, rank: i + 1, score: r.score
      })) });
    }
    return result;
  }

  return { matrix, order, links, rankAll, sweep };
});
