// 実行：node tests/atlas-network.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createIndex } = require("../vector-core.js");
const { matrix, links } = require("../atlas-core.js");
const { recipes } = JSON.parse(fs.readFileSync(path.join(__dirname, "../recipes.json"), "utf8"));
const mat = matrix(createIndex(recipes), recipes, {});
const edges = links(mat, 0.5, 6);
const counts = new Map();
for (const e of edges) {
  assert.ok(e.source !== e.target);
  assert.ok(e.score >= 0.5 && e.score <= 1);
  for (const id of [e.source, e.target]) counts.set(id, (counts.get(id) || 0) + 1);
}
for (const n of counts.values()) assert.ok(n <= 6);
assert.equal(links(mat, 1.01).length, 0);
assert.ok(links(mat, 0, 6).length >= edges.length);
console.log(`OK: 関係ネットワークの閾値・最大次数を検証（${edges.length}件）`);
