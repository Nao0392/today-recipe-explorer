// 実行：node tests/atlas-core.test.js
"use strict";
const assert = require("node:assert/strict");
const { createIndex } = require("../vector-core.js");
const atlas = require("../atlas-core.js");
const fs = require("node:fs");
const path = require("node:path");
const { recipes } = JSON.parse(fs.readFileSync(path.join(__dirname, "../recipes.json"), "utf8"));
const index = createIndex(recipes), mat = atlas.matrix(index, recipes, {});
assert.equal(mat.ids.length, recipes.length);
assert.equal(mat.values.length, recipes.length);
assert.equal(mat.values[0].length, recipes.length);
for (let i = 0; i < mat.ids.length; i++) {
  assert.equal(mat.values[i][i], index.compareIds(mat.ids[i], mat.ids[i], {}).score);
  for (let j = 0; j < mat.ids.length; j++) {
    assert.equal(mat.values[i][j], mat.values[j][i]);
    const expected = index.compareIds(mat.ids[i], mat.ids[j], {}).score;
    // 浮動小数点の丸め誤差を許容して類似度を比較する。
    if (expected === null) {
      assert.equal(mat.values[i][j], null);
    } else {
      assert.ok(
        Math.abs(mat.values[i][j] - expected) < 1e-12,
        `類似度の不一致: ${mat.ids[i]} / ${mat.ids[j]}`
      );
    }
    assert.ok(expected === null || (expected >= 0 && expected <= 1));
  }
}
for (const mode of ["similar", "category", "name"]) {
  const ord = atlas.order(recipes, mat, mode);
  assert.equal(new Set(ord).size, recipes.length);
  assert.equal(ord.length, recipes.length);
}
console.log("OK: 料理間の類似度行列・対称性・表示順のテストを通過");
