// node tests/vector-core.test.js
"use strict";
const assert = require("node:assert/strict");
const { createIndex, FIELDS } = require("../vector-core.js");
const make = (id, name, ingredients, other = {}) => ({
  id, name, ingredients: ingredients.map(n => ({ name: n, amount: 1 })),
  taste_level: { spicy: 1, sweet: 2, sour: 0 },
  category: "主食", style: "和風", tools: ["鍋"],
  nutrition: { kcal: 500, protein: 20, fat: 10, carb: 50 },
  time_min: 20, ...other
});
const data = [
  make("a", "基準", ["卵", "ご飯", "鶏肉"]),
  make("b", "類似", ["卵", "ご飯", "鶏肉"]),
  make("c", "相違", ["トマト", "玉ねぎ"], {
    category: "汁物", style: "洋風", time_min: 80,
    taste_level: { spicy: 5, sweet: 0, sour: 5 }
  }),
  make("d", "欠損", [], { taste_level: {}, nutrition: null, time_min: null, tools: [], category: "" })
];
const index = createIndex(data);
assert.equal(index.size, 4);
assert.equal(FIELDS.length, 7);
assert.equal(FIELDS.reduce((s, x) => s + x.weight, 0), 100);
assert.equal(index.search("absent").length, 0);
assert.equal(index.search("a", null, 8).length, 3);
assert.equal(index.search("a", null, 8)[0].id, "b");
assert.equal(index.compareIds("a", "b").score, 1);
const away = index.compareIds("a", "c");
assert.ok(away.score >= 0 && away.score < 1);
assert.ok(index.search("a", null, 8).every(x => x.id !== "a"));
const missing = index.compareIds("a", "d");
assert.ok(missing.score === null || Number.isFinite(missing.score));
assert.equal(missing.dimensions.find(x => x.key === "nutrition").similarity, null);
const ingredientOnly = Object.fromEntries(FIELDS.map(x => [x.key, x.key === "ingredients" ? 1 : 0]));
assert.equal(index.compareIds("a", "b", ingredientOnly).score, 1);
assert.equal(index.compareIds("a", "c", ingredientOnly).score, 0);
assert.equal(index.compareIds("a", "d", ingredientOnly).score, null);
assert.deepEqual(index.search("a", Object.fromEntries(FIELDS.map(x => [x.key, 0 ]))), []);
const contributions = index.compareIds("a", "b").dimensions.reduce((s, x) => s + x.contribution, 0);
assert.ok(Math.abs(contributions - 1) < 1e-12);
console.log("OK: vector-core.js 類似度・欠損・重み・ランキングのテストを通過");
