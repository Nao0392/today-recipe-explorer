// Run: node tests/substitutes.test.js
// 代替できる食材(substitutes)と、まとめの食材名(鶏肉 → 鶏もも肉・鶏むね肉…)の扱いを確かめる。
// app.js の findSubstitutes・expandMembers・expandExclude・hasIngredient をそのまま取り出して使う。
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const pickFn = name => {
  const m = app.match(new RegExp(`function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `app.js に ${name} が見つかりません`);
  return m[0];
};
const ctx = vm.createContext({ state: { master: {} } });
vm.runInContext(["findSubstitutes", "expandMembers", "expandExclude", "hasIngredient"].map(pickFn).join("\n") +
  "\nthis.findSubstitutes = findSubstitutes; this.expandMembers = expandMembers; this.expandExclude = expandExclude; this.hasIngredient = hasIngredient;", ctx);
const find = (names, have, exclude, master) => {
  ctx.state.master = master;
  return JSON.parse(JSON.stringify(ctx.findSubstitutes(names, new Set(have), new Set(exclude), master)));
};

const master = {
  鶏肉: { substitutes: ["豚肉", "牛肉"] },
  牛肉: { substitutes: ["豚肉", "鶏肉"] },
  豚肉: { substitutes: ["鶏肉", "牛肉"] },
  生クリーム: { substitutes: ["牛乳", "豆乳"] },
  牛乳: {},
};

// 足りない食材を、持っている代わりの食材で埋める
assert.deepEqual(find(["鶏肉", "玉ねぎ"], ["豚肉"], [], master), [{ name: "鶏肉", use: "豚肉" }]);
// 持っている食材はそもそも代用しない
assert.deepEqual(find(["鶏肉"], ["鶏肉", "豚肉"], [], master), []);
// 一方向: 生クリームの代わりに牛乳は使えるが、牛乳の代わりに生クリームは使えない
assert.deepEqual(find(["生クリーム"], ["牛乳"], [], master), [{ name: "生クリーム", use: "牛乳" }]);
assert.deepEqual(find(["牛乳"], ["生クリーム"], [], master), []);
// そのレシピで既に使う食材は代わりにしない(豚肉も鶏肉も使う料理)
assert.deepEqual(find(["豚肉", "鶏肉"], ["豚肉"], [], master), []);
// 持っている1つの食材は、1つの食材の代わりにだけ使う
assert.deepEqual(find(["鶏肉", "牛肉"], ["豚肉"], [], master), [{ name: "鶏肉", use: "豚肉" }]);
// 入れたくない食材は代わりにしない
assert.deepEqual(find(["鶏肉"], ["豚肉"], ["豚肉"], master), []);
// 表の順番で優先する(鶏肉の代わりは 豚肉 → 牛肉 の順)
assert.deepEqual(find(["鶏肉"], ["牛肉", "豚肉"], [], master), [{ name: "鶏肉", use: "豚肉" }]);

// まとめの食材名: 「鶏肉」と入力したら、鶏もも肉・鶏むね肉などを全部持っているとみなす
const m2 = {
  鶏肉: { members: ["鶏もも肉", "鶏むね肉", "手羽元"] },
  鶏もも肉: { parent: "鶏肉", substitutes: ["豚肉", "鶏むね肉"] }, 鶏むね肉: { parent: "鶏肉", substitutes: ["豚肉", "鶏もも肉"] },
  手羽元: { parent: "鶏肉" }, 豚肉: { substitutes: ["牛肉", "鶏もも肉", "鶏むね肉"] }, 牛肉: { substitutes: ["豚肉"] },
  豆腐: { members: ["木綿豆腐", "絹豆腐"] }, 木綿豆腐: { parent: "豆腐", substitutes: ["絹豆腐"] }, 絹豆腐: { parent: "豆腐", substitutes: ["木綿豆腐"] },
};
ctx.state.master = m2;
const expanded = [...ctx.expandMembers(new Set(["鶏肉", "玉ねぎ"]))].sort();
assert.deepEqual(expanded, ["手羽元", "玉ねぎ", "鶏むね肉", "鶏もも肉", "鶏肉"].sort());
// 部位の名前を入力したときは広げない(鶏もも肉 → 鶏むね肉 にはならない。これは代替で扱う)
assert.deepEqual([...ctx.expandMembers(new Set(["鶏もも肉"]))], ["鶏もも肉"]);
// レシピ側が まとめの名前(部位が分からない「豆腐」)なら、どれか1つの部位があればよい
assert.equal(ctx.hasIngredient(new Set(["木綿豆腐"]), "豆腐"), true);
assert.equal(ctx.hasIngredient(new Set(["玉ねぎ"]), "豆腐"), false);
// 鶏もも肉が無くても、鶏むね肉があれば代替で作れる(代マーク)。豚肉の代わりに牛肉も使える
assert.deepEqual(find(["鶏もも肉"], ["鶏むね肉"], [], m2), [{ name: "鶏もも肉", use: "鶏むね肉" }]);
assert.deepEqual(find(["豚肉"], ["牛肉"], [], m2), [{ name: "豚肉", use: "牛肉" }]);
// 牛肉と鶏肉どうしは代替にしない
assert.deepEqual(find(["牛肉"], ["鶏もも肉"], [], m2), []);
// 手羽元は豚肉で代用しない
assert.deepEqual(find(["手羽元"], ["豚肉"], [], m2), []);
// 「鶏肉」と入力したときは、広げたあとの集合で照らし合わせるので、鶏もも肉は代用ではなく「持っている」
assert.deepEqual(find(["鶏もも肉"], [...ctx.expandMembers(new Set(["鶏肉"]))], [], m2), []);

// 入れたくない食材: 「豚肉」→ 豚ひき肉・合いびき肉、「牛肉」→ 牛ひき肉・合いびき肉、「鶏肉」→ 部位と鶏ひき肉も外す
const m3 = {
  鶏肉: { members: ["鶏もも肉", "鶏むね肉"] }, 鶏もも肉: { parent: "鶏肉" }, 鶏むね肉: { parent: "鶏肉" },
  ひき肉: { members: ["豚ひき肉", "合いびき肉", "鶏ひき肉", "牛ひき肉"] },
  豚ひき肉: { parent: "ひき肉", made_from: ["豚肉"] }, 合いびき肉: { parent: "ひき肉", made_from: ["豚肉", "牛肉"] },
  鶏ひき肉: { parent: "ひき肉", made_from: ["鶏肉"] }, 牛ひき肉: { parent: "ひき肉", made_from: ["牛肉"] },
};
ctx.state.master = m3;
const ex = list => [...ctx.expandExclude(new Set(list))].sort();
assert.deepEqual(ex(["豚肉"]), ["合いびき肉", "豚ひき肉", "豚肉"].sort());
assert.deepEqual(ex(["牛肉"]), ["合いびき肉", "牛ひき肉", "牛肉"].sort());
assert.deepEqual(ex(["鶏肉"]), ["鶏ひき肉", "鶏むね肉", "鶏もも肉", "鶏肉"].sort());
// 部位の名前(鶏もも肉)を入れたときは、ひき肉まで外さない
assert.deepEqual(ex(["鶏もも肉"]), ["鶏もも肉"]);
// 部位が分からない「ひき肉」とだけ書かれたレシピは、豚肉を外したい人には出さない(安全側)
assert.equal(ctx.hasIngredient(ctx.expandExclude(new Set(["豚肉"])), "ひき肉"), true);

// 実データ: substitutes の名前はすべて食材の一覧にある
const data = JSON.parse(fs.readFileSync(path.join(root, "data/delish_teiban_photo.json"), "utf8"));
const withSubs = Object.entries(data.ingredients).filter(([, v]) => v.substitutes);
assert.ok(withSubs.length > 0, "substitutes が1つもありません");
for (const [name, v] of withSubs) {
  for (const u of v.substitutes) assert.ok(u in data.ingredients, `${name} の代わり ${u} がデータにない`);
  assert.ok(!v.substitutes.includes(name), `${name} が自分自身を代わりにしている`);
}
// 実データ: members(まとめ)の名前はすべて食材の一覧にあり、子の parent は親を指している
const umbrellas = Object.entries(data.ingredients).filter(([, v]) => v.members);
assert.deepEqual(umbrellas.map(([k]) => k).sort(), ["ひき肉", "豆腐", "鶏肉"].sort());
for (const [name, v] of umbrellas) {
  for (const c of v.members) {
    assert.ok(c in data.ingredients, `${name} の部位 ${c} がデータにない`);
    assert.equal(data.ingredients[c].parent, name, `${c} の parent が ${name} になっていない`);
  }
}
// 実データ: made_from(ひき肉の元の肉)の名前はすべて食材の一覧にある
const madeFrom = Object.entries(data.ingredients).filter(([, v]) => v.made_from);
assert.deepEqual(madeFrom.map(([k]) => k).sort(), ["合いびき肉", "牛ひき肉", "豚ひき肉", "鶏ひき肉"].sort());
for (const [name, v] of madeFrom) for (const m of v.made_from) assert.ok(m in data.ingredients, `${name} の元の肉 ${m} がデータにない`);
console.log(`substitutes tests passed (${withSubs.length} 種類の食材に代替あり、まとめの食材 ${umbrellas.length} つ)`);
