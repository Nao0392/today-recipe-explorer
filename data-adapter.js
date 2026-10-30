// 共通レシピデータローダー。全画面はこのモジュールのみを経由してデータを読み込む。
// 正規化済みデータを改変せずに利用する。旧形式の配列は互換用に変換する。
const RecipeData = (() => {
  const SOURCE = "data/delish_teiban_photo.json";
  const season = { "ブロッコリー": [11, 12, 1, 2, 3], "キャベツ": [11, 12, 1, 2, 3], "トマト": [6, 7, 8, 9], "なす": [6, 7, 8, 9], "きゅうり": [6, 7, 8, 9], "かぼちゃ": [9, 10, 11, 12], "大根": [11, 12, 1, 2], "白菜": [11, 12, 1, 2], "ほうれん草": [11, 12, 1, 2], "新玉ねぎ": [3, 4, 5], "じゃがいも": [5, 6, 7, 8, 9, 10] };
  const has = (text, words) => words.some(word => text.includes(word));
  const categoryOf = r => { const text = `${r.name} ${(r.tags || []).join(" ")}`; if (has(text, ["デザート", "ケーキ", "クッキー", "プリン", "ゼリー", "スイーツ"])) return "デザート"; if (has(text, ["汁", "スープ", "味噌汁"])) return "汁物"; if (has(text, ["ごはん", "丼", "パスタ", "うどん", "そば", "麺", "チャーハン", "カレー"])) return "主食"; if (has(text, ["副菜", "サラダ", "和え", "おひたし", "漬け"])) return "副菜"; return "主菜"; };
  const styleOf = r => has(`${r.name} ${(r.tags || []).join(" ")}`, ["中華", "麻婆", "餃子", "春巻き"]) ? "中華" : has(`${r.name} ${(r.tags || []).join(" ")}`, ["カレー", "ナン", "タンドリー"]) ? "インド風" : has(`${r.name} ${(r.tags || []).join(" ")}`, ["キムチ", "ビビンバ", "韓国"]) ? "韓国風" : has(`${r.name} ${(r.tags || []).join(" ")}`, ["パスタ", "グラタン", "シチュー", "オムレツ", "ピザ"]) ? "洋風" : "和風";
  const toolsOf = r => { const text = (r.steps || []).join(" "), tools = []; if (has(text, ["レンジ", "電子レンジ"])) tools.push("電子レンジ"); if (has(text, ["オーブン", "トースター"])) tools.push("オーブン"); if (has(text, ["フライパン", "焼", "炒"])) tools.push("フライパン"); if (has(text, ["鍋", "ゆで", "煮", "沸騰"])) tools.push("鍋"); return tools.length ? tools : ["ボウル"]; };
  const emojiOf = (r, category) => category === "デザート" ? "🍰" : category === "汁物" ? "🥣" : has(r.name, ["鶏", "チキン"]) ? "🍗" : has(r.name, ["魚", "鮭", "サバ", "さば"]) ? "🐟" : has(r.name, ["肉", "豚", "牛"]) ? "🥩" : has(r.name, ["サラダ", "野菜"]) ? "🥗" : "🍽️";
  const tasteOf = r => { const text = (r.pantry_ingredients || []).join(" "), taste = []; const sweet = has(text, ["砂糖", "みりん", "はちみつ"]) ? 2 : 0, sour = has(text, ["酢", "レモン"]) ? 3 : 0, spicy = has(text, ["唐辛子", "ラー油", "豆板醤", "こしょう", "わさび"]) ? 3 : 0; if (sweet) taste.push("甘い"); if (sour) taste.push("酸っぱい"); if (spicy) taste.push("辛い"); taste.push((r.kcal_per_serving || 0) >= 450 ? "こってり" : "あっさり"); return { taste, taste_level: { sweet, sour, spicy } }; };
  // 既存の非正規化JSONも読み込めるようにするための互換変換。
  function normalize(raw) {
    const master = {};
    const recipes = raw.map(r => {
      const ingredients = (r.ingredients || []).filter(i => !i.is_pantry).map(i => {
        const name = i.name;
        master[name] ||= { unit: i.unit || "", season: season[name] || [], aliases: [] };
        if (i.raw_name && i.raw_name !== name && !master[name].aliases.includes(i.raw_name)) master[name].aliases.push(i.raw_name);
        return { name, amount: i.quantity || i.grams || 1 };
      });
      const category = categoryOf(r), taste = tasteOf(r);
      return { id: String(r.id), name: r.name, country: "日本", style: styleOf(r), category,
        emoji: emojiOf(r, category), image: null, time_min: r.cooking_minutes || 30,
        tools: toolsOf(r), price: r.cost_yen || 0, ...taste,
        nutrition: { kcal: r.kcal_per_serving || 0, protein: 0, fat: 0, carb: 0 },
        ingredients, pantry: r.pantry_ingredients || [], steps: r.steps || [], source_url: r.url };
    }).filter(r => r.ingredients.length);
    return { ingredients: master, recipes, meta: { source: 'legacy-array', recipes: recipes.length } };
  }

  function validate(data) {
    if (!data || !Array.isArray(data.recipes) || !data.ingredients || typeof data.ingredients !== 'object') {
      throw new Error('レシピデータの形式が正しくありません（ingredientsとrecipesが必要です）。');
    }
    if (data.recipes.length < 2) throw new Error('比較には2品以上のレシピが必要です。');
    return data;
  }
  function audit(data) {
    const seen = new Set(), names = new Set(), result = {
      total: data.recipes.length, valid: 0, duplicateIds: 0, duplicateNames: 0,
      missingName: 0, missingIngredients: 0, missingTime: 0, missingPrice: 0,
      missingNutrition: 0
    };
    for (const recipe of data.recipes) {
      if (!recipe || recipe.id == null || !String(recipe.id).trim()) continue;
      const id = String(recipe.id), name = String(recipe.name || '').normalize('NFKC').trim();
      if (seen.has(id)) { result.duplicateIds++; continue; }
      seen.add(id);
      if (!name) result.missingName++;
      else if (names.has(name)) result.duplicateNames++;
      names.add(name);
      if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) result.missingIngredients++;
      if (!Number.isFinite(recipe.time_min)) result.missingTime++;
      if (!Number.isFinite(recipe.price)) result.missingPrice++;
      if (!recipe.nutrition || !Number.isFinite(recipe.nutrition.kcal)) result.missingNutrition++;
      result.valid++;
    }
    return result;
  }
  let dataPromise, sourceLabel = SOURCE;
  function accept(raw) {
    const data = validate(Array.isArray(raw) ? normalize(raw) : raw);
    const result = audit(data);
    if (result.duplicateIds || result.missingName || result.missingIngredients) {
      console.warn('[RecipeData] データの品質に注意:', result);
    }
    return data;
  }
  function load() {
    if (!dataPromise) {
      // 通信そのものの失敗(オフラインなど)も、どのファイルが読めなかったか分かるようにする
      dataPromise = fetch(SOURCE).catch(err => {
        throw new Error(`レシピを取得できません: ${SOURCE} (${err.message})`);
      }).then(res => {
        if (!res.ok) throw new Error(`レシピを取得できません: ${SOURCE} (HTTP ${res.status})`);
        return res.json();
      }).then(accept).catch(err => { dataPromise = undefined; throw err; });
    }
    return dataPromise;
  }
  // Discovery Atlas の手動JSON選択を維持し、選択後は新しい読み込みに切り替える。
  function setData(raw, label = '手動で選んだJSON') {
    const data = accept(raw);
    sourceLabel = label;
    dataPromise = Promise.resolve(data);
    return data;
  }
  return { SOURCE, load, setData, audit, getSource: () => sourceLabel };
})();
