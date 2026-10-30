// app.js — 入力処理・絞り込み・スコア計算

const TASTES = ["あっさり", "こってり", "甘い", "辛い", "酸っぱい", "しょっぱい"];
const CATEGORIES = ["主食", "主菜", "副菜", "汁物", "軽食", "デザート"];
const STYLES = ["和風", "中華", "韓国風", "エスニック", "インド風", "中東風", "洋風", "メキシカン"];
const TOOL_ORDER = ["鍋", "フライパン", "オーブン", "電子レンジ"];
const NO_LIMIT = { time: 120, price: 600, kcal: 1000, missing: 6 };
const FAVORITES_KEY = "world-recipe-explorer-favorites";
const USE_SUBSTITUTES_KEY = "world-recipe-explorer-use-substitutes";

const state = {
  recipes: [], master: {},
  have: new Set(), haveUnknown: [], haveExpanded: new Set(),
  exclude: new Set(), excludeRaw: [], excludeExpanded: new Set(),
  amounts: new Map(),
  maxTime: 120, maxPrice: 600, maxKcal: 1000, minProtein: 0, minMissing: 0, maxMissing: 6,
  minServings: 1, nameQuery: "",
  tools: new Set(), tastes: new Set(), styles: new Set(), categories: new Set(),
  month: new Date().getMonth() + 1, seasonOnly: false,
  sort: "match", paletteMode: "have", selected: null, yAxis: "time",
  xRangeMax: 5,
  scatterTopN: 30,   // 散布図を引いて見ているときに、点で出す上位の品数(並び順の上位)
  discoveryView: "ready",
  compareIds: new Set(),
  compareXAxis: "time", compareYAxis: "price",
  favorites: new Set(),
  useSubstitutes: loadUseSubstitutes(),   // 代わりの食材でも作れる料理に数えるか(ON/OFFボタン)
};
let aliasMap = new Map();
let lastAmountKey = "";
let lastIngredientSelectionKey = null;
let lastReadyKey = "";
// capstone-paged-results-v1
let resultPage = 0;
let resultPageSize = 8;
let lastResultKeys = "";
let visibleRows = [];
let visibleHasInput = false;

const $ = id => document.getElementById(id);

// ---------- 表記揺れの吸収 ----------
function norm(s) {
  return s.normalize("NFKC").trim().toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
// ---------- 入力欄の候補(打っている語に合う食材を、入力欄の下に出す) ----------
// candidates: [{ name, keys: [正規化した名前・別名], count }]。今打っている語 = カーソルより前の、最後の区切り(「、」やスペース)の後ろ
const SUGGEST_LIMIT = 8;
const TERM_DELIM = /[、,，\s]/;
// onPick: 候補を選んだあとに呼ぶ(絞り込みをやり直す)
function setupSuggest(input, candidates, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "suggest-wrap";
  input.replaceWith(wrap);
  const list = document.createElement("ul");
  list.className = "suggest-list";
  list.id = `${input.id}-suggest`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(input, list);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  let items = [], active = -1;

  const termRange = () => {
    const caret = input.selectionStart ?? input.value.length;
    let start = caret;
    while (start > 0 && !TERM_DELIM.test(input.value[start - 1])) start--;
    return { start, caret, term: input.value.slice(start, caret) };
  };
  const close = () => { list.hidden = true; items = []; active = -1; input.setAttribute("aria-expanded", "false"); };
  const highlight = i => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
  };
  // 日本語入力の変換中(下線が出ている間)に入力欄を書き換えると、確定したときに打ちかけの文字で上書きされてしまう。
  // そのため変換中に選んだときは、先に変換を確定させ(blur)、確定したあとで置き換える
  let composing = false, pending = null;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; if (pending) finishPick(); });
  function apply(name, start) {
    let end = start;   // 置き換える範囲は、確定したあとの文字で決め直す(start から次の区切りまで)
    while (end < input.value.length && !TERM_DELIM.test(input.value[end])) end++;
    const before = input.value.slice(0, start), after = input.value.slice(end).replace(/^[、,，\s]*/, "");
    input.value = `${before}${name}、${after}`;
    close();
    input.focus();
    const pos = before.length + name.length + 1;
    input.setSelectionRange(pos, pos);
    onPick();   // input イベントに頼らず、直接絞り込みをやり直す
  }
  function finishPick() { const p = pending; pending = null; apply(p.name, p.start); }
  function pick(name) {
    const { start } = termRange();
    if (!composing) return apply(name, start);
    pending = { name, start };
    input.blur();
    setTimeout(() => { if (pending) finishPick(); }, 0);   // compositionend が来ないブラウザでも置き換える
  }
  function update() {
    const { start, caret, term } = termRange();
    const q = norm(term);
    if (!q) return close();
    // 入力済みの食材は候補から外す(今打っている途中の語は数えない。「生姜」と打っている最中にしょうがが消えないように)
    const others = input.value.slice(0, start) + "、" + input.value.slice(caret);
    const entered = new Set(others.split(TERM_DELIM).filter(Boolean).map(t => aliasMap.get(norm(t)) || norm(t)));
    items = candidates.map(c => {
      // 前方一致を先に、次に途中に含むもの。別名で当たったときは、その別名も見せる
      let rank = 9, via = null;
      c.keys.forEach((k, i) => {
        const r = k.startsWith(q) ? 0 : q.length >= 2 && k.includes(q) ? 1 : 9;   // 途中に含むものは2文字以上打ったときだけ(1文字だと関係ない食材が混ざる)
        if (r < rank) { rank = r; via = i && i < c.raw.length ? c.raw[i] : null; }
      });
      return { ...c, rank, via };
    }).filter(c => c.rank < 9 && !entered.has(c.name))
      .sort((a, b) => a.rank - b.rank || b.count - a.count || a.name.localeCompare(b.name, "ja"))
      .slice(0, SUGGEST_LIMIT);
    if (!items.length) return close();
    list.replaceChildren(...items.map((c, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.innerHTML = `<span class="suggest-name">${c.name}</span>${c.umbrella ? `<span class="suggest-note">部位・種類すべて</span>` : ""}${c.via ? `<span class="suggest-via">${c.via}</span>` : ""}<span class="suggest-count">${c.count}品</span>`;
      li.addEventListener("mousedown", e => { e.preventDefault(); pick(c.name); });   // blur より先に選ぶ
      li.addEventListener("mousemove", () => highlight(i));
      return li;
    }));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(-1);
  }
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", e => {
    if (list.hidden || e.isComposing) return;   // 日本語入力の変換中の Enter は、候補を選ぶのに使わない
    if (e.key === "ArrowDown") { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
    else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) { e.preventDefault(); pick(items[active].name); }
    else if (e.key === "Escape") close();
  });
}
// 漢字の食材名の読み(ひらがなで打っても候補に出すため。データには食材名の読みがない)。
// 全部の名前の読みは ingredient-readings.js(make_readings.py が pykakasi で作る)にあり、ここには正しい読みを手で書く。両方で引ける
const INGREDIENT_READINGS = {
  "卵": "たまご", "玉ねぎ": "たまねぎ", "ひき肉": "ひきにく", "豚肉": "ぶたにく", "鶏肉": "とりにく", "牛肉": "ぎゅうにく", "牛乳": "ぎゅうにゅう",
  "ご飯": "ごはん", "米": "こめ", "大根": "だいこん", "白菜": "はくさい", "豆腐": "とうふ", "木綿豆腐": "もめんどうふ", "絹豆腐": "きぬどうふ",
  "焼き豆腐": "やきどうふ", "高野豆腐": "こうやどうふ", "油揚げ": "あぶらあげ", "厚揚げ": "あつあげ", "納豆": "なっとう", "豆乳": "とうにゅう",
  "大豆": "だいず", "小豆": "あずき", "枝豆": "えだまめ", "豆苗": "とうみょう", "生クリーム": "なまくりーむ", "練乳": "れんにゅう",
  "ほうれん草": "ほうれんそう", "小松菜": "こまつな", "水菜": "みずな", "春菊": "しゅんぎく", "菜の花": "なのはな", "三つ葉": "みつば", "高菜": "たかな",
  "絹さや": "きぬさや", "チンゲン菜": "ちんげんさい", "山芋": "やまいも", "長芋": "ながいも", "里芋": "さといも", "大和芋": "やまといも", "焼き芋": "やきいも",
  "切り干し大根": "きりぼしだいこん", "干ししいたけ": "ほししいたけ", "鮭": "さけ", "鱈": "たら", "鯛": "たい", "鰯": "いわし", "牡蠣": "かき",
  "辛子明太子": "からしめんたいこ", "しらす干し": "しらすぼし", "昆布": "こんぶ", "カツオ節": "かつおぶし", "梅干し": "うめぼし",
  "鶏レバー": "とりればー", "鶏皮": "とりかわ", "鶏がらスープ": "とりがらすーぷ", "鶏ガラスープの素": "とりがらすーぷのもと", "鶏白湯鍋つゆ": "とりぱいたんなべつゆ", "牛もつ": "ぎゅうもつ",
  "鶏もも肉": "とりももにく", "鶏むね肉": "とりむねにく", "鶏ひき肉": "とりひきにく", "豚ひき肉": "ぶたひきにく", "牛ひき肉": "ぎゅうひきにく",
  "合いびき肉": "あいびきにく", "手羽元": "てばもと", "手羽先": "てばさき", "牛ロース肉": "ぎゅうろーすにく", "焼豚": "やきぶた", "生ハム": "なまはむ",
  "食パン": "しょくぱん", "中華麺": "ちゅうかめん", "焼きそば麺": "やきそばめん", "春雨": "はるさめ", "米粉": "こめこ", "もち米": "もちごめ",
  "白玉粉": "しらたまこ", "角餅": "かくもち", "餃子の皮": "ぎょうざのかわ", "春巻きの皮": "はるまきのかわ", "シュウマイの皮": "しゅうまいのかわ",
  "粉チーズ": "こなちーず", "ピザ用チーズ": "ぴざようちーず", "粉ゼラチン": "こなぜらちん", "粉寒天": "こなかんてん", "きな粉": "きなこ",
  "抹茶": "まっちゃ", "栗": "くり", "紅しょうが": "べにしょうが", "揚げ玉": "あげだま", "酒粕": "さけかす", "黒蜜": "くろみつ", "糸唐辛子": "いとがらし",
};
const readingsOf = name => [...new Set([INGREDIENT_READINGS[name], (window.GENERATED_READINGS || {})[name]].filter(Boolean).map(norm))];
// 候補の一覧: 食材(別名でも引ける)。withPantry なら調味料も(入れたくない食材用)
function suggestCandidates(recipes, master, withPantry) {
  const count = new Map(), pantry = new Map();
  for (const r of recipes) {
    for (const n of new Set(r.ingredients.map(i => i.name))) count.set(n, (count.get(n) || 0) + 1);
    for (const p of new Set(r.pantry || [])) pantry.set(p, (pantry.get(p) || 0) + 1);
  }
  // まとめの名前(鶏肉・ひき肉・豆腐)は、中の部位・種類のどれかを使うレシピの数にする(「鶏肉」と入れると全部の部位を持っているとみなすため)
  const umbrellaCount = info => recipes.filter(r => r.ingredients.some(i => (info.members || []).includes(i.name))).length;
  const out = Object.entries(master).map(([name, info]) => {
    // keys は名前・別名・読みの順。raw は名前・別名(別名で当たったときに表示する)。読みで当たったときは何も出さない
    const raw = [name, ...(info.aliases || [])];
    const keys = raw.map(norm).concat(readingsOf(name));
    return { name, raw, keys, count: info.members?.length ? umbrellaCount(info) : count.get(name) || 0, umbrella: !!info.members?.length };
  }).filter(c => c.count);
  if (withPantry) for (const [p, n] of pantry) if (!master[p]) out.push({ name: p, raw: [p], keys: [norm(p), ...readingsOf(p)], count: n });
  return out;
}

function buildAliasMap(master) {
  const m = new Map();
  for (const [name, info] of Object.entries(master)) {
    m.set(norm(name), name);
    for (const a of info.aliases || []) m.set(norm(a), name);
  }
  return m;
}
function parseTerms(text) {
  const known = new Set(), unknown = [], raw = [];
  for (const term of text.split(/[、,，\s]+/).filter(Boolean)) {
    raw.push(term);
    const canon = aliasMap.get(norm(term));
    if (canon) known.add(canon); else unknown.push(term);
  }
  return { known, unknown, raw };
}

// ---------- まとめの食材名(鶏肉・ひき肉・豆腐) ----------
// データでは「鶏もも肉」「豚ひき肉」「木綿豆腐」のように部位・種類で分けている。
// 「鶏肉」のような まとめの名前(data の ingredients[名前].members がある食材)を入力したら、全部の部位・種類を持っているとみなす。
// 入力欄や選択中の表示は入力したまま(「鶏肉」)にし、レシピと照らし合わせるときだけ広げる。
function expandMembers(set) {
  const out = new Set(set);
  for (const n of set) for (const m of state.master[n]?.members || []) out.add(m);
  return out;
}
// 入れたくない食材用: まとめの名前の広げ方に加えて、その肉からできたひき肉も含める
// (「豚肉」→ 豚ひき肉・合いびき肉、「鶏肉」→ 鶏ひき肉。data の ingredients[名前].made_from)
function expandExclude(set) {
  const out = expandMembers(set);
  for (const [name, info] of Object.entries(state.master)) {
    if ((info.made_from || []).some(m => set.has(m))) out.add(name);
  }
  return out;
}
// 食材 n を持っているか。レシピ側が まとめの名前(部位が分からない「豆腐」など)なら、どれか1つの部位があればよい
function hasIngredient(set, n) {
  return set.has(n) || (state.master[n]?.members || []).some(m => set.has(m));
}

// ---------- 代替できる食材 ----------
// 足りない食材のうち、代わりの食材(data の ingredients[名前].substitutes)を持っているものを探す。
// ・そのレシピで既に使う食材は代わりにしない(豚肉と鶏肉の両方を使う料理で、豚肉を鶏肉の代わりにしない)
// ・持っている食材1つは、1つの食材の代わりにだけ使う
// ・「入れたくない食材」は代わりにしない
// 戻り値: [{ name: 必要な食材, use: 代わりに使う食材 }]
function findSubstitutes(names, have, exclude, master) {
  const used = new Set(names), out = [];
  for (const n of names) {
    if (hasIngredient(have, n)) continue;
    const use = (master[n]?.substitutes || []).find(c => have.has(c) && !used.has(c) && !exclude.has(c));
    if (use) { out.push({ name: n, use }); used.add(use); }
  }
  return out;
}

// ---------- 1レシピの評価 ----------
function evaluate(r) {
  const names = r.ingredients.map(i => i.name);
  const have = state.haveExpanded;
  const matched = names.filter(n => hasIngredient(have, n));
  // 代用できるものは「足りない」に入れず、substituted に分けておく(充足率では持っているのと同じに数える)
  // OFF のときは代用を考えない(足りない食材はそのまま「足りない」に数える)
  const substituted = state.useSubstitutes ? findSubstitutes(names, have, state.excludeExpanded, state.master) : [];
  const subNames = new Set(substituted.map(s => s.name));
  const missing = names.filter(n => !hasIngredient(have, n) && !subNames.has(n));
  const seasonal = names.filter(n => (state.master[n]?.season || []).includes(state.month));

  // 今ある量で何人前作れるか:量を入力した食材のうち、いちばん足りないもので決まる
  let servings = null, limiting = null;
  for (const ing of r.ingredients) {
    // 量は入力した名前で持っている(「鶏肉 300g」と入れたら、鶏もも肉などの部位にも使う)
    const parent = state.master[ing.name]?.parent;
    const a = state.amounts.get(ing.name) ?? (parent && state.have.has(parent) ? state.amounts.get(parent) : undefined);
    if (!hasIngredient(have, ing.name) || !(a > 0)) continue;
    const s = a / ing.amount;
    if (servings === null || s < servings) { servings = s; limiting = ing.name; }
  }
  if (servings !== null) servings = Math.floor(servings);

  return {
    ...r, matched, missing, substituted, seasonal, servings, limiting,
    coverage: names.length ? (matched.length + substituted.length) / names.length : 0
  };
}

// 除外する理由を返す(通るなら null)
function rejectReason(r) {
  if (state.nameQuery && !norm(r.name).includes(norm(state.nameQuery))) return "料理名";
  if (state.minServings > 1 && Number(r.source_servings || 1) < state.minServings) return "人数";
  if (r.time_min > state.maxTime) return "時間";
  if (state.maxPrice < NO_LIMIT.price && r.price > state.maxPrice) return "価格";
  if (state.maxKcal < NO_LIMIT.kcal && r.nutrition.kcal > state.maxKcal) return "カロリー";
  if (r.nutrition.protein < state.minProtein) return "たんぱく質";
  if (!r.tools.every(t => state.tools.has(t))) return "器具";
  const exHit = r.ingredients.some(i => hasIngredient(state.excludeExpanded, i.name)) ||
    r.pantry.some(p => state.excludeRaw.some(x => norm(p).includes(norm(x))));
  if (exHit) return "除外食材";
  if (state.tastes.size && !r.taste.some(t => state.tastes.has(t))) return "味";
  if (state.styles.size && !state.styles.has(r.style)) return "種類";
  if (state.categories.size && !state.categories.has(r.category)) return "区分";
  if (state.seasonOnly && r.seasonal.length === 0) return "旬";
  if (state.have.size) {
    if (r.matched.length + r.substituted.length === 0) return "食材";
    if (r.missing.length < state.minMissing) return "不足";
    if (state.maxMissing < NO_LIMIT.missing && r.missing.length > state.maxMissing) return "不足";
  }
  return null;
}

const SORTERS = {
  match: (a, b) => b.coverage - a.coverage || b.matched.length - a.matched.length ||
    b.seasonal.length - a.seasonal.length || a.time_min - b.time_min,
  time: (a, b) => a.time_min - b.time_min,
  price: (a, b) => a.price - b.price,
  kcal: (a, b) => a.nutrition.kcal - b.nutrition.kcal,
  protein: (a, b) => b.nutrition.protein - a.nutrition.protein,
  servings: (a, b) => (b.servings ?? -1) - (a.servings ?? -1) || SORTERS.match(a, b),
};

// ---------- 画面更新 ----------
function refresh() {
  const all = state.recipes.map(evaluate);
  for (const r of all) r.reason = rejectReason(r);
  const results = all.filter(r => !r.reason).sort(SORTERS[state.sort]);
  const hasInput = state.have.size > 0;
  // 横軸を0〜5個に絞るときは、散布図と下の候補一覧を同じ対象にする。
  // 検索条件そのものは変えず、いつでも「すべて」に戻して確認できる。
  const inXRange = r => !hasInput || state.xRangeMax === null || r.missing.length <= state.xRangeMax;
  const rangeResults = results.filter(inXRange);
  // ランキング画面は「今すぐ作れる」料理だけを対象にする。食材が未入力なら、
  // すべての料理を作れるとは扱わない。
  const readyResults = hasInput ? results.filter(r => r.missing.length === 0).sort(SORTERS.time) : [];
  syncReadyComparison(readyResults);

  // パレットの状態
  for (const btn of $("palette").querySelectorAll("button[data-name]")) {
    btn.classList.toggle("on", state.have.has(btn.dataset.name));
    btn.classList.toggle("ng", state.exclude.has(btn.dataset.name));
  }
  syncPaletteVisibility();
  renderSelectedIngredientSummary();
  renderAmounts();
  updateLabels();
  updateXRangeStatus(results, hasInput);
  $("ready-count").textContent = hasInput ? `${readyResults.length}件` : "食材を選ぶと表示";
  $("ready-view").hidden = state.discoveryView !== "ready";
  $("scatter-view").hidden = state.discoveryView !== "scatter";
  $("tree-view").hidden = state.discoveryView !== "tree";
  $("network-view").hidden = state.discoveryView !== "network";
  document.querySelectorAll("[data-discovery-view]").forEach(button => {
    const active = button.dataset.discoveryView === state.discoveryView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (results.length === 0) {
    $("summary-text").textContent = "条件に合う料理がありません。条件を緩めてみてください";
  } else if (state.have.size === 0) {
    $("summary-text").innerHTML = `<strong>${results.length}</strong><span> 件のレシピが見つかりました</span><small>食材を入れると合う順に並びます</small>`;
  } else {
    const ready = results.filter(r => r.missing.length === 0).length;
    $("summary-text").innerHTML = `<strong>${results.length}</strong><span> 件のレシピが見つかりました</span><small>買い足しなしで作れるもの <b>${ready}</b> 件</small>`;
  }

  Viz.renderReadyRanking(readyResults.slice(0, 12), state.compareIds, state.selected);
  Viz.renderReadyComparison(readyResults.filter(r => state.compareIds.has(r.id)), state.compareXAxis, state.compareYAxis);
  if (state.discoveryView === "scatter") {
    Viz.renderScatter(all, state.yAxis, hasInput, state.selected, state.xRangeMax,
      { topIds: rangeResults.slice(0, state.scatterTopN).map(r => r.id) });
  }
  if (state.discoveryView === "tree") {
    Viz.renderRecipeTree(results, $("tree-level-1").value, $("tree-level-2").value, state.selected, $("tree-level-3").value);
  }
  if (state.discoveryView === "network") {
    Viz.renderIngredientNetwork(results, [...state.haveExpanded], state.selected, +$("network-limit").value, $("network-layout").value);
  }
  Viz.renderTopPicks(rangeResults.slice(0, 3), state.have.size > 0, state.selected);
  const candidateRows = rangeResults.slice(3);
  const resultKeys = candidateRows.map(r => r.id).join('|');
  if (resultKeys !== lastResultKeys) { resultPage = 0; lastResultKeys = resultKeys; }
  renderPagedRows(candidateRows, state.have.size > 0, state.selected);
  $("favorite-count").textContent = state.favorites.size;
  if (state.selected) {
    const r = all.find(d => d.id === state.selected);
    if (r) Viz.showDetail(r, state.master);
  }
}

function renderPagedRows(rows, hasInput, selectedId) {
  visibleRows = rows;
  visibleHasInput = hasInput;
  const pages = Math.max(1, Math.ceil(rows.length / resultPageSize));
  resultPage = Math.min(resultPage, pages - 1);
  const start = resultPage * resultPageSize;
  Viz.renderRows(rows.slice(start, start + resultPageSize), hasInput, selectedId);
  $("results-page-info").textContent = `${rows.length}件中 ${rows.length ? start + 1 : 0}–${Math.min(start + resultPageSize, rows.length)}件 (ページ ${resultPage + 1}/${pages})`;
  $("results-prev").disabled = resultPage === 0;
  $("results-next").disabled = resultPage >= pages - 1;
  $("results-pagination").hidden = rows.length === 0;
}

function syncReadyComparison(readyResults) {
  const key = readyResults.map(r => r.id).sort().join("|");
  if (key === lastReadyKey) return;
  lastReadyKey = key;
  // 食材・条件が変わったときは、比較対象を新しいランキングの先頭2品にする。
  // 同じ結果の並びではユーザーの選択を維持する。
  state.compareIds = new Set(readyResults.slice(0, 2).map(r => r.id));
}

function toggleReadyComparison(id) {
  if (state.compareIds.has(id)) state.compareIds.delete(id);
  else {
    if (state.compareIds.size >= 3) state.compareIds.delete(state.compareIds.values().next().value);
    state.compareIds.add(id);
  }
  refresh();
}

function updateXRangeStatus(results, hasInput) {
  const control = $("x-range");
  const status = $("x-range-status");
  control.disabled = !hasInput;
  if (!hasInput || state.xRangeMax === null) {
    status.hidden = true;
    return;
  }
  const hiddenCount = results.filter(r => r.missing.length > state.xRangeMax).length;
  status.hidden = false;
  status.innerHTML = hiddenCount
    ? `不足食材が<span>${state.xRangeMax + 1}個以上</span>の <b>${hiddenCount}件</b> は、横軸の表示を「すべて」にすると確認できます。`
    : `現在の検索結果はすべて、不足食材 <span>${state.xRangeMax}個以下</span> です。`;
}

function fmtLimit(v, max, unit, prefix = "") {
  return v >= max ? "制限なし" : `${prefix}${v}${unit}以内`;
}
function updateLabels() {
  $("time-val").textContent = fmtLimit(state.maxTime, NO_LIMIT.time, "分");
  $("price-val").textContent = fmtLimit(state.maxPrice, NO_LIMIT.price, "円");
  $("kcal-val").textContent = fmtLimit(state.maxKcal, NO_LIMIT.kcal, "kcal");
  $("protein-val").textContent = state.minProtein ? `${state.minProtein}g以上` : "制限なし";
  $("missing-val").textContent = state.maxMissing >= NO_LIMIT.missing ? "制限なし"
    : state.maxMissing === 0 ? "0個(今ある食材だけで作る)" : `${state.maxMissing}個まで`;
}

// 今ある量の入力欄(使いたい食材が変わったときだけ作り直す)
function renderAmounts() {
  const names = [...state.have];
  const key = names.join("|");
  if (key === lastAmountKey) return;
  lastAmountKey = key;
  const box = $("amounts");
  box.innerHTML = "";
  if (!names.length) { box.innerHTML = '<span class="hint">食材を入れると表示されます</span>'; return; }
  const table = document.createElement("table");
  for (const n of names) {
    const tr = document.createElement("tr");
    const unit = state.master[n]?.unit || "";
    const v = state.amounts.get(n);
    tr.innerHTML = `<td>${n}</td><td style="text-align:right"><input type="number" min="0" step="any" value="${v ?? ""}" placeholder="—"> ${unit}</td>`;
    tr.querySelector("input").addEventListener("input", e => {
      const val = parseFloat(e.target.value);
      if (val > 0) state.amounts.set(n, val); else state.amounts.delete(n);
      refresh();
    });
    table.appendChild(tr);
  }
  box.appendChild(table);
}

// ---------- 入力イベント ----------
function readHave() {
  const { known, unknown } = parseTerms($("ing-input").value);
  state.have = known; state.haveUnknown = unknown;
  state.haveExpanded = expandMembers(known);   // 照らし合わせ用(「鶏肉」→ 鶏もも肉・鶏むね肉…も含む)
  $("ing-warn").textContent = unknown.length ? `データにない食材: ${unknown.join("、")}` : "";
}
function readExclude() {
  const { known, unknown, raw } = parseTerms($("ex-input").value);
  state.exclude = known; state.excludeRaw = raw;
  state.excludeExpanded = expandExclude(known);   // 照らし合わせ用(「豚肉」→ 豚ひき肉・合いびき肉も外す)
  $("ex-warn").textContent = unknown.length ? `調味料として照合: ${unknown.join("、")}` : "";
}

function togglePalette(name) {
  const isHave = state.paletteMode === "have";
  const set = new Set(isHave ? state.have : state.exclude);
  if (set.has(name)) set.delete(name); else set.add(name);
  const other = isHave ? state.haveUnknown : state.excludeRaw.filter(t => !aliasMap.has(norm(t)));
  const input = isHave ? $("ing-input") : $("ex-input");
  input.value = [...set, ...other].join("、");
  if (isHave) readHave(); else readExclude();
  refresh();
}

// カテゴリを閉じても、現在どの食材を条件にしているか確認できるようにする。
// データにない入力語も、既存の警告・照合仕様を変えずに表示だけは残す。
function renderSelectedIngredientSummary() {
  const groups = [
    {
      row: $("selected-have-row"),
      chips: $("selected-have"),
      known: [...state.have],
      unknown: state.haveUnknown,
      className: "is-have",
    },
    {
      row: $("selected-exclude-row"),
      chips: $("selected-exclude"),
      known: [...state.exclude],
      unknown: state.excludeRaw.filter(term => !aliasMap.has(norm(term))),
      className: "is-exclude",
    },
  ].map(group => ({
    ...group,
    values: [
      ...group.known.map(name => ({ name, unknown: false })),
      ...group.unknown.map(name => ({ name, unknown: true })),
    ],
  }));

  const selectionKey = groups.map(group => group.values
    .map(value => `${value.unknown ? "?" : ""}${value.name}`).join("|")).join("/");
  if (selectionKey === lastIngredientSelectionKey) return;
  lastIngredientSelectionKey = selectionKey;

  let hasSelection = false;
  for (const group of groups) {
    const { values } = group;
    group.row.hidden = values.length === 0;
    if (values.length) hasSelection = true;
    group.chips.replaceChildren();
    for (const value of values) {
      const chip = document.createElement("span");
      chip.className = `selected-ingredient-chip ${group.className}${value.unknown ? " is-unknown" : ""}`;
      chip.textContent = value.name;
      group.chips.appendChild(chip);
    }
  }
  $("ingredient-selection-summary").hidden = !hasSelection;
}

// 代用のON/OFFは次に開いたときも同じにする(保存できない環境では毎回ON)
function loadUseSubstitutes() {
  try { return localStorage.getItem(USE_SUBSTITUTES_KEY) !== "off"; } catch (_) { return true; }
}
function setUseSubstitutes(on) {
  state.useSubstitutes = on;
  try { localStorage.setItem(USE_SUBSTITUTES_KEY, on ? "on" : "off"); } catch (_) { /* 保存不可でも画面内では使える */ }
  d3.selectAll(".legend-sub").style("display", on ? null : "none");
  refresh();
}

function loadFavorites() {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    return [];
  }
}

function toggleFavorite(id) {
  const added = !state.favorites.has(id);
  if (added) state.favorites.add(id);
  else state.favorites.delete(id);
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites])); } catch (_) { /* 保存不可でも画面内では使える */ }
  refresh();
}

// 食材パレットは、材料名に文字が含まれるかだけで分類していた。
// 例: 「バニラアイス」→「ニラ」、「ねぎとろ」→「ねぎ」と誤分類されるため、
// 選択UI用には明示的な食材分類を使う。レシピ本文の材料名・検索処理は変更しない。
const PALETTE_HIDDEN = new Set([
  // 廃棄部位・飾り・完成済みの料理。手持ち食材として選ぶ頻度が低く、一覧を読みにくくする。
  "大根の葉", "大根のつま", "大根の皮", "切り干し大根煮", "切干大根煮", "セロリの葉", "かぼちゃあん", "かぼちゃの種",
  "バニラアイス", "ねぎとろ", "冷凍たこ焼き", "たこ焼き粉", "みたらし団子", "鶏がらスープ", "鶏白湯鍋つゆ",
  "いか天", "えび天", "レバーペースト", "豚の角煮", "えびグラタン", "米糀からつくった糀甘酒", "米糀ミルク",
  "卵焼き", "バターライス", "ポテトサラダ", "肉じゃが", "筑前煮", "唐揚げ", "コロッケ", "キーマカレー", "レトルトカレー",
]);

const PALETTE_GROUPS = [
  { label: "野菜・きのこ", icon: "🥬", names: new Set([
    "アボカド", "アスパラ", "いんげん", "エリンギ", "えのき", "オクラ", "かいわれ", "かぶ", "カリフラワー", "かぼちゃ", "キャベツ", "きゅうり", "クレソン", "ケール", "ゴーヤー", "ごぼう", "さつまいも", "サラダ菜", "サンチュ", "ししとう", "しそ", "しめじ", "じゃがいも", "しょうが", "ズッキーニ", "セロリ", "せり", "たけのこ", "玉ねぎ", "チンゲン菜", "とうもろこし", "コーン", "トマト", "ミニトマト", "なす", "なめこ", "ニラ", "ねぎ", "にんじん", "にんにく", "パクチー", "パセリ", "バジル", "ミント", "パプリカ", "ピーマン", "ビーツ", "ブロッコリー", "ほうれん草", "白菜", "まいたけ", "マッシュルーム", "三つ葉", "みょうが", "もやし", "ルッコラ", "レタス", "れんこん", "大根", "小松菜", "春菊", "水菜", "菜の花", "豆苗", "冬瓜", "長芋", "山芋", "大和芋", "里芋", "しいたけ", "きくらげ", "ひらたけ", "ポルチーニ", "グリーンピース", "グリーンリーフ", "スナップエンドウ", "枝豆", "絹さや", "ヤングコーン", "ベビーリーフ", "芽キャベツ", "プリーツレタス", "ブロッコリースプラウト", "にんにくの芽", "行者にんにく", "わけぎ", "高菜", "ずいき", "ふき", "カット野菜", "ローズマリー"
  ]) },
  { label: "肉・魚介", icon: "🥩", names: new Set([
    "鶏もも肉", "鶏むね肉", "鶏ひき肉", "鶏レバー", "鶏皮", "ささみ", "手羽元", "手羽先", "豚肉", "豚ひき肉", "豚レバー", "牛肉", "牛ひき肉", "牛ロース肉", "牛タン", "牛もつ", "牛脂", "合いびき肉", "ラムチョップ", "ラム薄切り肉", "鴨ロース肉", "砂肝", "ベーコン", "ハム", "生ハム", "ウインナー", "サラダチキン", "スモークチキン", "焼豚", "鮭", "スモークサーモン", "鮭フレーク", "サバ", "サバ缶", "アジ", "あじの干物", "鰯", "ブリ", "鱈", "たらこ", "辛子明太子", "マグロ", "カツオ", "カレイ", "カンパチ", "さわら", "サンマ", "メカジキ", "金目鯛", "鯛", "白身魚", "イカ", "タコ", "ゆでたこ", "えび", "あさり", "しじみ", "牡蠣", "ホタテ", "ホタテ缶", "ムール貝", "しらす干し", "ちりめんじゃこ", "ツナ缶", "あさり缶", "カニのほぐし身缶", "かにかまぼこ", "かまぼこ", "ちくわ", "はんぺん", "イクラ", "シーフードミックス", "アンチョビ", "オイルサーディン", "うなぎの蒲焼き", "フォアグラ", "市販の生つみれ"
  ]) },
  { label: "卵・乳製品・大豆製品", icon: "🥚", names: new Set([
    "卵", "牛乳", "豆乳", "ヨーグルト", "生クリーム", "ホイップクリーム", "サワークリーム", "マーガリン", "クリームチーズ", "カマンベールチーズ", "チェダーチーズ", "スライスチーズ", "ピザ用チーズ", "粉チーズ", "プロセスチーズ", "モッツァレラチーズ", "マスカルポーネチーズ", "フェタチーズ", "木綿豆腐", "絹豆腐", "豆腐", "焼き豆腐", "高野豆腐", "厚揚げ", "油揚げ", "納豆", "大豆", "おから", "大豆ミート", "がんもどき", "引き上げ湯葉"
  ]) },
  { label: "主食・粉もの", icon: "🍚", names: new Set([
    "ご飯", "米", "もち米", "米粉", "押し麦", "オートミール", "うどん", "そば", "きしめん", "そうめん", "中華麺", "焼きそば麺", "インスタントラーメン", "スパゲッティ", "ペンネ", "マカロニ", "フジッリ", "生パスタシート", "ラザニア用パスタ", "フォー", "ビーフン", "春雨", "クスクス", "トルティーヤ", "食パン", "フランスパン", "コッペパン", "ホットドッグパン", "イングリッシュマフィン", "ベーグル", "バンズ", "全粒粉", "蕎麦粉", "ホットケーキミックス", "白玉粉", "だんご粉", "上新粉", "道明寺粉", "葛粉", "わらび粉", "角餅", "トッポギ用餅", "もち", "揚げ麺", "ライスペーパー", "ワンタンの皮", "餃子の皮", "春巻きの皮", "シュウマイの皮"
  ]) },
  { label: "果物・ナッツ", icon: "🍋", names: new Set([
    "いちご", "オレンジ", "キウイ", "さくらんぼ", "すだち", "バナナ", "ぶどう", "ブルーベリー", "マンゴー", "みかん", "もも", "桃", "ゆず", "ゆずの皮", "りんご", "レモン", "ライム", "アメリカンチェリー", "金柑", "柿", "梨", "レーズン", "クコの実", "ハスカップジャム", "アーモンド", "アーモンドスライス", "アーモンドプードル", "カシューナッツ", "くるみ", "ピーナッツ", "ペカンナッツ", "ミックスナッツ", "松の実", "落花生", "栗", "甘栗", "むき栗"
  ]) },
  { label: "豆・海藻・乾物", icon: "🫘", names: new Set([
    "小豆", "ゆであずき", "ひよこ豆", "ミックスビーンズ", "金時豆", "黒豆", "赤えんどう豆", "レッドキドニービーンズ", "ムングダール", "レンズ豆", "きな粉", "こんにゃく", "ひじき", "わかめ", "もずく", "あおさ", "海藻ミックス", "のり", "韓国のり", "昆布", "結び昆布", "カツオ節", "かつお厚削り", "粉かつお", "干ししいたけ", "切り干し大根", "かんぴょう", "寒天", "粉寒天", "粉ゼラチン"
  ]) },
  { label: "調味料・だし・缶詰", icon: "🧂", names: new Set([
    "トマト缶", "クリームコーン缶", "みかん缶", "黄桃缶", "白桃缶", "フルーツミックス缶", "トマトジュース", "トマトソース", "トマトピューレ", "トマトペースト", "カレールウ", "シチュールウ", "ハヤシルウ", "ビーフシチューのルウ", "デミグラスソース", "ミートソース", "ミートソース缶", "バジルペースト", "グリーンカレーペースト", "紅しょうが", "糸唐辛子", "揚げ玉", "ブラックオリーブ", "黒蜜", "黒みつ", "メープルシロップ", "キャラメルソース", "チョコレートソース", "チョコレートシロップ", "いちごジャム", "ブルーベリージャム", "ゆずジャム", "マーマレードジャム", "りんごジュース", "ココナッツミルク", "梅酒", "酒粕", "発酵ぬか床", "はちみつ漬け梅干し", "梅干し", "キムチ", "ザーサイ", "たくあん", "しば漬け", "野沢菜漬け", "らっきょうの甘酢漬け", "新生姜の甘酢漬け"
  ]) },
  { label: "加工食品・お菓子", icon: "🍪", names: new Set([
    "チョコレート", "ビスケット", "抹茶", "冷凍パイシート", "練乳", "アイスクリーム", "インスタントコーヒー", "紅茶ティーバッグ", "クルトン", "カステラ", "サイダー", "マシュマロ", "桜でんぶ", "五目ちらし寿司の素", "焼き芋"
  ]) },
];

// グループの中の小分類(上から順に表示)。ここに書いていない食材は、そのグループの rest の小分類に入る。
// 野菜は栄養での分け方(緑黄色野菜・淡色野菜)。ただし ねぎ・しそ・パセリ のように薬味として使うものは、
// 栄養では緑黄色野菜でも、見つけやすさを優先して「香味野菜・ハーブ」に入れる。
const PALETTE_SUBGROUPS = {
  "野菜・きのこ": { rest: "淡色野菜", subs: [
    ["緑黄色野菜", ["にんじん", "かぼちゃ", "トマト", "ミニトマト", "ピーマン", "パプリカ", "ブロッコリー", "ほうれん草", "小松菜", "チンゲン菜", "春菊", "水菜", "ニラ", "豆苗", "オクラ", "いんげん", "アスパラ", "ししとう", "絹さや", "スナップエンドウ", "菜の花", "かいわれ", "ブロッコリースプラウト", "ケール", "クレソン", "サラダ菜", "サンチュ", "グリーンリーフ", "ベビーリーフ", "ルッコラ", "せり", "高菜", "芽キャベツ"]],
    ["淡色野菜", ["玉ねぎ", "キャベツ", "白菜", "レタス", "プリーツレタス", "大根", "かぶ", "きゅうり", "なす", "もやし", "ごぼう", "れんこん", "たけのこ", "とうもろこし", "コーン", "ヤングコーン", "カリフラワー", "ズッキーニ", "ゴーヤー", "冬瓜", "ビーツ", "アボカド", "枝豆", "グリーンピース", "にんにくの芽", "ずいき", "ふき", "カット野菜"]],
    ["いも", ["じゃがいも", "さつまいも", "里芋", "長芋", "山芋", "大和芋"]],
    ["きのこ", ["しめじ", "しいたけ", "えのき", "まいたけ", "エリンギ", "マッシュルーム", "なめこ", "きくらげ", "ひらたけ", "ポルチーニ"]],
    ["香味野菜・ハーブ", ["ねぎ", "わけぎ", "にんにく", "しょうが", "しそ", "みょうが", "三つ葉", "パセリ", "セロリ", "パクチー", "バジル", "ミント", "ローズマリー", "行者にんにく"]],
  ] },
  "肉・魚介": { rest: "魚", subs: [
    ["鶏肉", ["鶏もも肉", "鶏むね肉", "ささみ", "手羽元", "手羽先", "鶏ひき肉", "鶏レバー", "鶏皮", "砂肝", "サラダチキン", "スモークチキン"]],
    ["豚肉", ["豚肉", "豚ひき肉", "豚レバー"]],
    ["牛肉・合いびき・ほかの肉", ["牛肉", "牛ひき肉", "合いびき肉", "牛ロース肉", "牛タン", "牛もつ", "牛脂", "ラムチョップ", "ラム薄切り肉", "鴨ロース肉", "フォアグラ"]],
    ["ハム・ベーコンなど", ["ベーコン", "ハム", "生ハム", "ウインナー", "焼豚"]],
    ["魚", []],
    ["えび・いか・たこ・貝", ["えび", "イカ", "タコ", "ゆでたこ", "あさり", "しじみ", "牡蠣", "ホタテ", "ムール貝", "シーフードミックス"]],
    ["魚卵・しらす・練り物・缶詰", ["たらこ", "辛子明太子", "イクラ", "しらす干し", "ちりめんじゃこ", "ツナ缶", "サバ缶", "ホタテ缶", "あさり缶", "カニのほぐし身缶", "オイルサーディン", "アンチョビ", "かにかまぼこ", "かまぼこ", "ちくわ", "はんぺん", "市販の生つみれ"]],
  ] },
  "卵・乳製品・大豆製品": { rest: "卵・乳製品", subs: [
    ["卵・乳製品", ["卵", "牛乳", "生クリーム", "ヨーグルト", "ホイップクリーム", "サワークリーム", "マーガリン"]],
    ["チーズ", ["ピザ用チーズ", "スライスチーズ", "粉チーズ", "クリームチーズ", "モッツァレラチーズ", "プロセスチーズ", "カマンベールチーズ", "チェダーチーズ", "マスカルポーネチーズ", "フェタチーズ"]],
    ["大豆製品", ["木綿豆腐", "絹豆腐", "豆腐", "焼き豆腐", "高野豆腐", "厚揚げ", "油揚げ", "がんもどき", "納豆", "豆乳", "大豆", "おから", "大豆ミート", "引き上げ湯葉"]],
  ] },
  "主食・粉もの": { rest: "粉・皮・もち", subs: [
    ["ご飯・米", ["ご飯", "米", "もち米", "押し麦", "オートミール"]],
    ["麺・パスタ", ["うどん", "そば", "そうめん", "きしめん", "中華麺", "焼きそば麺", "インスタントラーメン", "揚げ麺", "スパゲッティ", "ペンネ", "マカロニ", "フジッリ", "生パスタシート", "ラザニア用パスタ", "フォー", "ビーフン", "春雨", "クスクス"]],
    ["パン", ["食パン", "フランスパン", "コッペパン", "ホットドッグパン", "イングリッシュマフィン", "ベーグル", "バンズ", "トルティーヤ"]],
    ["粉・皮・もち", []],
  ] },
};
// 食材 → 小分類の名前(小分類のないグループは null)
function paletteSubgroup(groupLabel, name) {
  const def = PALETTE_SUBGROUPS[groupLabel];
  if (!def) return null;
  const hit = def.subs.find(([, names]) => names.includes(name));
  return hit ? hit[0] : def.rest;
}

// パレットに出す食材は、PALETTE_MIN_RECIPES 品以上のレシピに出てくるものだけ(めったに使わない食材は、入力欄に打てば使える)。
// 小分類ごとに最初は PALETTE_VISIBLE 品目だけ出し、残りは「もっと見る」で開く(小分類のないグループは PALETTE_VISIBLE_FLAT 品目)
const PALETTE_MIN_RECIPES = 3;
const PALETTE_VISIBLE = 6;
const PALETTE_VISIBLE_FLAT = 10;
const paletteExpanded = new Set();   // 「もっと見る」で開いた小分類(描き直しても開いたままにする)

function ingredientGroup(name, frequency) {
  if (PALETTE_HIDDEN.has(name)) return -1;
  // 料理名に近い一度きりの材料などを選択肢へ出すと、手持ち食材の一覧が読めなくなる
  if (frequency < PALETTE_MIN_RECIPES) return -1;
  const index = PALETTE_GROUPS.findIndex(group => group.names.has(name));
  // 未分類の食材は、最後のグループ(加工食品・お菓子)に入れる
  return index >= 0 ? index : PALETTE_GROUPS.length - 1;
}

// 「もっと見る」で隠す食材の表示を切り替える。選んでいる食材(使いたい・入れたくない)は、隠れる側でも必ず出す
function syncPaletteVisibility() {
  for (const chips of $("palette").querySelectorAll(".chips[data-section]")) {
    const open = paletteExpanded.has(chips.dataset.section);
    let hidden = 0;
    for (const btn of chips.querySelectorAll("button[data-name]")) {
      const collapse = btn.dataset.extra === "1" && !open && !btn.classList.contains("on") && !btn.classList.contains("ng");
      btn.classList.toggle("is-collapsed", collapse);
      if (collapse) hidden++;
    }
    const more = chips.querySelector(".palette-more");
    if (!more) continue;
    more.hidden = !open && hidden === 0;
    more.textContent = open ? "閉じる" : `+${hidden} もっと見る`;
    more.setAttribute("aria-expanded", String(open));
  }
}

function renderIngredientPalette(freq) {
  const palette = $("palette");
  palette.innerHTML = "";
  const grouped = PALETTE_GROUPS.map(() => []);
  [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b, "ja"))
    .forEach(name => {
      const index = ingredientGroup(name, freq.get(name));
      if (index >= 0) grouped[index].push(name);
    });
  PALETTE_GROUPS.forEach((group, index) => {
    if (!grouped[index].length) return;
    const details = document.createElement("details");
    details.className = "ingredient-group";
    details.open = index === 0;
    const summary = document.createElement("summary");
    summary.innerHTML = `<span>${group.icon} ${group.label}</span><small>${grouped[index].length}品目</small>`;
    details.append(summary);
    // 小分類があるグループは、小分類ごとに見出しを付けて分ける(小分類の中は登場回数の多い順のまま)
    const def = PALETTE_SUBGROUPS[group.label];
    const sections = def
      ? def.subs.map(([label]) => [label, grouped[index].filter(name => paletteSubgroup(group.label, name) === label)])
      : [[null, grouped[index]]];
    for (const [label, names] of sections) {
      if (!names.length) continue;
      if (label) {
        const heading = document.createElement("p");
        heading.className = "palette-subgroup";
        heading.textContent = label;
        details.appendChild(heading);
      }
      const chips = document.createElement("div");
      chips.className = "chips";
      // 隠れるのが2品目以下なら、「もっと見る」を出さずに全部出す(ボタンを押す手間のほうが大きい)
      const base = label ? PALETTE_VISIBLE : PALETTE_VISIBLE_FLAT;
      const key = `${group.label}/${label || ""}`, limit = names.length <= base + 2 ? names.length : base;
      chips.dataset.section = key;
      names.forEach((name, i) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = name; b.dataset.name = name;
        if (i >= limit) b.dataset.extra = "1";
        b.addEventListener("click", () => togglePalette(name));
        chips.appendChild(b);
      });
      if (names.length > limit) {
        const more = document.createElement("button");
        more.type = "button"; more.className = "palette-more";
        more.addEventListener("click", () => {
          if (paletteExpanded.has(key)) paletteExpanded.delete(key); else paletteExpanded.add(key);
          syncPaletteVisibility();
        });
        chips.appendChild(more);
      }
      details.appendChild(chips);
    }
    palette.appendChild(details);
  });
  syncPaletteVisibility();
}

function makeChips(container, values, set) {
  for (const v of values) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = v;
    b.addEventListener("click", () => {
      if (set.has(v)) set.delete(v); else set.add(v);
      b.classList.toggle("on", set.has(v));
      refresh();
    });
    container.appendChild(b);
  }
}

function bindRange(id, key) {
  $(id).addEventListener("input", e => { state[key] = +e.target.value; refresh(); });
  state[key] = +$(id).value;
}

// データに含まれる材料数まで、横軸の上限を1個刻みで選べるようにする。
// 実際の不足食材数は材料数を超えないため、データ更新後も選択肢が不足しない。
function configureXRange(recipes) {
  const select = $("x-range");
  const max = Math.max(1, d3.max(recipes, r => r.ingredients.length) || 1);
  const initial = Math.min(state.xRangeMax ?? 5, max);
  select.replaceChildren();
  for (let limit = 1; limit <= max; limit++) {
    const option = document.createElement("option");
    option.value = String(limit);
    option.textContent = `0〜${limit}個`;
    if (limit === initial) option.selected = true;
    select.appendChild(option);
  }
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "すべて";
  select.appendChild(all);
  state.xRangeMax = initial;
}

function init(data) {
  state.recipes = data.recipes;
  state.master = data.ingredients;
  aliasMap = buildAliasMap(data.ingredients);
  configureXRange(data.recipes);
  const recipeIds = new Set(data.recipes.map(r => r.id));
  state.favorites = new Set(loadFavorites().filter(id => recipeIds.has(id)));

  // 食材パレット(登場回数の多い順)
  const freq = d3.rollup(data.recipes.flatMap(r => r.ingredients.map(i => i.name)), v => v.length, d => d);
  renderIngredientPalette(freq);
  document.querySelectorAll("input[name=pmode]").forEach(r =>
    r.addEventListener("change", e => { state.paletteMode = e.target.value; }));

  // 調理器具(初期状態はすべて使える)
  const rank = t => (TOOL_ORDER.includes(t) ? TOOL_ORDER.indexOf(t) : 99);
  const tools = [...new Set(data.recipes.flatMap(r => r.tools))].sort((a, b) => rank(a) - rank(b));
  for (const t of tools) {
    state.tools.add(t);
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" checked> ${t}`;
    const checkbox = label.querySelector("input");
    checkbox.value = t;
    checkbox.addEventListener("change", e => {
      if (e.target.checked) state.tools.add(t); else state.tools.delete(t);
      refresh();
    });
    $("tools").appendChild(label);
  }

  const styles = STYLES.filter(s => data.recipes.some(r => r.style === s));
  makeChips($("categories"), CATEGORIES, state.categories);
  makeChips($("styles"), styles, state.styles);
  makeChips($("tastes"), TASTES, state.tastes);

  for (let m = 1; m <= 12; m++) {
    const o = document.createElement("option");
    o.value = m; o.textContent = `${m}月`;
    if (m === state.month) o.selected = true;
    $("month").appendChild(o);
  }
  $("month").addEventListener("change", e => { state.month = +e.target.value; refresh(); });
  $("season-only").addEventListener("change", e => { state.seasonOnly = e.target.checked; refresh(); });
  $("use-substitutes").checked = state.useSubstitutes;
  $("use-substitutes").addEventListener("change", e => setUseSubstitutes(e.target.checked));

  bindRange("time", "maxTime");
  bindRange("price", "maxPrice");
  bindRange("kcal", "maxKcal");
  bindRange("protein", "minProtein");
  bindRange("missing", "maxMissing");
  $("sort").addEventListener("change", e => { state.sort = e.target.value; refresh(); });
  $("y-axis").addEventListener("change", e => { state.yAxis = e.target.value; refresh(); });
  $("x-range").addEventListener("change", e => {
    state.xRangeMax = e.target.value === "all" ? null : +e.target.value;
    refresh();
  });
  // 散布図の点で出す数と、拡大・縮小
  $("scatter-top-n").addEventListener("change", e => { state.scatterTopN = +e.target.value; refresh(); });
  $("scatter-zoom-in").addEventListener("click", () => Viz.scatterZoomBy(1.6));
  $("scatter-zoom-out").addEventListener("click", () => Viz.scatterZoomBy(1 / 1.6));
  $("scatter-zoom-reset").addEventListener("click", () => Viz.scatterZoomReset());
  $("ready-compare-x").addEventListener("change", e => { state.compareXAxis = e.target.value; refresh(); });
  $("ready-compare-y").addEventListener("change", e => { state.compareYAxis = e.target.value; refresh(); });
  $("tree-level-1").addEventListener("change", refresh);
  $("tree-level-2").addEventListener("change", refresh);
  $("tree-level-3").addEventListener("change", refresh);
  $("network-limit").addEventListener("change", refresh);
  $("network-layout").addEventListener("change", refresh);
  document.querySelectorAll("[data-discovery-view]").forEach(button => button.addEventListener("click", () => {
    state.discoveryView = button.dataset.discoveryView;
    refresh();
  }));

  $("ing-input").addEventListener("input", () => { readHave(); refresh(); });
  $("ex-input").addEventListener("input", () => { readExclude(); refresh(); });
  setupSuggest($("ing-input"), suggestCandidates(data.recipes, data.ingredients, false), () => { readHave(); refresh(); });
  setupSuggest($("ex-input"), suggestCandidates(data.recipes, data.ingredients, true), () => { readExclude(); refresh(); });
  $("recipe-name-input").addEventListener("input", event => { state.nameQuery = event.target.value.trim(); refresh(); });
  $("servings-min").addEventListener("change", event => { state.minServings = +event.target.value; refresh(); });
  $("missing-min").addEventListener("change", event => {
    state.minMissing = +event.target.value;
    if (state.minMissing > state.maxMissing) {
      state.maxMissing = state.minMissing;
      $("missing").value = String(state.maxMissing);
    }
    refresh();
  });
  $("missing").addEventListener("input", event => {
    if (state.minMissing > +event.target.value) {
      state.minMissing = +event.target.value;
      $("missing-min").value = String(state.minMissing);
      refresh();
    }
  });
  // ヘッダーの検索欄は、既存の「今ある食材」検索へ接続する。
  // 新しい検索ロジックは増やさず、Enter 時だけ既存の絞り込みを実行する。
  $("header-search").addEventListener("submit", event => {
    event.preventDefault();
    const query = $("header-search-input").value.trim();
    if (!query) return;
    $("ing-input").value = query;
    readHave();
    refresh();
    $("ing-input").focus();
  });
  window.addEventListener("resize", refresh);

  Viz.init({
    styles,
    onSelect: id => {
      // 同じ料理をもう一度選ぶと解除する。選択状態は hover とは独立して保持する。
      if (state.selected === id) {
        state.selected = null;
        d3.select("#detail").classed("open", false);
        refresh();
        return;
      }
      state.selected = id;
      refresh();
    },
    onClose: () => { state.selected = null; refresh(); },
    onCompare: toggleReadyComparison,
    onFavorite: toggleFavorite,
    isFavorite: id => state.favorites.has(id),
  });
  d3.selectAll(".legend-sub").style("display", state.useSubstitutes ? null : "none");   // 代用OFFなら凡例も隠す

  // ベクトル検索側から既存のレシピ詳細パネルを開くための公開イベント。
  // 新しい検索モジュールが内部の state や評価処理に直接依存しない構造にする。
  window.addEventListener("recipe-vector-select", event => {
    const recipe = state.recipes.find(r => r.id === event.detail?.id);
    if (!recipe) return;
    state.selected = recipe.id;
    Viz.showDetail(evaluate(recipe), state.master);
  });

  $("results-page-size").addEventListener("change", event => {
    resultPageSize = Number(event.target.value);
    resultPage = 0;
    renderPagedRows(visibleRows, visibleHasInput, state.selected);
  });
  $("results-prev").addEventListener("click", () => {
    if (resultPage > 0) { resultPage--; renderPagedRows(visibleRows, visibleHasInput, state.selected); }
  });
  $("results-next").addEventListener("click", () => {
    resultPage++; renderPagedRows(visibleRows, visibleHasInput, state.selected);
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has("have")) $("ing-input").value = params.get("have");
  if (params.has("name")) {
    $("recipe-name-input").value = params.get("name");
    state.nameQuery = $("recipe-name-input").value.trim();
  }
  const setRangeFromParam = (param, id, key) => {
    if (!params.has(param)) return;
    const input = $(id);
    const value = Math.max(+input.min, Math.min(+input.max, Number(params.get(param))));
    if (!Number.isFinite(value)) return;
    input.value = String(value);
    state[key] = value;
  };
  setRangeFromParam("time", "time", "maxTime");
  setRangeFromParam("price", "price", "maxPrice");
  setRangeFromParam("maxMissing", "missing", "maxMissing");
  if (params.has("minMissing")) {
    const value = Math.max(0, Math.min(3, Number(params.get("minMissing"))));
    if (Number.isFinite(value)) { state.minMissing = value; $("missing-min").value = String(value); }
  }
  if (params.has("minServings")) {
    const value = Math.max(1, Math.min(4, Number(params.get("minServings"))));
    if (Number.isFinite(value)) { state.minServings = value; $("servings-min").value = String(value); }
  }
  const selectChipFromParam = (param, values, set, container) => {
    const value = params.get(param);
    if (!value || !values.includes(value)) return;
    set.add(value);
    container.querySelectorAll("button").forEach(button => {
      button.classList.toggle("on", button.textContent === value);
    });
  };
  selectChipFromParam("category", CATEGORIES, state.categories, $("categories"));
  selectChipFromParam("style", styles, state.styles, $("styles"));
  const requestedTools = params.getAll("tool").filter(tool => tools.includes(tool));
  if (requestedTools.length) {
    state.tools = new Set(requestedTools);
    $("tools").querySelectorAll("input").forEach(checkbox => {
      checkbox.checked = state.tools.has(checkbox.value);
    });
  }
  if (params.get("view") === "scatter") state.discoveryView = "scatter";
  const openId = params.get("open");
  if (openId && state.recipes.some(r => r.id === openId)) state.selected = openId;

  readHave(); readExclude();
  refresh();
}

RecipeData.load()
  .then(init)
  .catch(err => {
    console.error(err);
    $("summary-text").textContent = "レシピデータを読み込めませんでした。VSCode の Live Server で開いてください。";
  });
