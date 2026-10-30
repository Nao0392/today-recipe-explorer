// 実行：node tests/atlas-weightlab.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createIndex, FIELDS } = require("../vector-core.js");
const { rankAll, sweep } = require("../atlas-core.js");
const { recipes } = JSON.parse(fs.readFileSync(path.join(__dirname, "../recipes.json"), "utf8"));
const index = createIndex(recipes), seed = String(recipes[0].id);
const weights = Object.fromEntries(FIELDS.map(field => [field.key, field.weight]));
const series = sweep(index, recipes, seed, "ingredients", weights);
assert.equal(series.length, 11);
assert.equal(series[0].weight, 0);
assert.equal(series[10].weight, 100);
for (const point of series) {
  const ranked = rankAll(index, recipes, seed, { ...weights, ingredients: point.weight });
  assert.deepEqual(point.ranks.map(r => r.id), ranked.map(r => r.id));
  assert.deepEqual(point.ranks.map(r => r.rank), point.ranks.map((_, i) => i + 1));
  assert.ok(point.ranks.every(r => r.id !== seed));
}
const initial = rankAll(index, recipes, seed, weights);
assert.deepEqual(initial.slice(0, 8).map(r => r.id), index.search(seed, weights, 8).map(r => r.id));
console.log("OK: 推薦順位の重みスイープ・全件順位の整合性を確認");
