// Run: node tests/data-source.test.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "data-adapter.js"), "utf8");
const file = "data/delish_teiban_photo.json";
const json = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
assert.ok(Array.isArray(json.recipes) && json.recipes.length > 1);
assert.ok(json.ingredients && typeof json.ingredients === "object");
const calls = [];
const ctx = vm.createContext({
  fetch: async url => {
    calls.push(url);
    return { ok: true, json: async () => json };
  }
});
vm.runInContext(source + "\nthis.adapter = RecipeData;", ctx);
const adapter = ctx.adapter;
(async () => {
  assert.equal(adapter.SOURCE, file);
  const loaded = await adapter.load();
  assert.equal(loaded.recipes.length, json.recipes.length);
  assert.strictEqual(await adapter.load(), loaded);
  assert.deepEqual(calls, [file]);
  // 手動で選んだ JSON に差し替えられる。data-adapter.js は ingredients と recipes(2品以上)を必須にしている
  const small = adapter.setData({
    ingredients: { egg: { unit: "個" }, rice: { unit: "g" } },
    recipes: [
      { id: "a", name: "Sample", ingredients: [{ name: "egg" }] },
      { id: "b", name: "Sample 2", ingredients: [{ name: "egg" }, { name: "rice" }] }
    ]
  });
  assert.equal(small.recipes.length, 2);
  assert.ok(small.ingredients.egg);
  // 形式が足りないデータは受け付けない(ingredients がない・1品しかない)
  assert.throws(() => adapter.setData({ recipes: small.recipes }), /ingredientsとrecipes/);
  assert.throws(() => adapter.setData({ ingredients: small.ingredients, recipes: [small.recipes[0]] }), /2品以上/);
  assert.strictEqual(await adapter.load(), small);
  // The common loader must be referenced by every active page.
  for (const name of ["index.html", "search.html", "atlas.html", "atlas-discovery.html"]) {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    assert.ok(html.includes('src="data-adapter.js"'), name + " is not using the shared loader");
    assert.ok(!html.includes("data/delish_teiba_photo.json"), name + " references an old dataset");
  }
  let attempts = 0;
  const retry = vm.createContext({fetch: async () => {
    attempts++;
    if (attempts === 1) throw new Error("Temporary offline");
    return { ok: true, json: async () => json };
  }});
  vm.runInContext(source + "\nthis.adapter = RecipeData;", retry);
  await assert.rejects(retry.adapter.load(), /delish_teiban_photo.json/);
  const next = await retry.adapter.load();
  assert.equal(next.recipes.length, json.recipes.length);
  assert.equal(attempts, 2);
  console.log("OK: all pages share", file, "("+loaded.recipes.length+" recipes); cache, uploads and retry passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
