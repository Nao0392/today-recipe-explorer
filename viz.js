// viz.js — D3 による描画(散布図・候補の行チャート・レシピ詳細)
const Viz = (() => {
  const ROW_H = 104, THUMB_W = 120, THUMB_H = 90, LABEL_W = 360, RIGHT_W = 96, PAD = 4, SEG_H = 36;
  const tooltip = d3.select("#tooltip");
  const STYLE_COLORS = ["#f26b38", "#f2ad3d", "#5bbf9a", "#4aa8c5", "#7c6ed6", "#db6f9f", "#8bbf4a", "#e7794f"];
  let color = d3.scaleOrdinal(STYLE_COLORS);
  let onSelect = () => {}, onClose = () => {}, onFavorite = () => {}, onCompare = () => {}, isFavorite = () => false;
  let treeExpanded = new Set(["root"]);
  // 分類ごとに表示している料理の数(path → 品数)。「さらに表示」で12品ずつ増える
  const TREE_PAGE = 12;
  const treeShown = new Map();
  let ingredientNetworkFocus = null, ingredientNetworkSimulation = null;

  const yen = v => `¥${v}`;
  // recipes.json の image にURLを入れると、絵文字の代わりに写真を表示する。
  function thumb(d, width, height = width) {
    const emoji = d.emoji || "🍽️";
    const box = `width:${width}px;height:${height}px`;
    const emojiSize = Math.round(Math.min(width, height) * .62);
    if (!d.image) return `<span class="thumb thumb-emoji" style="${box};font-size:${emojiSize}px">${emoji}</span>`;
    return `<span class="thumb thumb-photo" style="${box}"><img src="${d.image}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="thumb-emoji" style="font-size:${emojiSize}px" hidden>${emoji}</span></span>`;
  }
  // 0.25 → 1/4 のように分数で表示
  function fmtAmount(v) {
    const whole = Math.floor(v + 1e-9), frac = v - whole;
    const map = [[0.125, "1/8"], [1 / 6, "1/6"], [0.2, "1/5"], [0.25, "1/4"], [1 / 3, "1/3"], [0.5, "1/2"], [2 / 3, "2/3"], [0.75, "3/4"], [5 / 6, "5/6"]];
    const f = map.find(([x]) => Math.abs(x - frac) < 0.01);
    if (frac < 0.01) return `${whole}`;
    if (f) return whole ? `${whole}と${f[1]}` : f[1];
    return d3.format(".2~f")(v);
  }

  const FRACTION_UNITS = new Set(["個", "本", "枚", "束", "パック", "袋", "玉", "株", "缶", "切れ", "房", "粒"]);

  function unitFromRaw(raw) {
    const match = String(raw || "").match(/(大さじ|小さじ|パック|個|本|枚|束|袋|玉|株|缶|切れ|房|粒|g|ml|cc)/);
    if (!match) return "";
    return match[1] === "cc" ? "ml" : match[1];
  }

  // 元の表記(レシピ全体の分量)の数を、表示人数に合わせて掛け直す。「1枚（200g）」を2人分→1人分なら「1/2枚(100g)」
  // 数が書いていない(適量など)ときは null
  function scaleRawAmount(raw, factor) {
    const text = raw.replace(/（/g, "(").replace(/）/g, ")");
    const num = /(?:(\d+)と(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:\.\d+)?))\s*(g|ml|mL|cc)?/g;
    if (!num.test(text)) return null;
    return text.replace(num, (m, w, a, b, c, d, n, gUnit) => {
      const v = (w ? +w + a / b : c ? c / d : +n) * factor;
      return gUnit ? `${Math.max(1, Math.round(v))}${gUnit === "cc" ? "ml" : gUnit}` : fmtAmount(v);
    });
  }

  function formatIngredientAmount(item, multiplier, master, recipe) {
    const raw = String(item.raw || "");
    const spoon = item.spoon && typeof item.spoon.amount === "number" && Number.isFinite(item.spoon.amount) ? item.spoon : null;
    // 材料の amount は、材料ごとの単位(master の unit。多くは g)での1人前の量。元の表記の単位(枚・本)とは限らない
    if (!spoon && !item.unit && !item.estimated && recipe) {
      const scaled = scaleRawAmount(raw, multiplier * (recipe.scaled_to_serving || 1) / (recipe.source_servings || 1));
      if (scaled) return scaled;
    }
    const unit = spoon?.unit || item.unit || master[item.name]?.unit || unitFromRaw(raw) || "";
    const baseAmount = spoon ? spoon.amount : item.amount;
    const isFiniteAmount = typeof baseAmount === "number" && Number.isFinite(baseAmount);
    const amount = isFiniteAmount ? baseAmount * multiplier : NaN;
    const sourceLabel = raw.includes("少々") ? "少々" : raw.includes("適量") ? "適量" : "";

    if (!isFiniteAmount) return sourceLabel || "—";

    const formatted = FRACTION_UNITS.has(unit) || unit === "大さじ" || unit === "小さじ"
      ? fmtAmount(amount)
      : unit === "g" || unit === "ml"
        ? String(Math.round(amount))
        : fmtAmount(amount);
    // さじ・カップはサイトと同じく単位を先に書く(大さじ1)
    const display = /^(大さじ|小さじ|カップ)$/.test(unit) ? `${unit}${formatted}` : `${formatted}${unit}`;

    // 適量・少々をデータ補完している場合、確定値のように見せない。
    if (item.estimated && sourceLabel) return `${sourceLabel}（目安: ${display}）`;
    if (item.estimated) return `目安: ${display}`;
    return display;
  }

  function init(opts) {
    onSelect = opts.onSelect; onClose = opts.onClose;
    onFavorite = opts.onFavorite || onFavorite;
    onCompare = opts.onCompare || onCompare;
    isFavorite = opts.isFavorite || isFavorite;
    // レシピカードは再描画のたびに作り直されるため、♡ごとにイベントを
    // 付け直さず、documentで一度だけ受ける。これなら何回更新しても失われない。
    if (!document.documentElement.dataset.favoriteDelegation) {
      document.documentElement.dataset.favoriteDelegation = "true";
      document.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : event.target.parentElement;
        const control = target?.closest("[data-favorite-id]");
        if (!control) return;
        const id = control.dataset.favoriteId;
        if (!id) return;
        toggleFavoriteFromControl(event, { id, name: control.dataset.recipeName || "料理" }, control);
      }, true);
    }
    color = d3.scaleOrdinal(opts.styles, STYLE_COLORS);
    const lg = d3.select("#legend");
    lg.selectAll("span.item").data(opts.styles).join("span").attr("class", "item")
      .html(s => `<i style="background:${color(s)}"></i>${s}`);
    lg.append("span").html(`<i class="missing"></i>足りない食材`);
    lg.append("span").attr("class", "legend-sub").html(`<i class="sub"></i>代用できる食材・<b class="sub-mark-inline">代</b>代用ありの料理`);
    lg.append("span").html(`<i class="season"></i> 旬の食材`);
    d3.select("#detail .close").on("click", () => {
      d3.select("#detail").classed("open", false);
      highlight(null);
      onClose();
    });
  }

  function showTip(event, html) {
    tooltip.attr("hidden", null).html(html)
      .style("left", `${event.pageX + 14}px`).style("top", `${event.pageY + 14}px`);
  }
  const hideTip = () => tooltip.attr("hidden", true);
  // 代用の説明(「鶏肉→豚肉」)。代用が無ければ空文字
  const subText = d => (d.substituted || []).map(s => `${s.name}→${s.use}`).join("、");
  const tipHtml = d => `<div class="tip-head">${thumb(d, 42)}<div><b>${d.name}</b><br><span>${d.country}・${d.style}</span></div></div>
      ${d.time_min}分・${yen(d.price)}・${d.nutrition.kcal}kcal<br>
      辛さ ${d.taste_level.spicy}・甘さ ${d.taste_level.sweet}・酸っぱさ ${d.taste_level.sour}(0〜5)<br>
      ${subText(d) ? `<span class="tip-sub">代用: ${subText(d)}</span><br>` : ""}
      ${d.reason ? `<span style="color:#c0392b">条件外: ${d.reason}</span>` : "クリックでレシピを表示"}`;

  function highlight(id) {
    d3.selectAll("#chart g.row").classed("hl", d => d.id === id);
    d3.selectAll("#scatter g.dot").classed("hl", d => d.id === id)
      .filter(d => d.id === id).raise();
  }

  function setFavoriteControl(node, recipe, favorite) {
    const control = d3.select(node);
    const label = `${recipe.name}をお気に入りに${favorite ? "登録済み" : "登録"}`;
    control.classed("is-favorite", favorite)
      .attr("aria-pressed", favorite ? "true" : "false")
      .attr("aria-label", label)
      .text(favorite ? "♥" : "♡");
    // 再描画を待たずに、押したハート自身を即座に切り替える。
    control.classed("favorite-pop", false);
    void node.getBoundingClientRect();
    control.classed("favorite-pop", true);
  }

  function toggleFavoriteFromControl(event, recipe, control = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();
    const favorite = !isFavorite(recipe.id);
    setFavoriteControl(control, recipe, favorite);
    onFavorite(recipe.id);
  }

  function animateFavoriteCard(node, keyframes) {
    if (!node.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
    return node.animate(keyframes, { duration: 240, easing: "cubic-bezier(.2,.8,.25,1)", fill: "both" });
  }

  // 削除対象そのものはすぐDOMから外し、見た目だけを複製して退場させる。
  // 次のrefreshに削除途中の実カードが混ざらないため、状態と画面がずれない。
  function animateFavoriteRemoval(node) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || !node.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ghost = node.cloneNode(true);
    ghost.classList.add("favorite-card--ghost");
    Object.assign(ghost.style, {
      position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: "0",
      zIndex: "1000", pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    const removeGhost = () => ghost.remove();
    const animation = ghost.animate([
      { opacity: 1, transform: "translateY(0) scale(1)" },
      { opacity: 0, transform: "translateY(-8px) scale(.96)" },
    ], { duration: 220, easing: "ease-out", fill: "forwards" });
    animation.onfinish = removeGhost;
    window.setTimeout(removeGhost, 600);
  }

    // ---------- 散布図:足りない食材の数 × 選んだ指標 ----------
  // 縦軸の候補。味は 0〜5 の段階なので範囲を固定する。dir は軸の向きのヒント
  const Y_AXES = {
    time:  { label: "調理時間", dir: "↓短い ↑長い", get: d => d.time_min, fmt: v => `${v}分` },
    price: { label: "1人前の価格(目安)", dir: "↓安い ↑高い", get: d => d.price, fmt: yen },
    kcal:  { label: "カロリー(1人前・目安)", dir: "↓低い ↑高い", get: d => d.nutrition.kcal, fmt: v => `${v}kcal` },
    spicy: { label: "辛さ(0〜5)", dir: "↓弱い ↑強い", get: d => d.taste_level.spicy, fixed: [0, 5] },
    sweet: { label: "甘さ(0〜5)", dir: "↓弱い ↑強い", get: d => d.taste_level.sweet, fixed: [0, 5] },
    sour:  { label: "酸っぱさ(0〜5)", dir: "↓弱い ↑強い", get: d => d.taste_level.sour, fixed: [0, 5] },
  };

  // ---------- 今すぐ作れる料理: ランキングと比較グラフ ----------
  function renderReadyRanking(recipes, compareIds = new Set(), selectedId = null) {
    const root = d3.select("#ready-ranking");
    if (root.empty()) return;
    if (!recipes.length) {
      root.html('<p class="ready-empty">選んだ食材だけで作れる料理はありません。食材を追加するか、散布図で買い足し候補を探してみてください。</p>');
      return;
    }
    const rows = root.selectAll("article.ready-rank-row").data(recipes, d => d.id).join(
      enter => {
        const row = enter.append("article").attr("class", "ready-rank-row");
        row.append("button").attr("type", "button").attr("class", "ready-rank-open");
        row.append("button").attr("type", "button").attr("class", "ready-rank-compare");
        return row;
      },
      update => update,
      exit => exit.remove()
    );
    rows.classed("selected", d => d.id === selectedId);
    rows.select("button.ready-rank-open")
      .attr("aria-label", d => `${d.name}の詳細を表示`)
      // 代用して作れる料理は、料理名の横に「代」マーク、下の行に「代用: 鶏もも肉→豚肉」を出す
      .html((d, i) => `<span class="ready-rank-num">${i + 1}</span><span class="ready-rank-copy"><b>${d.name}${subText(d) ? ` <i class="sub-mark-inline" title="代用: ${subText(d)}">代</i>` : ""}</b><small>${d.style}・${d.category}　${yen(d.price)}・材料${d.ingredients.length}品${subText(d) ? `<span class="tip-sub">・代用: ${subText(d)}</span>` : ""}</small></span><strong>${d.time_min}分</strong>`)
      .on("click", (_, d) => onSelect(d.id));
    rows.select("button.ready-rank-compare")
      .classed("active", d => compareIds.has(d.id))
      .attr("aria-pressed", d => compareIds.has(d.id) ? "true" : "false")
      .attr("aria-label", d => `${d.name}を比較${compareIds.has(d.id) ? "から外す" : "に追加"}`)
      .text(d => compareIds.has(d.id) ? "比較中" : "比較")
      .on("click", (event, d) => { event.stopPropagation(); onCompare(d.id); });
  }

  const READY_COMPARE_AXES = {
    time: { label: "調理時間", value: d => d.time_min, format: v => `${v}分` },
    price: { label: "価格（1人前）", value: d => d.price, format: yen },
    ingredients: { label: "使う材料数", value: d => d.ingredients.length, format: v => `${v}品` },
    kcal: { label: "カロリー（1人前）", value: d => d.nutrition.kcal, format: v => `${v}kcal` },
  };

  function renderReadyComparison(recipes, xKey = "time", yKey = "price") {
    const svg = d3.select("#ready-comparison-scatter");
    if (svg.empty()) return;
    const xAxis = READY_COMPARE_AXES[xKey] || READY_COMPARE_AXES.time;
    const yAxis = READY_COMPARE_AXES[yKey] || READY_COMPARE_AXES.price;
    const W = svg.node().getBoundingClientRect().width || 530, H = 170;
    const m = { t: 18, r: 22, b: 42, l: 56 };
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    if (!recipes.length) {
      svg.selectAll("*").remove();
      svg.append("text").attr("class", "ready-compare-empty").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
        .text("左の「比較」ボタンから、比べたい料理を選んでください");
      return;
    }
    const x = d3.scaleLinear().domain([0, (d3.max(recipes, xAxis.value) || 1) * 1.12]).nice().range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, (d3.max(recipes, yAxis.value) || 1) * 1.12]).nice().range([H - m.b, m.t]);
    svg.selectAll("text.ready-compare-empty").remove();
    svg.selectAll("g.ready-compare-grid").data([0]).join("g").attr("class", "ready-compare-grid")
      .attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.selectAll("g.ready-compare-x-axis").data([0]).join("g").attr("class", "ready-compare-axis ready-compare-x-axis")
      .attr("transform", `translate(0,${H - m.b})`).transition().duration(duration).call(d3.axisBottom(x).ticks(4).tickFormat(xAxis.format));
    svg.selectAll("g.ready-compare-y-axis").data([0]).join("g").attr("class", "ready-compare-axis ready-compare-y-axis")
      .attr("transform", `translate(${m.l},0)`).transition().duration(duration).call(d3.axisLeft(y).ticks(4).tickFormat(yAxis.format));
    svg.selectAll("text.ready-compare-axis-label").data([
      { key: "x", text: xAxis.label, x: W - m.r, y: H - 7, anchor: "end" },
      { key: "y", text: yAxis.label, x: m.l + 3, y: 11, anchor: "start" },
    ], d => d.key).join("text").attr("class", "ready-compare-axis-label")
      .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", d => d.anchor).text(d => d.text);
    const dots = svg.selectAll("g.ready-compare-dot").data(recipes, d => d.id).join(
      enter => {
        const g = enter.append("g").attr("class", "ready-compare-dot").attr("opacity", 0);
        g.append("circle").attr("r", 10);
        g.append("text").attr("class", "ready-compare-dot-name").attr("dy", ".35em");
        return g;
      },
      update => update,
      exit => exit.transition().duration(duration).attr("opacity", 0).remove()
    );
    dots.attr("tabindex", 0).attr("role", "button").attr("aria-label", d => `${d.name}の詳細を表示`)
      .on("mouseenter", (event, d) => showTip(event, tipHtml(d))).on("mousemove", (event, d) => showTip(event, tipHtml(d))).on("mouseleave", hideTip)
      .on("click", (_, d) => onSelect(d.id)).on("keydown", (event, d) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(d.id); } });
    dots.select("circle").attr("fill", d => color(d.style)).attr("fill-opacity", .32).attr("stroke", d => color(d.style));
    dots.select("text.ready-compare-dot-name").attr("x", 14).text(d => d.name.length > 12 ? `${d.name.slice(0, 12)}…` : d.name);
    dots.transition().duration(duration).attr("opacity", 1).attr("transform", d => `translate(${x(xAxis.value(d))},${y(yAxis.value(d))})`);
  }

  const TREE_LEVELS = {
    category: {
      label: "料理の種類",
      get: r => r.category || "その他",
      order: ["主食", "主菜", "副菜", "汁物", "軽食", "デザート", "その他"],
    },
    style: {
      label: "ジャンル",
      get: r => r.style || "その他",
      order: ["和風", "洋風", "中華", "韓国風", "エスニック", "インド風", "メキシカン", "中東風", "その他"],
    },
    time: {
      label: "調理時間",
      get: r => r.time_min <= 15 ? "15分以内" : r.time_min <= 30 ? "30分以内" : r.time_min <= 60 ? "60分以内" : "60分超",
      order: ["15分以内", "30分以内", "60分以内", "60分超"],
    },
    missing: {
      label: "不足食材数",
      get: r => r.missing.length >= 3 ? "3個以上" : `${r.missing.length}個`,
      order: ["0個", "1個", "2個", "3個以上"],
    },
  };

  function recipeOrder(a, b) {
    return a.missing.length - b.missing.length || b.coverage - a.coverage || a.time_min - b.time_min || a.name.localeCompare(b.name, "ja");
  }

  function makeRecipeTree(recipes, levelKeys) {
    const root = { kind: "root", path: "root", label: "条件に合う料理", count: recipes.length };
    const split = (node, list, depth) => {
      if (depth === levelKeys.length) {
        const sorted = list.slice().sort(recipeOrder);
        const shown = Math.min(sorted.length, treeShown.get(node.path) || TREE_PAGE);
        node.children = sorted.slice(0, shown).map(recipe => ({ kind: "recipe", path: `${node.path}/${recipe.id}`, recipe }));
        const rest = sorted.slice(shown);
        if (rest.length) {
          // 残りの料理が、あといくつ買い足せば作れるかの内訳
          const parts = [["なし", r => r.missing.length === 0], ["1個", r => r.missing.length === 1], ["2個以上", r => r.missing.length >= 2]]
            .map(([name, test]) => [name, rest.filter(test).length]).filter(([, n]) => n > 0);
          const breakdown = parts.length > 1 ? `買い足し ${parts.map(([name, n]) => `${name}${n}`).join("・")}` : `すべて買い足し${parts[0][0]}`;
          node.children.push({ kind: "more", path: `${node.path}/more`, owner: node.path, shown, breakdown,
            label: `さらに${Math.min(TREE_PAGE, rest.length)}品表示（残り${rest.length}品）` });
        }
        // 途中まで広げたときも、最初の12品に戻せるようにする
        if (shown > TREE_PAGE) node.children.push({ kind: "less", path: `${node.path}/less`, owner: node.path, label: `${TREE_PAGE}品に戻す` });
        return;
      }
      const level = TREE_LEVELS[levelKeys[depth]];
      const groups = d3.group(list, level.get);
      const rank = key => {
        const index = level.order.indexOf(key);
        return index < 0 ? level.order.length : index;
      };
      node.children = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length)
        .map(([key, group]) => {
          const child = { kind: "group", path: `${node.path}/${depth}:${key}`, label: key, level: level.label, count: group.length };
          split(child, group, depth + 1);
          return child;
        });
    };
    split(root, recipes, 0);
    return root;
  }

  function renderRecipeTree(recipes, primary = "category", secondary = "style", selectedId = null, tertiary = "none") {
    const svg = d3.select("#recipe-tree");
    if (svg.empty()) return;
    const levels = [primary, secondary, tertiary].filter((key, index, all) => key && key !== "none" && all.indexOf(key) === index);
    // 末端の料理名までを描画域に入れる。従来はノード間隔だけで横幅を
    // 割っていたため、2段分類時に末端ラベルが右端からはみ出していた。
    const W = Math.max(340, svg.node().parentElement.clientWidth - 2 || 720);
    svg.attr("width", "100%");
    if (!recipes.length) {
      svg.selectAll("*").remove();
      svg.attr("height", 190).append("text").attr("class", "explore-empty")
        .attr("x", W / 2).attr("y", 95).attr("text-anchor", "middle")
        .text("条件に合う料理がありません。条件を緩めてみてください。");
      return;
    }
    const root = d3.hierarchy(makeRecipeTree(recipes, levels));
    root.eachBefore(node => {
      if (node.children && node.data.kind === "group" && !treeExpanded.has(node.data.path)) {
        node._children = node.children;
        node.children = null;
      }
    });
    const visibleNodes = root.descendants().length;
    const compactness = visibleNodes > 100 ? 2 : visibleNodes > 55 ? 1 : 0;
    const leafSpace = W < 540 ? 142 : W < 760 ? 185 : 240;
    const minDepthWidth = W < 540 ? 62 : 86;
    // root → 分類 → 料理までの「辺」の本数は levels + 1。
    const depthWidth = Math.max(minDepthWidth, Math.min(250, (W - leafSpace - 32) / Math.max(1, levels.length + 1)));
    const rowHeight = compactness === 2 ? 18 : compactness === 1 ? 22 : 26;
    const nodeRadius = compactness === 2 ? 6 : compactness === 1 ? 7 : 9;
    const recipeRadius = compactness === 2 ? 4.8 : compactness === 1 ? 5.8 : 7;
    const labelSize = compactness === 2 ? 9 : compactness === 1 ? 10 : 11;
    const recipeNameLength = W < 540 ? 10 : W < 760 ? 15 : compactness === 2 ? 16 : 20;
    // 「さらに表示」は内訳を2行目に書くので、その下を空ける(separation は下の節、上の節の順に呼ばれる)
    d3.tree().nodeSize([rowHeight, depthWidth]).separation((a, b) => (a.parent === b.parent ? 1 : 1.35) + (b.data.kind === "more" ? .6 : 0))(root);
    let minX = Infinity, maxX = -Infinity;
    root.each(node => { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); });
    const H = Math.max(240, maxX - minX + 60);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    const xy = node => [node.y + 26, node.x - minX + 30];
    const links = svg.selectAll("path.recipe-tree-link").data(root.links(), d => d.target.data.path)
      .join("path").attr("class", "recipe-tree-link")
      .attr("d", d => {
        const [sx, sy] = xy(d.source), [tx, ty] = xy(d.target);
        return `M${sx},${sy}C${(sx + tx) / 2},${sy} ${(sx + tx) / 2},${ty} ${tx},${ty}`;
      });
    links.lower();
    const nodes = svg.selectAll("g.recipe-tree-node").data(root.descendants(), d => d.data.path).join("g")
      .attr("class", d => `recipe-tree-node ${d.data.kind}${d.data.recipe?.id === selectedId ? " selected" : ""}`)
      .attr("transform", d => { const [x, y] = xy(d); return `translate(${x},${y})`; });
    // 買い足しなしで作れる料理は、丸の外側を黒い枠で囲む
    nodes.selectAll("circle.recipe-tree-ready").data(d => d.data.kind === "recipe" && !d.data.recipe.missing.length ? [d] : []).join("circle")
      .attr("class", "recipe-tree-ready").attr("r", recipeRadius + 3);
    nodes.selectAll("circle.recipe-tree-dot").data(d => [d]).join("circle")
      .attr("class", "recipe-tree-dot").attr("r", d => d.data.kind === "recipe" ? recipeRadius : d.data.kind === "more" || d.data.kind === "less" ? Math.max(4, recipeRadius - 1) : nodeRadius)
      .attr("fill", d => d.data.kind === "recipe" ? color(d.data.recipe.style) : d.data.kind === "more" || d.data.kind === "less" ? "#b8b0aa" : "#f97316");
    nodes.selectAll("text.recipe-tree-label").data(d => [d]).join("text")
      .attr("class", "recipe-tree-label").attr("x", nodeRadius + 5).attr("dy", ".35em").style("font-size", `${labelSize}px`)
      .text(d => {
        if (d.data.kind === "root") return `${d.data.label}（${d.data.count}品）`;
        if (d.data.kind === "group") return `${d.data.label}（${d.data.count}品）`;
        if (d.data.kind === "more" || d.data.kind === "less") return d.data.label;
        const r = d.data.recipe;
        const name = r.name.length > recipeNameLength ? `${r.name.slice(0, recipeNameLength)}…` : r.name;
        return `${r.emoji || "🍽️"} ${name}　${r.time_min}分`;
      });
    // 残りの料理の内訳(あと何個買い足せば作れるか)。右端に収まらないときはツールチップだけで見せる
    nodes.selectAll("text.recipe-tree-breakdown").data(d => d.data.kind === "more"
      && W - xy(d)[0] - nodeRadius - 5 >= d.data.breakdown.length * (labelSize - 1) ? [d] : []).join("text")
      .attr("class", "recipe-tree-breakdown").attr("x", nodeRadius + 5).attr("y", labelSize + 4).attr("dy", ".35em")
      .style("font-size", `${labelSize - 1}px`).text(d => d.data.breakdown);
    const activate = d => {
      if (d.data.kind === "group") {
        if (treeExpanded.has(d.data.path)) treeExpanded.delete(d.data.path); else treeExpanded.add(d.data.path);
      } else if (d.data.kind === "more") {
        treeShown.set(d.data.owner, d.data.shown + TREE_PAGE);
      } else if (d.data.kind === "less") {
        treeShown.delete(d.data.owner);
      } else return onSelect(d.data.recipe.id);
      hideTip();
      renderRecipeTree(recipes, primary, secondary, selectedId, tertiary);
    };
    nodes.filter(d => d.data.kind !== "root")
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", d => d.data.kind === "group" ? `${d.data.level}の${d.data.label}を開閉`
        : d.data.kind === "more" || d.data.kind === "less" ? d.data.label : `${d.data.recipe.name}の詳細を表示`)
      .on("mouseenter mousemove", (event, d) => {
        if (d.data.recipe) showTip(event, tipHtml(d.data.recipe));
        else if (d.data.breakdown) showTip(event, `<b>残りの料理</b><br>${d.data.breakdown}`);
      })
      .on("mouseleave", hideTip)
      .on("click", (_, d) => activate(d))
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate(d);
      });
  }

  function renderIngredientNetwork(recipes, haveNames, selectedId = null, limit = 35, layout = "columns") {
    const svg = d3.select("#ingredient-network"), rank = d3.select("#ingredient-network-rank");
    if (svg.empty()) return;
    if (ingredientNetworkSimulation) { ingredientNetworkSimulation.stop(); ingredientNetworkSimulation = null; }
    const W = Math.max(760, svg.node().parentElement.clientWidth - 2 || 760);
    if (!haveNames.length) {
      svg.selectAll("*").remove();
      svg.attr("width", W).attr("height", 190).append("text").attr("class", "explore-empty")
        .attr("x", W / 2).attr("y", 95).attr("text-anchor", "middle").text("今ある食材を選ぶと、買い足し食材とのつながりを表示します。");
      rank.html("");
      return;
    }
    const sorted = recipes.slice().sort(recipeOrder);
    const ready = sorted.filter(r => r.missing.length === 0).slice(0, 8);
    const candidates = [...ready, ...sorted.filter(r => r.missing.length > 0)].slice(0, limit);
    const missingCount = d3.rollup(candidates.flatMap(r => r.missing), values => values.length, name => name);
    const visibleMissing = [...missingCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 20).map(([name]) => name);
    // 選んでいる料理の足りない食材は、上位20に入っていなくても右の列に出す(押したときに全部強調できるように)
    const selectedRecipe = candidates.find(r => r.id === selectedId) || null;
    for (const name of selectedRecipe?.missing || []) if (!visibleMissing.includes(name)) visibleMissing.push(name);
    const usedHave = haveNames.filter(name => candidates.some(r => r.matched.includes(name))).slice(0, 20);
    const nodes = [
      ...usedHave.map(name => ({ id: `have:${name}`, kind: "have", name })),
      ...candidates.map(recipe => ({ id: `recipe:${recipe.id}`, kind: "recipe", name: recipe.name, recipe })),
      ...visibleMissing.map(name => ({ id: `missing:${name}`, kind: "missing", name, count: missingCount.get(name) || 0 })),
    ];
    const byId = new Map(nodes.map(node => [node.id, node]));
    const links = [];
    for (const recipe of candidates) {
      const target = byId.get(`recipe:${recipe.id}`);
      recipe.matched.filter(name => byId.has(`have:${name}`)).forEach(name => links.push({ source: byId.get(`have:${name}`), target, kind: "have" }));
      recipe.missing.filter(name => byId.has(`missing:${name}`)).forEach(name => links.push({ source: target, target: byId.get(`missing:${name}`), kind: "missing" }));
    }
    if (ingredientNetworkFocus && !byId.has(ingredientNetworkFocus)) ingredientNetworkFocus = null;
    const maxRows = Math.max(usedHave.length, candidates.length, visibleMissing.length, 1);
    const H = Math.max(390, Math.min(850, maxRows * 21 + 76));
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    const columnX = { have: 105, recipe: W / 2, missing: W - 125 };
    const grouped = d3.group(nodes, d => d.kind);
    for (const [kind, group] of grouped) {
      group.sort((a, b) => kind === "recipe" ? recipeOrder(a.recipe, b.recipe) : (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, "ja"));
      group.forEach((node, index) => { node.x = columnX[kind]; node.y = 42 + (index + 1) * ((H - 70) / (group.length + 1)); });
    }
    // 強調するもの: マウスを乗せているもの → 押した食材 → 選んでいる料理(今ある食材と足りない食材の両方につながる)の順
    let hoverFocus = null;
    const focusSet = () => {
      const focus = hoverFocus || ingredientNetworkFocus || (selectedRecipe ? `recipe:${selectedRecipe.id}` : null);
      if (!focus) return null;
      const ids = new Set([focus]);
      links.forEach(link => { if (link.source.id === focus || link.target.id === focus) { ids.add(link.source.id); ids.add(link.target.id); } });
      return ids;
    };
    // 料理を押すと詳細を開き、その料理を強調する(食材の強調は解除)。食材を押すと、その食材につながる料理を強調する
    const pick = d => {
      if (d.recipe) { ingredientNetworkFocus = null; onSelect(d.recipe.id); }
      else { ingredientNetworkFocus = ingredientNetworkFocus === d.id ? null : d.id; draw(); }
    };
    const draw = () => {
      const focused = focusSet();
      svg.selectAll("line.ingredient-network-link").data(links).join("line")
        .attr("class", d => `ingredient-network-link ${d.kind}${focused ? (focused.has(d.source.id) && focused.has(d.target.id) ? " focus" : " dim") : ""}`)
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      const selection = svg.selectAll("g.ingredient-network-node").data(nodes, d => d.id).join("g")
        .attr("class", d => `ingredient-network-node ${d.kind}${d.recipe?.id === selectedId ? " selected" : ""}${focused && !focused.has(d.id) ? " dim" : ""}`)
        .attr("transform", d => `translate(${d.x},${d.y})`);
      // 買い足しなしで作れる料理は、丸の外側を黒い枠で囲む
      selection.selectAll("circle.ingredient-network-ready").data(d => d.kind === "recipe" && !d.recipe.missing.length ? [d] : []).join("circle")
        .attr("class", "ingredient-network-ready").attr("r", 8.5);
      selection.selectAll("circle.ingredient-network-dot").data(d => [d]).join("circle")
        .attr("class", "ingredient-network-dot").attr("r", d => d.kind === "recipe" ? 5.5 : d.kind === "missing" ? 7 + Math.min(8, (d.count || 1) * 1.25) : 8);
      selection.selectAll("text").data(d => [d]).join("text")
        .attr("x", d => d.kind === "have" ? -12 : 12).attr("text-anchor", d => d.kind === "have" ? "end" : "start").attr("dy", ".35em")
        .text(d => d.kind === "recipe" ? (d.name.length > 17 ? `${d.name.slice(0, 17)}…` : d.name) : d.kind === "missing" ? `${d.name}（${d.count}）` : d.name);
      selection.attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", d => d.kind === "recipe" ? `${d.name}の詳細を表示` : `${d.name}につながる料理を強調`)
        .on("mouseenter", (event, d) => { hoverFocus = d.id; draw(); if (d.recipe) showTip(event, tipHtml(d.recipe)); })
        .on("mousemove", (event, d) => { if (d.recipe) showTip(event, tipHtml(d.recipe)); })
        .on("mouseleave", () => { hoverFocus = null; draw(); hideTip(); })
        // キーボードで移ったときも、マウスを乗せたときと同じく強調する
        .on("focus", (_, d) => { hoverFocus = d.id; draw(); })
        .on("blur", () => { hoverFocus = null; draw(); })
        .on("click", (_, d) => pick(d))
        .on("keydown", (event, d) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          pick(d);
        });
    };
    svg.selectAll("text.ingredient-network-column-title").data([
      { x: columnX.have, label: "今ある食材" }, { x: columnX.recipe, label: "候補の料理" }, { x: columnX.missing, label: "足りない食材" },
    ]).join("text").attr("class", "ingredient-network-column-title").attr("x", d => d.x).attr("y", 22).attr("text-anchor", "middle").text(d => d.label);
    draw();
    if (layout === "force") {
      ingredientNetworkSimulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(d => d.kind === "missing" ? 80 : 105).strength(.32))
        .force("charge", d3.forceManyBody().strength(-95))
        .force("x", d3.forceX(d => columnX[d.kind]).strength(.12))
        .force("y", d3.forceY(H / 2).strength(.035))
        .force("collide", d3.forceCollide(d => d.kind === "recipe" ? 13 : 24))
        .on("tick", () => {
          nodes.forEach(d => { d.x = Math.max(25, Math.min(W - 25, d.x)); d.y = Math.max(34, Math.min(H - 18, d.y)); });
          draw();
        });
    }
    const top = [...missingCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 5);
    const selectedNote = selectedRecipe
      ? `<p class="ingredient-network-selected"><b>${selectedRecipe.name}</b> に足りない食材: ${selectedRecipe.missing.length ? selectedRecipe.missing.join("、") : "なし(今ある食材だけで作れます)"}</p>`
      : "";
    rank.html(`${selectedNote}<h4>買い足すと選択肢が増える食材</h4>${top.length ? `<ol>${top.map(([name, count]) => `<li><button type="button" data-network-focus="missing:${name}">${name}</button><span>${count}品で不足</span></li>`).join("")}</ol><p>食材名を押すと、つながる料理だけを強調します。料理を押すと、その料理の今ある食材と足りない食材を強調します。</p>` : "<p>表示中の候補に、買い足しが必要な食材はありません。</p>"}`);
    rank.selectAll("button[data-network-focus]").on("click", function () {
      const id = this.dataset.networkFocus;
      ingredientNetworkFocus = ingredientNetworkFocus === id ? null : id;
      draw();
    });
  }

  // 散布図の拡大の状態。refresh() で描き直しても保ち、縦軸などが変わったら元に戻す
  //   points: 拡大後の点の配置(拡大する前の座標で持ち、拡大操作の途中は動かすだけにする)
  const scatterZoom = { t: d3.zoomIdentity, key: "", behavior: null, draw: null, points: new Map(), dragging: false };
  const DETAIL_ZOOM_K = 2; // この倍率以上で、表示範囲内の全料理を個別の点として出す
  const CELL_ZOOM_K = 3;   // マスをクリックしたときに寄る倍率

  function scatterZoomBy(factor) {
    const svg = d3.select("#scatter");
    if (scatterZoom.behavior) svg.transition().duration(350).call(scatterZoom.behavior.scaleBy, factor);
  }
  function scatterZoomReset() {
    const svg = d3.select("#scatter");
    if (scatterZoom.behavior) svg.transition().duration(400).call(scatterZoom.behavior.transform, d3.zoomIdentity);
  }

  function renderScatter(all, yKey = "time", hasInput = true, selectedId = null, xRangeMax = null, opts = {}) {
    const ax = Y_AXES[yKey] || Y_AXES.time;
    const svg = d3.select("#scatter");
    // PCでは散布図を主役に見せるため縦方向にも余白を確保する。
    const W = svg.node().getBoundingClientRect().width || 800, H = W < 600 ? 300 : 390;
    // 横軸ラベルの横に上限セレクトを置くため、下側の操作用余白を確保する。
    const m = { l: 62, r: 16, t: 22, b: 62 };
    svg.attr("height", H);

    // 横軸: 食材を入れていれば「足りない食材の数」、空なら「材料の数」
    const xOf = hasInput ? d => d.missing.length : d => d.ingredients.length;
    const xTitle = hasInput ? "足りない食材の数" : "材料の数";
    d3.select("#x-axis-title").text(xTitle);

    // 条件に合う料理だけを、ヒートマップと個別の点に描画する。
    const inXRange = d => !hasInput || xRangeMax === null || xOf(d) <= xRangeMax;
    const shown = all.filter(d => !d.reason && inXRange(d));
    const pool = shown;
    const xMin = pool.length ? d3.min(pool, xOf) : 0;
    const xMax = hasInput && xRangeMax !== null ? xRangeMax : (pool.length ? d3.max(pool, xOf) : 0);
    const cols = d3.range(hasInput ? 0 : xMin, xMax + 1);
    // 列の中心が整数になる連続のスケール(拡大に追従させるため、scaleBand ではなく linear)
    const x0 = d3.scaleLinear().domain([cols[0] - 0.5, cols[cols.length - 1] + 0.5]).range([m.l, W - m.r]);
    const y0 = d3.scaleLinear().range([H - m.b - 8, m.t + 8]);   // 上下の端の点が切れないよう、少し内側に
    if (ax.fixed) y0.domain([ax.fixed[0] - 0.5, ax.fixed[1] + 0.5]);
    else y0.domain([0, d3.max(pool, ax.get) || 1]).nice();

    // 縦軸・食材の有無・表示上限・幅が変わったら、拡大を元に戻す
    const key = [yKey, hasInput, xRangeMax, cols.join(","), W].join("|");
    if (key !== scatterZoom.key) {
      scatterZoom.key = key;
      scatterZoom.t = d3.zoomIdentity;
      scatterZoom.points.clear();
      svg.property("__zoom", d3.zoomIdentity);
    }

    // ---------- マス目: 列 = 横軸の値、行 = 縦軸の区切り。色 = 条件に合う料理の数 ----------
    const edges = ax.fixed ? d3.range(ax.fixed[0] - 0.5, ax.fixed[1] + 1, 1) : y0.ticks(8);
    if (!ax.fixed && edges[edges.length - 1] < y0.domain()[1]) edges.push(y0.domain()[1]);
    const cells = [];
    const byCol = d3.group(shown, xOf);
    for (const c of cols) {
      const rs = byCol.get(c) || [];
      for (let k = 0; k < edges.length - 1; k++) {
        const last = k === edges.length - 2;
        const inRow = rs.filter(d => ax.get(d) >= edges[k] && (last ? ax.get(d) <= edges[k + 1] : ax.get(d) < edges[k + 1]));
        if (inRow.length) cells.push({ c, v0: edges[k], v1: edges[k + 1], n: inRow.length });
      }
    }
    const cellColor = d3.scaleSequentialSqrt([0, d3.max(cells, c => c.n) || 1], d3.interpolateRgb("#fff3e6", "#d9632b"));
    // 「今すぐ作れる」列(足りない食材0個)は、ほかの列と見分けられるよう緑の濃淡にする
    const readyColor = cellColor.copy().interpolator(d3.interpolateRgb("#eef9f4", "#2f9e7a"));
    const fillOf = c => (hasInput && c.c === 0 ? readyColor : cellColor)(c.n);
    const cellLabel = c => `${hasInput ? `足りない食材${c.c}個` : `材料${c.c}個`}・${ax.label} ${ax.fixed ? `${c.v0 + 0.5}` : `${ax.fmt(c.v0)}〜${ax.fmt(c.v1)}`}`;
    const rowOf = d => {
      const value = ax.get(d);
      const index = edges.findIndex((edge, i) => i < edges.length - 1 && value >= edge && (i === edges.length - 2 ? value <= edges[i + 1] : value < edges[i + 1]));
      return index < 0 ? Math.max(0, Math.min(edges.length - 2, d3.bisectRight(edges, value) - 1)) : index;
    };

    // 上位の点(引いているとき): 画面の並び順の上位 N 品。選んでいる料理は上位でなくても出す
    const topIds = opts.topIds || [];
    const rank = new Map(topIds.map((id, i) => [id, i]));
    const topSet = shown.filter(d => rank.has(d.id) || d.id === selectedId)
      .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));

    // ---------- 層(一度だけ作る) ----------
    const defs = svg.selectAll("defs.scatter-defs").data([0]).join("defs").attr("class", "scatter-defs");
    defs.selectAll("clipPath").data([0]).join("clipPath").attr("id", "scatter-clip")
      .selectAll("rect").data([0]).join("rect")
      .attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b);
    const layer = cls => svg.selectAll(`g.${cls.split(" ").join(".")}`).data([0]).join("g").attr("class", cls);
    const gBack = layer("scatter-back").attr("clip-path", "url(#scatter-clip)");
    const gFront = layer("scatter-front").attr("clip-path", "url(#scatter-clip)");
    const gAxisX = layer("axis x").attr("transform", `translate(0,${H - m.b})`);
    const gAxisY = layer("axis y").attr("transform", `translate(${m.l},0)`);
    svg.selectAll("text.axis-label").data([
      { t: xTitle, x: W - m.r - 164, y: H - 11, a: "end" },
      { t: `${ax.label}  ${ax.dir}`, x: m.l + 4, y: m.t - 8, a: "start" },
    ]).join("text").attr("class", "axis-label")
      .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", d => d.a).text(d => d.t);
    const zoomInfo = svg.selectAll("text.zoom-info").data([0]).join("text").attr("class", "zoom-info")
      .attr("x", W - m.r - 4).attr("y", m.t + 14).attr("text-anchor", "end");
    // 層の順: マス目 → 点 → 軸
    gBack.lower(); gFront.raise(); gAxisX.raise(); gAxisY.raise(); zoomInfo.raise();

    // 条件外は常に薄く
    const baseAlpha = d => (d.reason ? 0.55 : 1);
    const alpha = d => selectedId && d.id !== selectedId ? Math.min(baseAlpha(d), 0.18) : baseAlpha(d);
    const label = d => (hasInput && !d.reason ? `${d.name}、足りない食材${d.missing.length}個` : d.name);

    // 同じマスの料理を規則正しい格子ではなく、固定シードの散らばりを持つ点群で配置する。
    // 拡大後も料理アイコンへ切り替えず、料理の系統色だけで区別する。
    const hash01 = value => {
      let hash = 2166136261;
      for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return (hash >>> 0) / 4294967295;
    };
    function layout(list, X, Y, radius) {
      const positions = new Map();
      const groups = d3.group(list, d => `${xOf(d)}|${rowOf(d)}`);
      groups.forEach(group => {
        const sample = group[0], col = xOf(sample), row = rowOf(sample);
        const cellWidth = Math.abs(X(col + 0.5) - X(col - 0.5)) * 0.82;
        const cellHeight = Math.abs(Y(edges[row]) - Y(edges[row + 1])) * 0.82;
        const centerX = X(col), centerY = Y((edges[row] + edges[row + 1]) / 2);
        const left = centerX - cellWidth / 2 + radius, right = centerX + cellWidth / 2 - radius;
        const top = centerY - cellHeight / 2 + radius, bottom = centerY + cellHeight / 2 - radius;
        const nodes = group.map(d => {
          const targetX = centerX + (hash01(`${d.id}:x`) - 0.5) * cellWidth * 0.76;
          const targetY = centerY + (hash01(`${d.id}:y`) - 0.5) * cellHeight * 0.76;
          return { id: d.id, targetX, targetY, x: targetX, y: targetY };
        });
        const simulation = d3.forceSimulation(nodes).randomSource(d3.randomLcg(.618)).stop()
          .force("x", d3.forceX(n => n.targetX).strength(.17))
          .force("y", d3.forceY(n => n.targetY).strength(.17))
          .force("collide", d3.forceCollide(radius + 1.4).iterations(2));
        for (let tick = 0; tick < 140; tick += 1) {
          simulation.tick();
          nodes.forEach(n => { n.x = Math.max(left, Math.min(right, n.x)); n.y = Math.max(top, Math.min(bottom, n.y)); });
        }
        nodes.forEach(n => positions.set(n.id, [n.x, n.y]));
      });
      return positions;
    }

    // ---------- 描く(拡大・移動のたびに呼ぶ。settled = 操作が止まった) ----------
    function draw(t, settled) {
      const X = t.rescaleX(x0), Y = t.rescaleY(y0);
      const expanded = t.k >= DETAIL_ZOOM_K;
      hideTip();

      // 軸: 横は画面に入っている整数の列だけ
      gAxisX.call(d3.axisBottom(X).tickValues(cols.filter(c => X(c) >= m.l - 1 && X(c) <= W - m.r + 1))
        .tickFormat(v => (hasInput && v === 0 ? "0個(今すぐ)" : `${v}個`)));
      const [ylo, yhi] = Y.domain();
      gAxisY.call(ax.fixed
        ? d3.axisLeft(Y).tickValues(d3.range(ax.fixed[0], ax.fixed[1] + 1).filter(v => v >= ylo && v <= yhi)).tickFormat(d3.format("d"))
        : d3.axisLeft(Y).ticks(5).tickFormat(ax.fmt));
      zoomInfo.text(t.k > 1.01 ? `${t.k.toFixed(1)}倍` : "");

      // 「今すぐ作れる」列(足りない食材0個)の背景
      const readyData = hasInput && cols.includes(0) ? [0] : [];
      gBack.selectAll("rect.ready-band").data(readyData).join("rect").attr("class", "ready-band")
        .attr("x", X(-0.5)).attr("y", m.t).attr("width", X(0.5) - X(-0.5)).attr("height", H - m.b - m.t);

      // マス目。個別の点を出しているときは薄くして背景に残す
      gBack.selectAll("rect.scatter-cell").data(cells).join("rect").attr("class", "scatter-cell")
        .attr("x", c => X(c.c - 0.5) + 1).attr("y", c => Y(c.v1) + 1)
        .attr("width", c => Math.max(0, X(c.c + 0.5) - X(c.c - 0.5) - 2)).attr("height", c => Math.max(0, Y(c.v0) - Y(c.v1) - 2))
        .attr("rx", 3).attr("fill", fillOf).attr("opacity", expanded ? 0.35 : 0.9)
        .on("mousemove", (e, c) => { if (!expanded) showTip(e, `${cellLabel(c)}<br><b>${c.n}品</b>(押すとここへ寄ります)`); })
        .on("mouseleave", hideTip)
        .on("click", (e, c) => {
          // マスを押すと、そのマスへ寄る
          const k = Math.max(t.k, CELL_ZOOM_K), cx = x0(c.c), cy = y0((c.v0 + c.v1) / 2);
          svg.transition().duration(500).call(scatterZoom.behavior.transform,
            d3.zoomIdentity.translate((m.l + W - m.r) / 2, (m.t + H - m.b) / 2).scale(k).translate(-cx, -cy));
        });
      const big = c => X(c.c + 0.5) - X(c.c - 0.5) > 30 && Y(c.v0) - Y(c.v1) > 16;
      gBack.selectAll("text.cell-n").data(expanded ? [] : cells.filter(big)).join("text").attr("class", "cell-n")
        .attr("x", c => X(c.c + 0.5) - 6).attr("y", c => Y(c.v1) + 13).attr("text-anchor", "end")
        .classed("dark", c => c.n > cellColor.domain()[1] * 0.45).text(c => c.n);

      // 引いているときは上位の点、拡大後は表示範囲内の全料理を系統色の点で描く
      let drawn, pos;
      const pointRadius = expanded ? Math.min(10, 5 + (t.k - DETAIL_ZOOM_K) * 1.1) : 5;
      if (expanded) {
        const pad = pointRadius * 2;
        const visible = d => { const a = X(xOf(d)), b = Y(ax.get(d)); return a >= m.l - pad && a <= W - m.r + pad && b >= m.t - pad && b <= H - m.b + pad; };
        // 条件外を先(下の層)、条件に合う料理を後(上の層)に描く
        drawn = pool.filter(visible).sort((a, b) => (a.reason ? 0 : 1) - (b.reason ? 0 : 1));
        const cached = new Map([...scatterZoom.points].map(([id, p]) => [id, [t.applyX(p[0]), t.applyY(p[1])]]));
        if (settled) {
          pos = layout(drawn, X, Y, pointRadius);
          scatterZoom.points = new Map([...pos].map(([id, p]) => [id, [t.invertX(p[0]), t.invertY(p[1])]]));
        } else {
          pos = new Map(drawn.map(d => [d.id, cached.get(d.id) || [X(xOf(d)), Y(ax.get(d))]]));
        }
      } else {
        drawn = topSet;
        pos = layout(drawn, X, Y, pointRadius);
      }
      const move = d => `translate(${pos.get(d.id)[0]},${pos.get(d.id)[1]})`;
      const dots = gFront.selectAll("g.dot").data(drawn, d => d.id).join(
        enter => {
          const g = enter.append("g").attr("class", "dot");
          g.append("circle");
          return g;
        },
        update => update,
        exit => exit.remove()
      );
      dots.classed("out", false);
      dots.select("circle")
        .attr("r", pointRadius)
        .style("stroke", "#fff").style("stroke-opacity", expanded ? .72 : .82).style("stroke-width", expanded ? .75 : 1.5)
        .style("fill", d => color(d.style)).style("fill-opacity", expanded ? .56 : .66);
      dots.order()
        .classed("mini", !expanded)
        .classed("selected", d => d.id === selectedId)
        .classed("dimmed", d => !!selectedId && d.id !== selectedId)
        .attr("role", "button").attr("aria-label", label)
        .attr("tabindex", d => (d.reason ? null : 0))
        .attr("transform", move).attr("opacity", alpha)
        .on("mouseenter", (e, d) => { highlight(d.id); showTip(e, tipHtml(d)); })
        .on("mousemove", (e, d) => showTip(e, tipHtml(d)))
        .on("mouseleave", () => { highlight(null); hideTip(); })
        .on("click", (e, d) => onSelect(d.id))
        .on("keydown", (e, d) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.id); }
        });
      if (selectedId) dots.filter(d => d.id === selectedId).raise();
    }

    // ---------- 拡大(ホイール・ピンチ)と移動(ドラッグ) ----------
    if (!scatterZoom.behavior) {
      scatterZoom.behavior = d3.zoom()
        // d3.zoom に任せるのは、ホイールとタッチ(ピンチ・指での移動)だけ。マウスのドラッグは下で扱う
        .filter(e => !e.button && (e.type === "wheel" || e.type === "touchstart"))
        .on("zoom", e => { scatterZoom.t = e.transform; scatterZoom.draw?.(e.transform, false); })
        // マウスで動かしている間は、点の並べ直し(重い)をしない。離したときに1回だけ並べ直す
        .on("end", e => { scatterZoom.t = e.transform; if (!scatterZoom.dragging) scatterZoom.draw?.(e.transform, true); });
      svg.call(scatterZoom.behavior).on("dblclick.zoom", null);

      // マウスのドラッグでの移動。ボタンを押している間だけ動かす(離したら、図の外で離しても止まる)
      const node = svg.node();
      let drag = null, suppressClick = false;
      const endDrag = () => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null; scatterZoom.dragging = false;
        svg.classed("panning", false);
        if (moved) {
          suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);   // 動かしたあとの「クリック」で詳細が開かないように
          scatterZoom.draw?.(d3.zoomTransform(node), true);
        }
      };
      node.addEventListener("mousedown", e => { if (e.button === 0) e.preventDefault(); });   // 文字の選択を防ぐ
      node.addEventListener("pointerdown", e => {
        if (e.pointerType === "touch" || e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      });
      node.addEventListener("pointermove", e => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!(e.buttons & 1)) { endDrag(); return; }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < 4) return;     // 少し動いただけなら、クリックとして扱う
          drag.moved = true; scatterZoom.dragging = true;
          node.setPointerCapture(e.pointerId);
          svg.classed("panning", true);
          hideTip();
        }
        drag.x = e.clientX; drag.y = e.clientY;
        const k = d3.zoomTransform(node).k;
        svg.call(scatterZoom.behavior.translateBy, dx / k, dy / k);
      });
      node.addEventListener("pointerup", endDrag);
      node.addEventListener("pointercancel", endDrag);
      node.addEventListener("lostpointercapture", endDrag);
      node.addEventListener("click", e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    }
    scatterZoom.behavior.scaleExtent([1, 8])
      .extent([[m.l, m.t], [W - m.r, H - m.b]]).translateExtent([[m.l, m.t], [W - m.r, H - m.b]]);
    scatterZoom.draw = draw;
    draw(scatterZoom.t, true);

    // 選択内容を散布図の直下にも固定表示する。座標の読み取りは点の位置だけに頼らない。
    const selected = selectedId ? all.filter(d => d.id === selectedId) : [];
    d3.select("#selection-summary")
      .attr("hidden", selected.length ? null : true)
      .html(() => {
        const recipe = selected[0];
        if (!recipe) return "";   // 何も選んでいないとき(ページを開いた直後など)は表示しない
        const unavailable = recipe.reason ? `・現在の条件外: ${recipe.reason}` : "";
        return `<b>選択中:</b> ${recipe.name} <span>調理 ${recipe.time_min}分・不足食材 ${recipe.missing.length}個${subText(recipe) ? `・代用 ${subText(recipe)}` : ""}${unavailable}</span>`;
      });

    svg.selectAll("text.empty").data(shown.length ? [] : [0]).join("text")
      .attr("class", "empty").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
      .text("条件に合う料理がありません。条件をゆるめてみてください");
  }

  // ---------- 候補の行チャート ----------
  function renderRows(results, hasInput, selectedId = null) {
    const svg = d3.select("#chart");
    svg.attr("hidden", results.length === 0 ? true : null);
    d3.select("#chart-heading").attr("hidden", results.length === 0 ? true : null);
    d3.select("#candidate-scroll").attr("hidden", results.length === 0 ? true : null);
    const width = svg.node().getBoundingClientRect().width || 800;
    const compact = width <= 600;
    const thumbW = compact ? 80 : THUMB_W;
    const thumbH = compact ? 60 : THUMB_H;
    const labelW = compact ? 230 : LABEL_W;
    const textX = thumbW + 16;
    const maxN = d3.max(results, d => d.ingredients.length) || 1;
    const unit = Math.max(28, Math.min(110, (width - labelW - RIGHT_W) / maxN));
    svg.attr("height", Math.max(30, PAD * 2 + results.length * ROW_H));
    const y = i => PAD + i * ROW_H;

    const rows = svg.selectAll("g.row")
      .data(results, d => d.id)
      .join(
        enter => {
          const g = enter.append("g").attr("class", "row")
            .attr("transform", (d, i) => `translate(0,${y(i)})`).attr("opacity", 0);
          g.append("rect").attr("class", "hit").attr("fill", "transparent").attr("rx", 4);
          g.append("foreignObject").attr("class", "thumb-box");
          g.append("text").attr("class", "name");
          g.append("text").attr("class", "meta m1");
          g.append("text").attr("class", "meta m2");
          g.append("g").attr("class", "segs");
          g.append("text").attr("class", "pct").attr("text-anchor", "end").attr("y", 18);
          g.append("text").attr("class", "serv").attr("text-anchor", "end").attr("y", 34);
          g.append("text").attr("class", "favorite").attr("text-anchor", "middle");
          g.append("text").attr("class", "sub-badge").attr("text-anchor", "end");
          return g;
        },
        update => update,
        exit => exit.transition().duration(200).attr("opacity", 0).remove()
      );

    rows.transition().duration(450)
      .attr("transform", (d, i) => `translate(0,${y(i)})`).attr("opacity", 1);

    rows.select("rect.hit").attr("width", width).attr("height", ROW_H - 2);
    rows.select("foreignObject.thumb-box")
      .attr("x", 4).attr("y", (ROW_H - thumbH) / 2).attr("width", thumbW).attr("height", thumbH)
      .html(d => thumb(d, thumbW, thumbH));
    rows.classed("selected", d => d.id === selectedId)
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => highlight(d.id))
      .on("mouseleave", () => highlight(null))
      .on("click.recipe", (e, d) => onSelect(d.id));
    rows.select("text.name").attr("x", textX).attr("y", 32).text(d => d.name);
    rows.select("text.m1").attr("x", textX).attr("y", 59).text(d => `${d.country}・${d.style}・${d.category}`);
    rows.select("text.m2").attr("x", textX).attr("y", 85).text(d => `${d.time_min}分・${yen(d.price)}・${d.nutrition.kcal}kcal`);
    // 一覧の縦スクロールバーと重ならないよう、右端の情報は十分内側に置く。
    const favoriteX = width - 46;
    const sideTextX = width - 82;
    rows.select("text.pct").attr("x", sideTextX).attr("y", 38)
      .text(d => (hasInput ? `${Math.round(d.coverage * 100)}%` : ""));
    // 代用ありの料理は充足率の上に「代用 n」を出す(お気に入りの♡やスクロールバーと重ならないよう、充足率と同じ x にそろえる)
    rows.select("text.sub-badge").attr("x", sideTextX).attr("y", 16)
      .text(d => (hasInput && (d.substituted || []).length ? `代用 ${d.substituted.length}` : ""));
    rows.select("text.serv").attr("x", sideTextX).attr("y", 70)
      .text(d => (d.servings === null ? "" : d.servings >= 1 ? `${d.servings}人前分` : "量が足りない"));
    rows.select("text.favorite").attr("x", favoriteX).attr("y", 31)
      .classed("is-favorite", d => isFavorite(d.id))
      .attr("data-favorite-id", d => d.id)
      .attr("data-recipe-name", d => d.name)
      .attr("aria-pressed", d => isFavorite(d.id) ? "true" : "false")
      .attr("aria-label", d => `${d.name}をお気に入りに${isFavorite(d.id) ? "登録済み" : "登録"}`)
      .text(d => isFavorite(d.id) ? "♥" : "♡");

    rows.select("g.segs")
      .attr("transform", `translate(${labelW},${(ROW_H - 2 - SEG_H) / 2})`)
      .selectAll("g.seg")
      .data(d => [
        ...d.matched.map(name => ({ name, have: true, style: d.style, season: d.seasonal.includes(name) })),
        ...(d.substituted || []).map(s => ({ name: s.name, use: s.use, sub: true, style: d.style, season: d.seasonal.includes(s.name) })),
        ...d.missing.map(name => ({ name, have: false, style: d.style, season: d.seasonal.includes(name) })),
      ], s => s.name)
      .join(enter => {
        const g = enter.append("g").attr("class", "seg");
        g.append("rect");
        g.append("text");
        g.append("circle").attr("r", 3.5).attr("fill", "#2e9d4f").attr("stroke", "#fff");
        return g;
      })
      .call(seg => {
        const w = unit - 3, h = SEG_H;
        seg.transition().duration(450).attr("transform", (s, i) => `translate(${i * unit},0)`);
        const cls = s => (s.have ? "have" : s.sub ? "sub" : "missing");
        seg.select("rect").attr("width", w).attr("height", h).attr("rx", 4)
          .attr("class", cls)
          .attr("fill", s => (s.have ? color(s.style) : null));
        seg.select("text").attr("x", w / 2).attr("y", h / 2).attr("dy", "0.35em").attr("text-anchor", "middle")
          .attr("class", cls)
          .each(function (s) {
            // 代用は2行で「鶏肉 / →豚肉」と出す。それ以外は食材名1行
            const max = Math.floor((w - 6) / 11);
            const fit = t => (t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + "…");
            const lines = s.sub ? [s.name, "→" + s.use] : [s.name];
            d3.select(this).selectAll("tspan").data(lines).join("tspan")
              .attr("x", w / 2).attr("dy", (t, i) => (lines.length === 1 ? 0 : i === 0 ? "-0.55em" : "1.15em"))
              .text(fit);
          });
        seg.select("circle").attr("cx", w - 5).attr("cy", 5).attr("display", s => (s.season ? null : "none"));
      });
  }

  // ---------- おすすめ:並び順の上位3件 ----------
  function renderTopPicks(results, hasInput, selectedId = null) {
    const box = d3.select("#top-picks").attr("hidden", results.length === 0 ? true : null);
    const grid = box.select(".top-picks-grid");
    const cards = grid.selectAll("article.top-pick")
      .data(results, d => d.id)
      .join(
        enter => enter.append("article").attr("class", "top-pick"),
        update => update,
        exit => exit.remove()
      );

    cards.html(d => {
      const description = d.text?.description || d.description || d.catchcopy || "";
      const subOf = new Map((d.substituted || []).map(s => [s.name, s.use]));
      const chips = d.ingredients.map(i => {
        const have = d.matched.includes(i.name);
        const season = d.seasonal.includes(i.name) ? '<i class="season-dot">●</i>' : "";
        if (subOf.has(i.name)) return `<span class="ingredient-chip sub" title="${i.name}の代わりに${subOf.get(i.name)}">${i.name}→${subOf.get(i.name)}${season}</span>`;
        return `<span class="ingredient-chip ${have ? "have" : "missing"}">${i.name}${season}</span>`;
      }).join("");
      const subBadge = hasInput && subOf.size ? `<span class="sub-badge" title="代用: ${subText(d)}">代用 ${subOf.size}</span>` : "";
      const coverage = hasInput ? `<p class="top-pick-coverage">材料の充足率 <b>${Math.round(d.coverage * 100)}%</b></p>` : "";
      const servings = d.servings === null ? "" : `<p class="top-pick-servings">作れる量: ${d.servings >= 1 ? `${d.servings}人前分` : "手持ち量が不足"}</p>`;
      return `${subBadge}
        <button class="favorite-toggle ${isFavorite(d.id) ? "is-favorite" : ""}" type="button" data-favorite-id="${d.id}" data-recipe-name="${d.name}" aria-pressed="${isFavorite(d.id)}" aria-label="${d.name}をお気に入りに${isFavorite(d.id) ? "登録済み" : "登録"}">${isFavorite(d.id) ? "♥" : "♡"}</button>
        <div class="top-pick-media">${thumb(d, 160)}</div>
        <div class="top-pick-content">
          <div class="top-pick-head"><div><h4>${d.name}</h4><p>${d.country}・${d.style}・${d.category}</p>
          ${description ? `<p class="top-pick-description">${description}</p>` : ""}
          <p class="top-pick-meta">⏱ ${d.time_min}分　💰 ${yen(d.price)}　🔥 ${d.nutrition.kcal}kcal</p></div></div>
          <div class="top-pick-ingredients">${chips}</div>
          ${coverage}${servings}
        </div>`;
    });
    cards.classed("selected", d => d.id === selectedId)
      .on("mouseenter", (e, d) => highlight(d.id))
      .on("mouseleave", () => highlight(null))
      .on("click.recipe", (e, d) => onSelect(d.id));
  }

  function renderFavorites(results, selectedId = null, change = null) {
    const section = d3.select("#favorites-section");
    const grid = section.select(".favorites-grid");
    section.select(".favorites-empty").attr("hidden", results.length ? true : null);
    const cards = grid.selectAll("article.favorite-card").data(results, d => d.id);
    const entering = cards.enter().append("article").attr("class", "favorite-card");
    cards.exit().each(function (d) {
      if (change && !change.added && d.id === change.id) animateFavoriteRemoval(this);
    }).remove();
    const merged = entering.merge(cards);
    merged.html(d => `
      <div class="favorite-media">${thumb(d, 100, 76)}</div>
      <div class="favorite-content"><h4>${d.name}</h4><p>${d.country}・${d.style}・${d.category}</p>
      <small>⏱ ${d.time_min}分　不足食材 ${d.missing.length}個</small></div>
      <button class="favorite-toggle is-favorite" type="button" data-favorite-id="${d.id}" data-recipe-name="${d.name}" aria-pressed="true" aria-label="${d.name}をお気に入りから削除">♥</button>
    `);
    merged.classed("selected", d => d.id === selectedId)
      .on("mouseenter", (event, d) => highlight(d.id))
      .on("mouseleave", () => highlight(null))
      .on("click.recipe", (event, d) => onSelect(d.id));
    // toggleFavoriteから渡される明示的な変更だけをアニメーションする。
    // ほかのUI操作でrefreshしても、この表示は再アニメーションされない。
    entering.filter(d => change?.added && d.id === change.id).each(function () {
      const animation = animateFavoriteCard(this, [
        { opacity: 0, transform: "translateY(12px) scale(.96)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ]);
      if (animation) animation.onfinish = () => animation.cancel();
    });
  }

  // ---------- レシピ詳細 ----------
  function showDetail(r, master) {
    const panel = d3.select("#detail").classed("open", true);
    const body = d3.select("#detail-body");
    const n0 = r.servings && r.servings >= 1 ? r.servings : 1;
    const sourceServings = Number(r.source_servings);
    const sourceServingsText = Number.isFinite(sourceServings) && sourceServings > 0
      ? `${sourceServings}人分${r.serving_basis === "assumed" ? "（推定）" : ""}`
      : "人数の記載なし";
    highlight(r.id);

    body.html(`
      <div class="detail-thumb">${thumb(r, 150)}</div>
      <div class="detail-title-row"><h2>${r.name}</h2><button class="detail-favorite ${isFavorite(r.id) ? "is-favorite" : ""}" type="button" data-favorite-id="${r.id}" data-recipe-name="${r.name}" aria-pressed="${isFavorite(r.id)}" aria-label="${r.name}をお気に入りに${isFavorite(r.id) ? "登録済み" : "登録"}">${isFavorite(r.id) ? "♥" : "♡"}</button></div>
      <div class="sub">${r.country}・${r.style}・${r.category}</div>
      <div>${r.taste.map(t => `<span class="tag">${t}</span>`).join("")}
           ${r.seasonal.map(s => `<span class="tag season">旬: ${s}</span>`).join("")}</div>
      <div class="pantry">${[["辛さ", "spicy"], ["甘さ", "sweet"], ["酸っぱさ", "sour"]]
        .map(([k, f]) => `${k} ${"●".repeat(r.taste_level[f])}${"○".repeat(5 - r.taste_level[f])}`).join(" ")}</div>
      ${r.reason ? `<div class="warn">今の条件では除外されています(${r.reason})</div>` : ""}
      <div class="stats">
        <div class="stat"><span>調理時間</span><b>${r.time_min}分</b></div>
        <div class="stat"><span>1人前の価格</span><b>${yen(r.price)}</b></div>
        <div class="stat"><span>今ある量で</span><b>${r.servings === null ? "—" : r.servings >= 1 ? `${r.servings}人前` : "不足"}</b>
          ${r.limiting ? `<span>${r.limiting}で決まる</span>` : ""}</div>
      </div>
      <h4>栄養(1人前・目安)</h4>
      <div id="pfc"></div>
      <h4 class="ingredient-heading">材料 <span class="serving-context">表示人数 <input type="number" class="serv-in" min="1" value="${n0}" aria-label="表示人数"> 人分 <small>元レシピ: ${sourceServingsText}</small></span></h4>
      <table id="ing-table"></table>
      <div id="pantry-without-amount" class="pantry"></div>
      <div class="pantry">器具: ${r.tools.join("、") || "なし"}</div>
      <h4>作り方</h4>
      <ol>${r.steps.map(s => `<li>${s}</li>`).join("")}</ol>
      ${r.source?.url
        ? `<p><a href="${r.source.url}" target="_blank" rel="noopener">出典のレシピを見る ↗</a></p>`
        : `<p><a href="https://www.google.com/search?q=${encodeURIComponent(r.name + " レシピ")}" target="_blank" rel="noopener">詳しいレシピをWebで探す ↗</a></p>`}
      <div class="detail-panel-actions"><a class="detail-atlas-link" href="atlas-discovery.html">この料理を類似度マップで比較 <span aria-hidden="true">↗</span></a></div>
    `);

    const drawTable = n => {
      const drawRow = (i, isSeasoning = false) => {
        const have = r.matched.includes(i.name);
        const sub = (r.substituted || []).find(s => s.name === i.name);
        const season = r.seasonal.includes(i.name) ? ' <span style="color:#2e9d4f">●旬</span>' : "";
        // 調味料は検索時の「足りない食材」判定には含めていないため、
        // ここで一律に「買い足す」とは表示しない。
        const st = isSeasoning ? ["", ""] : have ? ["ok", "ある"] : sub ? ["sub", `${sub.use}で代用`] : ["ng", "買い足す"];
        const seasoningClass = isSeasoning ? " ingredient-row-seasoning" : "";
        const groupClass = i.group ? " ingredient-row-grouped" : "";
        return `<tr class="${(seasoningClass + groupClass).trim()}"><td>${i.name}${season}</td><td>${formatIngredientAmount(i, n, master, r)}</td>
                <td class="st ${st[0]}">${st[1]}</td></tr>`;
      };
      const ingredients = r.ingredients || [];
      const seasonings = r.seasonings || [];
      const rows = ingredients.map(i => ({ i, seasoning: false })).concat(seasonings.map(i => ({ i, seasoning: true })));
      if (rows.some(x => typeof x.i.pos === "number")) {
        // 元のサイトと同じ順に1つの表で並べ、見出し(「☆」「衣」など)が変わるところに見出しの行を入れる。
        // 作り方の「☆を入れる」と見比べられるようにするため
        rows.sort((x, y) => (x.i.pos ?? -1) - (y.i.pos ?? -1));
        let current = "";
        const html = rows.map(({ i, seasoning }) => {
          const g = i.group || "";
          const head = g && g !== current ? `<tr class="ingredient-table-group"><th colspan="3">${g}</th></tr>` : "";
          current = g;
          return head + drawRow(i, seasoning);
        }).join("");
        body.select("#ing-table").html(`<tbody>${html}</tbody>`);
      } else {
        const ingredientRows = ingredients.map(i => drawRow(i)).join("");
        const seasoningRows = seasonings.map(i => drawRow(i, true)).join("");
        body.select("#ing-table").html(
          `<tbody><tr class="ingredient-table-section"><th colspan="3">材料</th></tr>${ingredientRows}` +
          (seasoningRows ? `<tr class="ingredient-table-section"><th colspan="3">調味料</th></tr>${seasoningRows}` : "") +
          "</tbody>"
        );
      }

      const seasoningNames = new Set(seasonings.map(i => String(i.name).replace(/[\s・]/g, "").replace(/醤油/g, "しょうゆ")));
      const pantryWithoutAmounts = (r.pantry || []).filter(name => {
        const key = String(name).replace(/[\s・]/g, "").replace(/醤油/g, "しょうゆ");
        return !seasoningNames.has(key);
      });
      body.select("#pantry-without-amount")
        .text(pantryWithoutAmounts.length ? `分量の記載がない調味料など: ${pantryWithoutAmounts.join("、")}` : "");
    };
    drawTable(n0);
    body.select(".serv-in").on("input", e => drawTable(Math.max(1, +e.target.value || 1)));

    drawPFC(r.nutrition);
    panel.node().scrollTop = 0;
  }

  // PFC(たんぱく質・脂質・炭水化物)のエネルギー比を帯グラフで表示
  function drawPFC(nu) {
    const parts = [
      { k: "たんぱく質", g: nu.protein, e: nu.protein * 4, c: "#e15759" },
      { k: "脂質", g: nu.fat, e: nu.fat * 9, c: "#f2b447" },
      { k: "炭水化物", g: nu.carb, e: nu.carb * 4, c: "#4e79a7" },
    ];
    const total = d3.sum(parts, p => p.e);
    const W = 390, H = 58;
    const svg = d3.select("#pfc").append("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("text").attr("x", 0).attr("y", 14).attr("font-size", 15).attr("font-weight", 700).text(`${nu.kcal} kcal`);
    const x = d3.scaleLinear([0, total], [0, W]);
    let acc = 0;
    parts.forEach((p, i) => {
      const x0 = x(acc); acc += p.e;
      svg.append("rect").attr("x", x0).attr("y", 22).attr("width", Math.max(0, x(acc) - x0 - 1)).attr("height", 14).attr("fill", p.c);
      // ラベルは帯の幅に関係なく等間隔に置く(細い帯でも重ならないように)
      svg.append("rect").attr("x", i * 130).attr("y", 43).attr("width", 9).attr("height", 9).attr("fill", p.c);
      svg.append("text").attr("x", i * 130 + 13).attr("y", 52).attr("font-size", 11).attr("fill", "#555")
        .text(`${p.k} ${p.g}g(${Math.round(p.e / total * 100)}%)`);
    });
  }

    return { init, renderScatter, scatterZoomBy, scatterZoomReset, renderRows, renderTopPicks, renderFavorites, renderReadyRanking, renderReadyComparison, renderRecipeTree, renderIngredientNetwork, showDetail, highlight };
})();
