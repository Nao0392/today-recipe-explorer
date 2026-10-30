// tree-playground.js — レシピを「買い足しの数 → 種類 → ジャンル」のように枝分かれさせて見る試作(チームへのデモ用)
// ・データはいつもの RecipeData(data-adapter.js)から読む。search.html / app.js には触らない
// ・枝の丸をクリックすると開閉、右端の料理名をクリックすると右側に詳細、「ほか n品」で続きを出す
(() => {
  // ---------- 分け方 ----------
  // key: レシピ → 枝の名前、order: 枝の並び順、label: 枝に出す文字
  const LEVELS = {
    missing: {
      name: "買い足しの数",
      key: r => (r.missing.length >= 3 ? "3個以上" : `${r.missing.length}個`),
      order: ["0個", "1個", "2個", "3個以上"],
      label: k => (k === "0個" ? "買い足しなし" : `買い足し ${k}`),
    },
    category: {
      name: "種類(主菜・副菜など)",
      key: r => r.category,
      order: ["主菜", "主食", "副菜", "汁物", "デザート"],
      label: k => k,
    },
    style: {
      name: "ジャンル(和風・中華など)",
      key: r => r.style,
      order: ["和風", "洋風", "中華", "韓国風", "エスニック", "インド風", "メキシカン"],
      label: k => k,
    },
    time: {   // 追加の案: 時間で分けると「すぐ作れるもの」が一番上にまとまる
      name: "調理時間",
      key: r => (r.time_min <= 15 ? "15分以内" : r.time_min <= 30 ? "30分以内" : r.time_min <= 60 ? "60分以内" : "60分超"),
      order: ["15分以内", "30分以内", "60分以内", "60分超"],
      label: k => k,
    },
    ingredient: {   // 追加の案: 「どの食材を使う料理か」で分ける(入力した食材のうち、いちばん主役のもの)
      name: "使う食材",
      key: r => r.mainHave || "(入力した食材なし)",
      order: [],
      label: k => `${k}を使う`,
    },
  };
  const MISSING_COLOR = ["#2e9d6f", "#e7b416", "#e5793a", "#c0392b"];   // 買い足し 0 / 1 / 2 / 3個以上
  const missColor = n => MISSING_COLOR[Math.min(n, 3)];

  const $ = id => document.getElementById(id);
  const state = {
    data: null, aliasMap: new Map(), have: [], haveSet: new Set(), unknown: [],
    expanded: new Set(["root"]), more: new Map(), selected: null,
  };

  // ---------- 表記揺れの吸収(app.js と同じ考え方) ----------
  const norm = s => s.normalize("NFKC").trim().toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  function buildAliasMap(master) {
    const m = new Map();
    for (const [name, info] of Object.entries(master)) {
      m.set(norm(name), name);
      for (const a of info.aliases || []) m.set(norm(a), name);
    }
    return m;
  }
  // まとめの食材(app.js と同じ): 「鶏肉」と入れたら鶏もも肉・鶏むね肉…も持っているとみなす。
  // レシピ側がまとめの名前(部位の分からない「豆腐」など)なら、どれか1つの部位があればよい
  const membersOf = n => ((state.data ? state.data.ingredients : {})[n] || {}).members || [];
  const expandMembers = list => { const out = new Set(list); for (const n of list) for (const m of membersOf(n)) out.add(m); return out; };
  const hasIngredient = (set, n) => set.has(n) || membersOf(n).some(m => set.has(m));
  function readHave() {
    const known = [], unknown = [];
    for (const t of $("have").value.split(/[、,，\s]+/).filter(Boolean)) {
      const c = state.aliasMap.get(norm(t));
      if (c) { if (!known.includes(c)) known.push(c); } else unknown.push(t);
    }
    state.have = known; state.unknown = unknown;
    state.haveSet = expandMembers(known);
  }

  // ---------- 条件に合うレシピ ----------
  function evaluate() {
    const have = state.haveSet;
    const maxMissing = +$("max-missing").value, maxTime = +$("max-time").value;
    const out = [];
    for (const r of state.data.recipes) {
      const names = r.ingredients.map(i => i.name);
      const matched = names.filter(n => hasIngredient(have, n));
      const missing = names.filter(n => !hasIngredient(have, n));
      if (have.size && matched.length === 0) continue;
      if (missing.length > maxMissing || r.time_min > maxTime) continue;
      // 入力した食材のうち、そのレシピでいちばん量の多いもの(=主役)
      const main = r.ingredients.filter(i => hasIngredient(have, i.name)).sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];
      // 入力した食材のうち、このレシピで使うもの(「鶏肉」と入れて鶏もも肉を使うなら「鶏肉」を使ったと数える)
      const usedHave = state.have.filter(h => matched.some(m => m === h || membersOf(h).includes(m) || membersOf(m).includes(h)));
      out.push({ ...r, matched, missing, usedHave, mainHave: main ? main.name : null });
    }
    return out;
  }
  const byGood = (a, b) => a.missing.length - b.missing.length || b.matched.length - a.matched.length || a.time_min - b.time_min;

  // ---------- 木の形のデータを作る ----------
  function levelsInUse() {
    const lv = [$("lv1").value, $("lv2").value, $("lv3").value].filter(v => v && v !== "none");
    return lv.filter((v, i) => lv.indexOf(v) === i);
  }
  function buildTree(recipes, levels, perGroup) {
    const root = { kind: "root", path: "root", label: `条件に合うレシピ`, count: recipes.length };
    (function split(node, list, depth) {
      if (depth === levels.length) {
        const sorted = list.slice().sort(byGood);
        const n = perGroup + (state.more.get(node.path) || 0);
        node.children = sorted.slice(0, n).map(r => ({ kind: "leaf", path: node.path + "/" + r.id, recipe: r }));
        if (sorted.length > n) node.children.push({ kind: "more", path: node.path + "/+", parentPath: node.path, label: `ほか ${sorted.length - n}品…` });
        return;
      }
      const lv = LEVELS[levels[depth]];
      const groups = d3.group(list, lv.key);
      const rank = k => (lv.order.indexOf(k) < 0 ? 99 : lv.order.indexOf(k));
      node.children = [...groups.keys()]
        .sort((a, b) => rank(a) - rank(b) || groups.get(b).length - groups.get(a).length)
        .map(k => {
          const child = { kind: "group", level: levels[depth], path: `${node.path}/${k}`, label: lv.label(k),
                          count: groups.get(k).length, best: d3.min(groups.get(k), r => r.missing.length) };
          split(child, groups.get(k), depth + 1);
          return child;
        });
    })(root, recipes, 0);
    return root;
  }

  // ---------- 描画 ----------
  const svg = d3.select("#tree");
  const gLink = svg.append("g");
  const gNode = svg.append("g");
  const DX = 22;          // 行の高さ
  const LEAF_W = 300;     // 右端の料理名の幅

  function render() {
    readHave();
    const levels = levelsInUse();
    const recipes = evaluate();
    const data = buildTree(recipes, levels, +$("per-group").value);
    const root = d3.hierarchy(data);
    // 開いていない枝は子を隠す(最初は 1段目まで開く)
    root.each(d => {
      if (d.children && d.data.kind !== "root" && !state.expanded.has(d.data.path)) { d._children = d.children; d.children = null; }
    });

    const width = Math.max(720, $("tree-box").clientWidth - 16);
    const depthMax = levels.length + 1;
    const DY = Math.max(120, Math.min(220, (width - LEAF_W - 200) / depthMax));
    // 料理の行は2行(料理名と時間など)なので、料理どうしは間を広めに空ける
    d3.tree().nodeSize([DX, DY]).separation((a, b) =>
      (a.data.kind === "leaf" || b.data.kind === "leaf" ? 1.7 : a.parent === b.parent ? 1 : 1.3))(root);
    let x0 = Infinity, x1 = -Infinity;
    root.each(d => { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); });
    const height = x1 - x0 + DX * 2;
    const LEFT = 200;        // 根元の「条件に合うレシピ (357)」の文字の分
    svg.attr("width", width).attr("height", height).attr("viewBox", [-LEFT, x0 - DX, width, height]);

    const t = svg.transition().duration(300);
    gLink.selectAll("path").data(root.links(), d => d.target.data.path).join(
      enter => enter.append("path").attr("class", "link"),
      update => update, exit => exit.remove()
    ).transition(t).attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    const node = gNode.selectAll("g.node").data(root.descendants(), d => d.data.path).join(
      enter => {
        const g = enter.append("g").attr("class", "node").attr("transform", d => `translate(${d.y},${d.x})`);
        g.append("circle");
        g.append("text").attr("class", "label");
        g.append("text").attr("class", "meta");
        return g;
      },
      update => update, exit => exit.remove()
    );
    node.attr("class", d => `node ${d.data.kind}${d.data.kind === "leaf" && d.data.recipe.id === state.selected ? " selected" : ""}`)
      .on("click", (e, d) => onClick(d));
    node.transition(t).attr("transform", d => `translate(${d.y},${d.x})`);

    const rOf = d3.scaleSqrt().domain([1, Math.max(1, data.count)]).range([4, 12]);
    node.select("circle")
      .attr("r", d => (d.data.kind === "group" || d.data.kind === "root" ? rOf(d.data.count) : d.data.kind === "more" ? 3 : 4.5))
      .attr("fill", d => {
        if (d.data.kind === "leaf") return missColor(d.data.recipe.missing.length);
        if (d.data.kind === "more") return "#e5793a";
        if (d.data.kind === "root") return "#7a7168";
        return d._children ? missColor(d.data.best) : "#fff";            // 閉じている枝は塗る、開いている枝は白
      })
      .attr("stroke", d => (d.data.kind === "group" ? missColor(d.data.best) : "#fff"))
      .attr("stroke-width", d => (d.data.kind === "group" ? 2 : 1.5));

    // 枝(グループ)は丸の左に名前、料理は右に名前と時間など
    node.select("text.label")
      .attr("x", d => (d.data.kind === "leaf" || d.data.kind === "more" ? 9 : -(rOf(d.data.count || 1) + 5)))
      .attr("dy", "0.32em")
      .attr("text-anchor", d => (d.data.kind === "leaf" || d.data.kind === "more" ? "start" : "end"))
      .text(d => (d.data.kind === "leaf" ? d.data.recipe.name : d.data.kind === "more" ? d.data.label : `${d.data.label} (${d.data.count})`));
    node.select("text.meta")
      .attr("x", 9).attr("dy", "1.45em")
      .text(d => {
        if (d.data.kind !== "leaf") return "";
        const r = d.data.recipe;
        const need = r.missing.length ? `買い足し: ${r.missing.slice(0, 3).join("・")}${r.missing.length > 3 ? "…" : ""}` : "今ある食材で作れる";
        return `${r.time_min}分・¥${r.price}・${need}`;
      });

    // 料理の行は2行になるので、料理の行だけ少し間を空ける(meta が次の行と重ならないように)
    node.filter(d => d.data.kind === "leaf").select("text.label").attr("dy", "-0.15em");
    node.filter(d => d.data.kind === "leaf").select("text.meta").attr("dy", "1.0em");

    renderSunburst(recipes);
    renderNetwork(recipes);
    renderIngTree(recipes);
    const shown = root.leaves().filter(d => d.data.kind === "leaf").length;
    $("summary").innerHTML = `<b>${recipes.length}</b> 品が条件に合います(いま表示している料理 ${shown} 品)`
      + (state.unknown.length ? `　<span style="color:#c0392b">データにない食材: ${state.unknown.join("、")}</span>` : "")
      + (state.have.length ? "" : `　<span>食材を入れると「買い足しの数」で分けられます</span>`);
  }

  function onClick(d) {
    const k = d.data.kind;
    if (k === "group") {
      if (state.expanded.has(d.data.path)) state.expanded.delete(d.data.path); else state.expanded.add(d.data.path);
      render();
    } else if (k === "more") {
      state.more.set(d.data.parentPath, (state.more.get(d.data.parentPath) || 0) + +$("per-group").value);
      render();
    } else if (k === "leaf") {
      selectRecipe(d.data.recipe);
    }
  }

  function selectRecipe(r) {
    state.selected = r.id;
    showDetail(r);
    render();
  }

  // ---------- サンバースト(スタイル・分類ごとの見取り図) ----------
  // feature/scatter-redesign-20261020 の viz.js のサンバーストを、この試作ページ用に移したもの。
  // 内側の輪 = スタイル、中の輪 = 分類、外側の棒 = 料理1品。
  //   棒の長さ = 調理時間(短いほど短い)、棒の太さ = 短いほど太い、棒の色の濃さ = マッチ度
  // 表示する料理は、上の条件(今ある食材・買い足し・調理時間)と同じ
  const STYLE_ORDER = ["和風", "中華", "韓国風", "エスニック", "インド風", "洋風", "メキシカン"];
  const color = d3.scaleOrdinal(STYLE_ORDER, ["#f26b38", "#f2ad3d", "#5bbf9a", "#4aa8c5", "#7c6ed6", "#db6f9f", "#8bbf4a"]);
  const CAT_ORDER = ["主食", "主菜", "副菜", "汁物", "軽食", "デザート"];
  const PALE = "#f1ece6";
  const TIME_MAX = 120;
  const coverageOf = d => (d.ingredients.length ? d.matched.length / d.ingredients.length : 0);
  // マッチ度 = 充足度(料理の材料のうち手持ちでまかなえる割合)と、使い切り度(手持ちの食材のうち使える割合)の調和平均
  const matchScore = (d, haveCount) => {
    const cov = coverageOf(d), use = haveCount ? d.usedHave.length / haveCount : 0;
    return cov + use ? (2 * cov * use) / (cov + use) : 0;
  };
  // 調理時間が短いほど、棒を太く(角度を広く)する重み
  const timeWeight = d => 1 + 1.2 * (1 - Math.min(d.time_min, TIME_MAX) / TIME_MAX);
  let sbZoom = null;   // 拡大表示中の { style, category }
  const nodeKey = d => d.ancestors().map(a => a.data.name).join("/");
  const tip = d3.select("body").append("div").attr("class", "sb-tip").attr("hidden", true);

  function sbTree(recipes) {
    return {
      children: d3.groups(recipes, d => d.style).sort((a, b) => b[1].length - a[1].length).map(([style, rs]) => ({
        name: style, style,
        children: d3.groups(rs, d => d.category)
          .sort((a, b) => CAT_ORDER.indexOf(a[0]) - CAT_ORDER.indexOf(b[0]))
          .map(([cat, list]) => ({ name: cat, style, children: [...list].sort((a, b) => a.time_min - b.time_min).map(r => ({ recipe: r })) })),
      })),
    };
  }

  function drawSunburst(svg, recipes, o) {
    const W = svg.node().getBoundingClientRect().width || 640;
    const size = Math.max(320, Math.min(W, o.maxSize));
    svg.attr("viewBox", [-size / 2, -size / 2, size, size]).attr("height", size);
    const R = size / 2 - (o.showNames ? 70 : 22);
    const r0 = R * (o.zoomed ? 0.2 : 0.24), r1 = R * (o.zoomed ? 0.3 : 0.38), r2 = R * (o.zoomed ? 0.4 : 0.52);
    const hMax = R - r2 - 4;
    const barOuter = d => r2 + 3 + hMax * (0.12 + 0.88 * Math.min(d.time_min, TIME_MAX) / TIME_MAX);
    const recipeFill = d => d3.interpolateRgb(PALE, color(d.style))(o.hasInput ? 0.1 + 0.9 * matchScore(d, o.haveCount) : 0.55);

    const root = d3.hierarchy(sbTree(recipes)).sum(d => (d.recipe ? timeWeight(d.recipe) : 0));
    d3.partition().size([2 * Math.PI, 3])(root);
    const nodes = root.descendants();
    const pad = recipes.length > 150 ? 0.001 : 0.003;
    const arc = (inner, outer) => d3.arc().startAngle(d => d.x0).endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 4, pad)).innerRadius(inner).outerRadius(outer);

    const guides = [10, 30, 60].map(t => ({ t, r: barOuter({ time_min: t }) }));
    svg.selectAll("g.sb-guide").data(recipes.length ? guides : []).join(enter => {
      const g = enter.append("g").attr("class", "sb-guide");
      g.append("circle"); g.append("text");
      return g;
    }).call(g => {
      g.select("circle").attr("r", d => d.r);
      g.select("text").attr("x", 3).attr("y", d => -d.r - 3).text(d => `${d.t}分`);
    });

    const ringData = nodes.filter(d => d.depth === 1 || d.depth === 2);
    const isZoomedRing = d => sbZoom && d.data.style === sbZoom.style &&
      (d.depth === 1 ? !sbZoom.category : d.data.name === sbZoom.category);
    svg.selectAll("path.ring").data(ringData, nodeKey).join("path")
      .attr("class", d => `ring depth${d.depth}`)
      .classed("zoomed", d => !o.zoomed && isZoomedRing(d))
      .attr("d", d => (d.depth === 1 ? arc(r0, r1) : arc(r1 + 2, r2))(d))
      .attr("fill", d => (d.depth === 1 ? color(d.data.style) : d3.interpolateRgb("#ffffff", color(d.data.style))(0.42)))
      .on("mouseenter", (e, d) => centerText(d.data.name + (d.depth === 2 ? `(${d.parent.data.name})` : ""), `${d.leaves().length}品・クリックで拡大`))
      .on("mouseleave", () => centerText())
      .on("click", (e, d) => o.onRing({ style: d.data.style, category: d.depth === 2 ? d.data.name : null }));

    const leaves = nodes.filter(d => d.depth === 3);
    svg.selectAll("path.recipe").data(leaves, d => d.data.recipe.id).join("path")
      .attr("class", "recipe")
      .classed("ready", d => o.hasInput && d.data.recipe.missing.length === 0)
      .classed("selected", d => d.data.recipe.id === state.selected)
      .attr("d", d => arc(r2 + 3, barOuter(d.data.recipe))(d))
      .attr("fill", d => recipeFill(d.data.recipe))
      .on("mouseenter", (e, d) => {
        const r = d.data.recipe;
        showTip(e, r);
        centerText(r.name, `${r.time_min}分` + (o.hasInput ? `・マッチ度 ${Math.round(matchScore(r, o.haveCount) * 100)}%` : ""),
          o.hasInput ? `材料${r.ingredients.length}中${r.matched.length}・手持ち${o.haveCount}中${r.usedHave.length}` : "");
      })
      .on("mousemove", (e, d) => showTip(e, d.data.recipe))
      .on("mouseleave", () => { tip.attr("hidden", true); centerText(); })
      .on("click", (e, d) => selectRecipe(d.data.recipe));

    const nameData = o.showNames ? leaves.filter(d => (d.x1 - d.x0) * R > 9) : [];
    svg.selectAll("text.recipe-name").data(nameData, d => d.data.recipe.id).join("text")
      .attr("class", "recipe-name")
      .attr("transform", d => {
        const a = (d.x0 + d.x1) / 2 * 180 / Math.PI, rr = barOuter(d.data.recipe) + 4;
        return a < 180 ? `rotate(${a - 90}) translate(${rr},0)` : `rotate(${a - 90}) translate(${rr},0) rotate(180)`;
      })
      .attr("text-anchor", d => ((d.x0 + d.x1) / 2 < Math.PI ? "start" : "end")).attr("dy", "0.35em")
      .text(d => { const n = d.data.recipe.name.replace(/^基本の/, ""); return n.length > 10 ? n.slice(0, 10) + "…" : n; });

    const labelData = ringData.filter(d => (d.x1 - d.x0) * (d.depth === 1 ? (r0 + r1) / 2 : (r1 + r2) / 2) > (d.depth === 1 ? 34 : 26));
    svg.selectAll("text.ring-label").data(labelData, nodeKey).join("text")
      .attr("class", d => `ring-label depth${d.depth}`)
      .attr("transform", d => {
        const a = (d.x0 + d.x1) / 2 * 180 / Math.PI, rr = d.depth === 1 ? (r0 + r1) / 2 : (r1 + r2) / 2;
        if (d.x1 - d.x0 > 6.2) return `translate(0,${-rr})`;
        return `rotate(${a - 90}) translate(${rr},0) rotate(${a < 180 ? 0 : 180})`;
      })
      .attr("dy", "0.35em").attr("text-anchor", "middle").text(d => d.data.name);

    const ready = o.hasInput ? recipes.filter(d => d.missing.length === 0).length : null;
    const center = svg.selectAll("g.sb-center").data([0]).join(enter => {
      const g = enter.append("g").attr("class", "sb-center");
      g.append("text").attr("class", "c1").attr("y", -6);
      g.append("text").attr("class", "c2").attr("y", 16);
      g.append("text").attr("class", "c3").attr("y", 32);
      return g;
    });
    function centerText(t1, t2, t3) {
      const def1 = recipes.length ? `${recipes.length}品` : "該当なし";
      const def2 = ready !== null ? `今すぐ作れる ${ready}品` : "食材を入れると色づきます";
      const def3 = o.hidden ? `ほか${o.hidden}品は非表示` : "";
      const s1 = t1 || def1;
      center.select("text.c1").text(s1.length > 9 ? s1.slice(0, 9) + "…" : s1);
      center.select("text.c2").text(t2 || def2);
      center.select("text.c3").text(t1 ? (t3 || "") : def3);
    }
    centerText();
    if (state.selected) svg.selectAll("path.recipe.selected").raise();
  }

  function showTip(e, r) {
    tip.attr("hidden", null)
      .html(`<b>${r.name}</b><br>${r.style}・${r.category}<br>${r.time_min}分・¥${r.price}・${r.nutrition.kcal}kcal<br>`
        + (r.missing.length ? `買い足し: ${r.missing.join("・")}` : "今ある食材で作れる"))
      .style("left", `${e.pageX + 14}px`).style("top", `${e.pageY + 14}px`);
  }

  function renderSunburst(all) {
    const hasInput = state.have.length > 0;
    // スライダー: 足りない食材が n 個以上の料理は表示しない(食材を入力したときだけ有効)
    const maxMissing = +$("sb-max-missing").value;
    $("sb-max-missing-val").textContent = maxMissing;
    $("sb-max-missing").disabled = !hasInput;
    document.querySelector(".sb-slider").classList.toggle("disabled", !hasInput);
    const shown = hasInput ? all.filter(d => d.missing.length < maxMissing) : all;
    const hidden = all.length - shown.length;
    const haveCount = state.have.length;
    const onRing = z => { sbZoom = sbZoom && z.style === sbZoom.style && z.category === sbZoom.category ? null : z; renderSunburst(all); };
    const onRingInZoom = z => { sbZoom = z.category && sbZoom?.category === z.category ? { style: z.style, category: null } : z; renderSunburst(all); };
    drawSunburst(d3.select("#sunburst"), shown, { hasInput, haveCount, hidden, zoomed: false, maxSize: 640, onRing, showNames: false });

    const zoomRecipes = sbZoom ? shown.filter(d => d.style === sbZoom.style && (!sbZoom.category || d.category === sbZoom.category)) : [];
    if (sbZoom && !zoomRecipes.length) sbZoom = null;
    d3.select("#sunburst-zoom-block").attr("hidden", sbZoom ? null : true);
    if (sbZoom) {
      $("sbz-title").textContent = `🔍 ${sbZoom.style}${sbZoom.category ? `・${sbZoom.category}` : ""}(${zoomRecipes.length}品)`;
      $("sbz-close").onclick = () => { sbZoom = null; renderSunburst(all); };
      drawSunburst(d3.select("#sunburst-zoom"), zoomRecipes,
        { hasInput, haveCount, hidden: 0, zoomed: true, maxSize: 720, onRing: onRingInZoom, showNames: zoomRecipes.length <= 90 });
    }
    const sample = color(shown[0]?.style || "和風");
    $("sunburst-legend").innerHTML = `
      <div class="sb-legend-row"><span class="sb-grad" style="background:linear-gradient(90deg, ${PALE}, ${sample})"></span>
        <span>色が濃い = ${hasInput ? "マッチ度が高い(今ある食材をたくさん使い、買い足しも少ない)" : "(食材を入れると、マッチ度で濃さが変わる)"}</span></div>
      <div class="sb-legend-row"><span class="sb-len"></span><span>太い = 調理時間が短い / 外へ長い = 時間がかかる(点線は10・30・60分)</span></div>
      ${hasInput ? `<div class="sb-legend-row"><span class="sb-ready"></span><span>濃い縁取り = 買い足しなしで作れる</span></div>` : ""}
      <div class="sb-legend-row"><span>内側の輪 = スタイル、中の輪 = 分類。輪をクリックすると下に拡大表示</span></div>`;
  }

  // ---------- 共通の食材でつなぐ木(Force-directed tree) ----------
  // 条件に合う料理を、いちばん多くの料理が共通して使う食材から順に枝へまとめる(貪欲法)。
  // 枝の中でも同じように小枝に分け、3段まで。共通の食材がない料理は、その段の食材に直接つなぐ
  let itree = { key: "", sim: null, focus: null };
  function buildIngTree(recipes) {
    const have = new Set(state.have);
    let uid = 0;
    const namesOf = r => [...new Set(r.ingredients.map(i => i.name))];
    const leaf = r => ({ kind: "recipe", id: "r" + uid++, recipe: r });
    function split(list, used, depth) {
      if (depth === 3 || list.length < 2) return list.map(leaf);
      const rest = list.slice(), out = [];
      while (rest.length >= 2) {
        const cnt = d3.rollup(rest.flatMap(r => namesOf(r).filter(n => !used.has(n))), v => v.length, n => n);
        // 同じ数なら今ある食材を先に(手持ちの食材が幹になるように)
        const best = [...cnt].sort((a, b) => b[1] - a[1] || have.has(b[0]) - have.has(a[0]) || a[0].localeCompare(b[0], "ja"))[0];
        if (!best || best[1] < 2) break;
        const name = best[0], group = rest.filter(r => namesOf(r).includes(name));
        out.push({ kind: "ing", id: "i" + uid++, name, have: have.has(name), count: group.length,
                   children: split(group, new Set([...used, name]), depth + 1) });
        for (const r of group) rest.splice(rest.indexOf(r), 1);
      }
      return out.concat(rest.map(leaf));
    }
    return { kind: "root", id: "root", name: state.have.length ? "今ある食材" : "レシピ", children: split(recipes, new Set(), 0) };
  }

  function renderIngTree(all) {
    const N = +$("it-n").value;
    $("it-n-val").textContent = N;
    const recipes = all.slice().sort(byGood).slice(0, N);
    const W = Math.max(720, $("itree-box").clientWidth), H = Math.round(Math.max(560, Math.min(900, W * 0.7)));
    const key = state.have.join("|") + "#" + recipes.map(r => r.id).join(",") + "#" + W;
    if (key === itree.key) return;   // 条件が同じなら描き直さない(動かした配置を残す)
    itree = { key, sim: itree.sim, focus: null };
    if (itree.sim) itree.sim.stop();
    const svg = d3.select("#itree").attr("viewBox", [-W / 2, -H / 2, W, H]).attr("height", H);
    svg.selectAll("*").remove();
    svg.on(".zoom", null);
    if (!recipes.length) {
      svg.append("text").attr("text-anchor", "middle").style("fill", "#7a7168").text("条件に合う料理がありません");
      return;
    }
    const root = d3.hierarchy(buildIngTree(recipes));
    const nodes = root.descendants(), links = root.links();
    const isRecipe = d => d.data.kind === "recipe", isIng = d => d.data.kind === "ing";
    const rOf = d => (isRecipe(d) ? 4 : d.data.kind === "root" ? 7 : 3.5 + Math.sqrt(d.data.count) * 0.9);

    const view = svg.append("g");
    const link = view.append("g").selectAll("line").data(links).join("line");
    const node = view.append("g").selectAll("g").data(nodes).join("g")
      .attr("class", d => (isRecipe(d) ? "it-recipe" : isIng(d) ? `it-ing ${d.data.have ? "have" : "need"}` : "it-root"));
    node.append("circle").attr("r", rOf).attr("fill", d => (isRecipe(d) ? missColor(d.data.recipe.missing.length) : null));
    // 名前は食材の丸だけ(1段目と、3品以上の枝)
    node.filter(d => isIng(d) && (d.depth === 1 || d.data.count >= 3)).append("text")
      .attr("x", d => rOf(d) + 3).attr("dy", "0.35em").style("font-size", d => (d.depth === 1 ? "12px" : "10px"))
      .text(d => `${d.data.name} ${d.data.count}`);
    node.filter(d => d.data.kind === "root").append("text").attr("x", 10).attr("dy", "0.35em").text(d => d.data.name);
    node.filter(d => !isRecipe(d)).raise();   // 食材の丸と名前を、料理の丸より前に出す

    const hideTip = () => tip.attr("hidden", true);
    node.filter(isRecipe)
      .on("mousemove", (e, d) => showTip(e, d.data.recipe)).on("mouseleave", hideTip)
      .on("click", (e, d) => { node.classed("selected", n => n === d); showDetail(d.data.recipe); });
    node.filter(isIng)
      .on("mousemove", (e, d) => tip.attr("hidden", null)
        .html(`<b>${d.data.name}</b>(${d.data.have ? "今ある食材" : "買い足す食材"})<br>この枝の ${d.data.count}品が使う`)
        .style("left", `${e.pageX + 14}px`).style("top", `${e.pageY + 14}px`))
      .on("mouseleave", hideTip)
      .on("click", (e, d) => {   // その枝(と、根元までの道)だけを強調する
        itree.focus = itree.focus === d ? null : d;
        const keep = new Set(itree.focus ? [...d.descendants(), ...d.ancestors()] : []);
        node.classed("dim", n => !!itree.focus && !keep.has(n));
        link.classed("dim", l => !!itree.focus && !(keep.has(l.source) && keep.has(l.target)));
      });

    // d3 ギャラリーの Force-directed tree と同じ組み立て(線で親子を引き寄せ、全体は反発、中心へ弱く寄せる)
    // 配置は先に計算し終えてから描く(開いた直後に動き回らないように)。ドラッグしたときだけ動かす
    const sim = d3.forceSimulation(nodes).randomSource(d3.randomLcg(42)).stop()
      .force("link", d3.forceLink(links).distance(l => (isRecipe(l.target) ? 14 : 34 + 5 * Math.sqrt(l.target.data.count))).strength(1))
      .force("charge", d3.forceManyBody().strength(d => (isRecipe(d) ? -45 : -220)))
      .force("x", d3.forceX().strength(0.04)).force("y", d3.forceY().strength(0.06))
      .force("collide", d3.forceCollide(d => rOf(d) + 1.5));
    const draw = () => {
      link.attr("x1", l => l.source.x).attr("y1", l => l.source.y).attr("x2", l => l.target.x).attr("y2", l => l.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    };
    for (let i = 0; i < 400; i++) sim.tick();
    // 全体が枠に収まるように拡大・縮小しておく
    const [x0, x1] = d3.extent(nodes, d => d.x), [y0, y1] = d3.extent(nodes, d => d.y);
    const k = Math.min(1.6, 0.92 * Math.min(W / (x1 - x0 + 120), H / (y1 - y0 + 40)));
    const zoom = d3.zoom().scaleExtent([0.3, 6]).on("zoom", e => view.attr("transform", e.transform));
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity.scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    sim.on("tick", draw);
    draw();
    node.call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    itree.sim = sim;
  }

  // ---------- つながり図(手持ちの食材 → 作れる料理 → 足りない食材) ----------
  // 左に入力した食材、まん中に候補の料理、右に足りない食材を置き、料理と食材を線で結ぶ。
  // 多くの料理から線が集まる「足りない食材」ほど大きく描くので、
  // 「これを1つ買い足せば作れる料理が一番増える食材」がハブとして見える。
  let net = { key: "", sim: null, focus: null };
  function renderNetwork(all) {
    const svg = d3.select("#network");
    const N = +$("net-n").value;
    const W = Math.max(720, $("network-box").clientWidth - 16);
    $("net-n-val").textContent = N;
    const hasInput = state.have.length > 0;
    if (!hasInput) {
      svg.selectAll("*").remove();
      svg.attr("viewBox", [0, 0, W, 200]).attr("height", 200);
      svg.append("text").attr("x", W / 2).attr("y", 100).attr("text-anchor", "middle").attr("fill", "#7a7168")
        .text("今ある食材を入れると、つながり図が出ます");
      $("net-rank").innerHTML = ""; net.key = "";
      return;
    }
    // 買い足しなしで作れる料理は右側とつながらないので、最大8品に抑えて、残りは買い足しが必要な料理から選ぶ
    const sorted = all.slice().sort(byGood);
    const ready = sorted.filter(r => r.missing.length === 0).slice(0, 8);
    const recipes = [...ready, ...sorted.filter(r => r.missing.length > 0)].slice(0, N);
    const key = state.have.join("|") + "#" + recipes.map(r => r.id).join(",") + "#" + W + "#" + netMode();
    if (key !== net.key) buildNetwork(svg, recipes, W);
    net.key = key;
    updateNetworkStyles(svg);
    renderUnlockRank(recipes);
  }

  // 買い足すと作れるようになる料理(足りない食材がその1つだけの料理)と、関係する料理の数
  function unlockStats(recipes) {
    const m = new Map();
    for (const r of recipes) for (const n of r.missing) {
      const x = m.get(n) || { name: n, need: [], unlock: [] };
      x.need.push(r);
      if (r.missing.length === 1) x.unlock.push(r);
      m.set(n, x);
    }
    return [...m.values()].sort((a, b) => b.unlock.length - a.unlock.length || b.need.length - a.need.length);
  }

  // 並べ方は2通り(上のボタンで切り替え)。どちらも点と文字が重ならないようにする。
  //  - 列: 手持ち | 料理2列 | 足りない食材 に並べ、列の中の順番を「つながる相手の高さの平均」で並べ直して線の交差を減らす
  //  - Force-directed: 線をばね、点どうしを反発させる物理シミュレーション。文字の四角どうしもぶつからないようにする
  const netMode = () => (document.querySelector('input[name="net-mode"]:checked') || {}).value || "columns";

  function buildNetwork(svg, recipes, W) {
    if (net.sim) net.sim.stop();
    svg.selectAll("*").remove();
    svg.classed("has-focus", false);
    net.focus = null;
    const mode = netMode();
    const stats = new Map(unlockStats(recipes).map(x => [x.name, x]));
    const usedHave = [...new Set(recipes.flatMap(r => r.matched))];
    const haveN = usedHave.map(n => ({ id: "h:" + n, kind: "have", name: n, deg: recipes.filter(r => r.matched.includes(n)).length }));
    const recN = recipes.map(r => ({ id: "r:" + r.id, kind: "recipe", name: r.name, recipe: r }));
    const misN = [...stats.values()].map(x => ({ id: "m:" + x.name, kind: "missing", name: x.name, deg: x.need.length, unlock: x.unlock.length }));
    const all = [...haveN, ...recN, ...misN];
    const byId = new Map(all.map(d => [d.id, d]));
    const links = recipes.flatMap(r => [
      ...r.matched.map(n => ({ source: byId.get("h:" + n), target: byId.get("r:" + r.id), kind: "have" })),
      ...r.missing.map(n => ({ source: byId.get("r:" + r.id), target: byId.get("m:" + n), kind: "missing" })),
    ]);
    const rOf = d => (d.kind === "recipe" ? 5 : d.kind === "have" ? Math.min(24, 9 + Math.sqrt(d.deg) * 2.2) : Math.min(16, 4 + Math.sqrt(d.deg) * 3));
    for (const d of all) d.r = rOf(d);

    const X = { have: W * 0.13, rec0: W * 0.30, rec1: W * 0.52, missing: W * 0.76 };
    const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    const recChars = mode === "columns" ? Math.max(6, Math.floor((X.rec1 - X.rec0 - 20) / 10)) : 10;
    const label = d => (d.kind === "missing" ? `${d.name}(${d.deg}品)` : d.kind === "recipe" ? cut(d.name, recChars) : d.name);

    // 先に描いて文字の幅を測る(重なり判定に使う)
    const gLink = svg.append("g").attr("class", "net-links");
    const gNode = svg.append("g").attr("class", "net-nodes");
    const link = gLink.selectAll("path").data(links).join("path").attr("class", d => `net-link ${d.kind}`).attr("fill", "none");
    const node = gNode.selectAll("g").data(all, d => d.id).join("g").attr("class", d => `net-node ${d.kind}`);
    node.append("circle").attr("r", d => d.r);
    node.append("text").attr("dy", "0.32em")
      .attr("x", d => (d.kind === "have" ? -d.r - 5 : d.r + 4))
      .attr("text-anchor", d => (d.kind === "have" ? "end" : "start"))
      .text(label)
      .each(function (d) { d.tw = this.getComputedTextLength(); });
    // 点+文字をまとめた四角(点の中心からの相対位置)
    for (const d of all) {
      const h = Math.max(d.r, 8) + 1;
      d.box = d.kind === "have" ? { l: -d.r - 5 - d.tw - 2, r: d.r + 2, t: -h, b: h } : { l: -d.r - 2, r: d.r + 4 + d.tw + 2, t: -h, b: h };
    }

    let H;
    if (mode === "columns") H = layoutColumns(haveN, recN, misN, links, X);
    else H = layoutForce(all, links, W);
    svg.attr("viewBox", [0, 0, W, H]).attr("height", H);

    const curve = d3.linkHorizontal().x(p => p.x).y(p => p.y);
    const draw = () => {
      link.attr("d", d => (mode === "columns" ? curve({ source: d.source, target: d.target }) : `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`));
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    };
    draw();

    node.on("mouseenter", (e, d) => { if (!net.focus) highlightNet(svg, d); netTip(e, d); })
      .on("mousemove", (e, d) => netTip(e, d))
      .on("mouseleave", () => { tip.attr("hidden", true); if (!net.focus) highlightNet(svg, null); })
      .on("click", (e, d) => {
        if (e.defaultPrevented) return;                     // ドラッグの直後はクリック扱いにしない
        if (d.kind === "recipe") { selectRecipe(d.recipe); return; }
        net.focus = net.focus === d.id ? null : d.id;       // 食材をクリック → その食材につながる料理だけ強調(もう一度で解除)
        highlightNet(svg, net.focus ? d : null);
        if (d.kind === "missing") showUnlock(d.name, recipes);
      });

    if (mode === "force") {
      // ドラッグで動かせる。動かしている間も四角どうしは押しのけ合うので重ならない
      net.sim.on("tick", () => { clampAll(all, W, H); draw(); });
      node.call(d3.drag()
        .on("start", (e, d) => { if (!e.active) net.sim.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (e, d) => { d.fx = Math.max(-d.box.l, Math.min(W - d.box.r, e.x)); d.fy = Math.max(-d.box.t, Math.min(H - d.box.b, e.y)); })
        .on("end", (e, d) => { if (!e.active) net.sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    }
    net.stats = stats;
  }

  function layoutColumns(haveN, recN, misN, links, X) {
    const nb = new Map([...haveN, ...recN, ...misN].map(d => [d.id, []]));
    for (const l of links) { nb.get(l.source.id).push(l.target); nb.get(l.target.id).push(l.source); }
    const REC_ROW = 17, GAP = 6;
    const stack = (list, minGap) => {
      let y = 0;
      list.forEach((d, i) => { if (i) y += Math.max(minGap, list[i - 1].r + d.r + GAP); d.y = y; });
      return y;
    };
    const placeRecipes = () => { recN.forEach((d, i) => { d.col = i % 2; d.y = Math.floor(i / 2) * REC_ROW + (d.col ? REC_ROW / 2 : 0); }); return Math.ceil(recN.length / 2) * REC_ROW; };
    const mean = d => { const a = nb.get(d.id); return a.length ? d3.mean(a, z => z.y) : 0; };
    let H = 0;
    const layout = () => {
      const hs = [stack(haveN, 60), placeRecipes(), stack(misN, 20)];
      H = Math.max(420, ...hs) + 48;
      [haveN, recN, misN].forEach((col, k) => { const off = (H - hs[k]) / 2; for (const d of col) d.y += off; });
    };
    haveN.sort((a, b) => b.deg - a.deg);
    misN.sort((a, b) => b.unlock - a.unlock || b.deg - a.deg);
    layout();
    for (let it = 0; it < 6; it++) {
      for (const d of recN) d.key = mean(d);
      recN.sort((a, b) => a.key - b.key); layout();
      for (const d of misN) d.key = mean(d);
      misN.sort((a, b) => a.key - b.key); layout();
      for (const d of haveN) d.key = mean(d);
      haveN.sort((a, b) => a.key - b.key); layout();
    }
    for (const d of haveN) d.x = X.have;
    for (const d of recN) d.x = d.col ? X.rec1 : X.rec0;
    for (const d of misN) d.x = X.missing;
    return H;
  }

  // 四角(点+文字)どうしが重なっていたら、重なりの少ない向きに押し離す力
  function forceBoxCollide(pad = 2) {
    let nodes;
    const force = () => {
      const k = 1;   // 重なった分だけ(2つで分け合って)ずらす
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const ox = Math.min(a.x + a.box.r, b.x + b.box.r) - Math.max(a.x + a.box.l, b.x + b.box.l) + pad;
          if (ox <= 0) continue;
          const oy = Math.min(a.y + a.box.b, b.y + b.box.b) - Math.max(a.y + a.box.t, b.y + b.box.t) + pad;
          if (oy <= 0) continue;
          const fa = a.fx != null ? 0 : b.fx != null ? 1 : 0.5;   // ドラッグ中の点は動かさない(fa = aが受け持つ割合)
          if (oy < ox) {   // 上下にずらすほうが近い
            const s = (a.y + (a.box.t + a.box.b) / 2 < b.y + (b.box.t + b.box.b) / 2 ? -1 : 1) * oy * k;
            a.y += s * fa; b.y -= s * (1 - fa);
          } else {
            const s = (a.x + (a.box.l + a.box.r) / 2 < b.x + (b.box.l + b.box.r) / 2 ? -1 : 1) * ox * k;
            a.x += s * fa; b.x -= s * (1 - fa);
          }
        }
      }
    };
    force.initialize = n => { nodes = n; };
    return force;
  }
  function clampAll(nodes, W, H) {
    for (const d of nodes) { d.x = Math.max(-d.box.l, Math.min(W - d.box.r, d.x)); d.y = Math.max(-d.box.t, Math.min(H - d.box.b, d.y)); }
  }

  function countBoxOverlaps(nodes) {
    let n = 0;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (Math.min(a.x + a.box.r, b.x + b.box.r) > Math.max(a.x + a.box.l, b.x + b.box.l) &&
          Math.min(a.y + a.box.b, b.y + b.box.b) > Math.max(a.y + a.box.t, b.y + b.box.t)) n++;
    }
    return n;
  }

  function layoutForce(all, links, W) {
    // 面積は四角の合計から決める。重なりが残ったら、縦を広げてやり直す
    const area = d3.sum(all, d => (d.box.r - d.box.l + 8) * (d.box.b - d.box.t + 8));
    let H = Math.max(480, Math.round(area * 2.6 / W));
    const xTarget = d => (d.kind === "have" ? W * 0.15 : d.kind === "recipe" ? W * 0.45 : W * 0.78);
    const rand = d3.randomLcg(42);   // 毎回同じ配置になるように乱数を固定
    for (let attempt = 0; attempt < 5; attempt++) {
      const y0 = H / 2;
      all.forEach(d => { d.x = xTarget(d) + (rand() - 0.5) * 60; d.y = y0 + (rand() - 0.5) * H * 0.8; d.vx = d.vy = 0; });
      net.sim = d3.forceSimulation(all)
        .force("link", d3.forceLink(links).distance(l => (l.kind === "have" ? 110 : 80)).strength(0.3))
        .force("charge", d3.forceManyBody().strength(d => (d.kind === "recipe" ? -40 : -160)))
        .force("x", d3.forceX(xTarget).strength(d => (d.kind === "recipe" ? 0.06 : 0.12)))   // 手持ちは左、足りない食材は右に寄せる
        .force("y", d3.forceY(y0).strength(0.03))
        .force("box", forceBoxCollide())
        .stop();
      for (let i = 0; i < 320; i++) { net.sim.tick(); clampAll(all, W, H); }
      // 最後に重なりだけを解く(線の力は止めて、四角どうしの押し合いだけ)
      const box = forceBoxCollide(2); box.initialize(all);
      for (let i = 0; i < 400; i++) { box(); clampAll(all, W, H); if (i % 50 === 49 && countBoxOverlaps(all) === 0) break; }
      if (countBoxOverlaps(all) === 0) break;
      H = Math.round(H * 1.25);
    }
    for (const d of all) { d.vx = d.vy = 0; }
    // 上下の余白を切り詰める(点がある範囲だけを表示)
    const top = d3.min(all, d => d.y + d.box.t), bottom = d3.max(all, d => d.y + d.box.b);
    for (const d of all) d.y += 16 - top;
    return Math.round(bottom - top + 32);
  }


  function highlightNet(svg, d) {
    const on = new Set();
    if (d) {
      on.add(d.id);
      svg.selectAll("path.net-link").each(l => {
        if (l.source.id === d.id || l.target.id === d.id) { on.add(l.source.id); on.add(l.target.id); }
      });
      // 足りない食材を選んだときは、その料理が使う手持ちの食材も光らせる
      if (d.kind === "missing" || d.kind === "have") svg.selectAll("path.net-link").each(l => {
        if (on.has(l.target.id) && l.source.id.startsWith("h:") && d.kind === "missing") on.add(l.source.id);
      });
    }
    svg.classed("has-focus", !!d);
    svg.selectAll("g.net-node").classed("dim", n => d && !on.has(n.id)).classed("focus", n => d && n.id === d.id);
    svg.selectAll("path.net-link").classed("dim", l => d && !(on.has(l.source.id) && on.has(l.target.id)));
  }

  function updateNetworkStyles(svg) {
    svg.selectAll("g.net-node.recipe")
      .classed("ready", d => d.recipe.missing.length === 0)
      .classed("selected", d => d.recipe.id === state.selected);
  }

  function netTip(e, d) {
    let html;
    if (d.kind === "recipe") {
      const r = d.recipe;
      html = `<b>${r.name}</b><br>${r.time_min}分・¥${r.price}<br>` + (r.missing.length ? `買い足し: ${r.missing.join("・")}` : "今ある食材で作れる");
    } else if (d.kind === "missing") {
      html = `<b>${d.name}</b>(買い足す食材)<br>この図の料理のうち ${d.deg}品で使う<br>これだけ買えば作れる料理: <b>${d.unlock}品</b>`;
    } else {
      html = `<b>${d.name}</b>(今ある食材)<br>この図の料理のうち ${d.deg}品で使う`;
    }
    tip.attr("hidden", null).html(html).style("left", `${e.pageX + 14}px`).style("top", `${e.pageY + 14}px`);
  }

  // 「買い足すと作れる料理が増える食材」ランキング(上位5つ)
  function renderUnlockRank(recipes) {
    const top = unlockStats(recipes).slice(0, 5);
    $("net-rank").innerHTML = `<h4>買い足すと作れる料理が増える食材</h4><ol>` + top.map(x =>
      `<li><button type="button" data-name="${x.name}">${x.name}</button> <span>これだけで作れる ${x.unlock.length}品 / 使う料理 ${x.need.length}品</span></li>`).join("") + `</ol>`
      + `<p class="hint">図の上位${recipes.length}品の中で数えています。食材名を押すと、図の中で強調します。</p>`;
    for (const b of $("net-rank").querySelectorAll("button")) b.addEventListener("click", () => {
      const svg = d3.select("#network");
      const d = svg.selectAll("g.net-node.missing").data().find(n => n.name === b.dataset.name);
      if (!d) return;
      net.focus = d.id; highlightNet(svg, d); showUnlock(d.name, recipes);
    });
  }

  function showUnlock(name, recipes) {
    const x = unlockStats(recipes).find(s => s.name === name);
    if (!x) return;
    $("detail").innerHTML = `<h3>${name} を買い足すと</h3>
      <p>この図の料理のうち <b>${x.need.length}品</b> で使います。<br>${name}だけ買えば作れる料理は <b>${x.unlock.length}品</b> です。</p>
      <ol>${x.unlock.map(r => `<li><a href="#" data-id="${r.id}">${r.name}</a>(${r.time_min}分)</li>`).join("") || "<li>なし(ほかの食材も必要)</li>"}</ol>
      <p class="hint">料理名を押すと詳細を出します。</p>`;
    for (const a of $("detail").querySelectorAll("a[data-id]")) a.addEventListener("click", e => {
      e.preventDefault(); const r = recipes.find(z => z.id === a.dataset.id); if (r) selectRecipe(r);
    });
  }

  function showDetail(r) {
    const have = r.matched.map(n => `<span class="have">${n}</span>`).join("、") || "なし";
    const need = r.missing.map(n => `<span class="need">${n}</span>`).join("、") || "なし";
    const q = new URLSearchParams({ open: r.id, have: state.have.join("、") });
    $("detail").innerHTML = `
      ${r.image ? `<img src="${r.image}" alt="">` : ""}
      <h3>${r.name}</h3>
      <div><span class="tag">${r.category}</span><span class="tag">${r.style}</span></div>
      <p>⏱ ${r.time_min}分　💰 ¥${r.price}　🔥 ${r.nutrition.kcal}kcal</p>
      <p>ある食材: ${have}<br>買い足す食材: ${need}</p>
      <p class="hint">調味料など: ${(r.pantry || []).join("、")}</p>
      <p><a href="search.html?${q}">いつもの検索ページで開く →</a></p>
      ${r.source?.url ? `<p><a href="${r.source.url}" target="_blank" rel="noopener">出典のレシピ ↗</a></p>` : ""}`;
  }

  // ---------- 入力 ----------
  function initControls(data) {
    const opts = Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
    $("lv1").innerHTML = opts;
    $("lv2").innerHTML = `<option value="none">なし</option>` + opts;
    $("lv3").innerHTML = `<option value="none">なし</option>` + opts;
    $("lv1").value = "missing"; $("lv2").value = "category"; $("lv3").value = "style";

    // よく使う食材(登場回数の多い順)をボタンにする
    const freq = d3.rollup(data.recipes.flatMap(r => r.ingredients.map(i => i.name)), v => v.length, d => d);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(d => d[0]);
    const quick = $("quick");
    const syncChips = () => { readHave(); for (const b of quick.children) b.classList.toggle("on", state.have.includes(b.textContent)); };
    for (const name of top) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = name;
      b.addEventListener("click", () => {
        readHave();
        const set = new Set(state.have);
        if (set.has(name)) set.delete(name); else set.add(name);
        $("have").value = [...set, ...state.unknown].join("、");
        reset(); syncChips();
      });
      quick.appendChild(b);
    }
    syncChips();

    let timer = null;
    $("have").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { reset(); syncChips(); }, 250); });
    for (const id of ["lv1", "lv2", "lv3", "max-missing", "max-time", "per-group"]) $(id).addEventListener("change", reset);
    $("sb-max-missing").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
    for (const el of document.querySelectorAll('input[name="net-mode"]')) el.addEventListener("change", render);
    $("net-n").addEventListener("input", () => { $("net-n-val").textContent = $("net-n").value; clearTimeout(timer); timer = setTimeout(render, 200); });
    $("it-n").addEventListener("input", () => { $("it-n-val").textContent = $("it-n").value; clearTimeout(timer); timer = setTimeout(render, 200); });
    $("expand-all").addEventListener("click", () => {
      const root = d3.hierarchy(buildTree(evaluate(), levelsInUse(), +$("per-group").value));
      root.each(d => { if (d.data.kind === "group") state.expanded.add(d.data.path); });
      render();
    });
    $("collapse-all").addEventListener("click", () => { state.expanded = new Set(["root"]); render(); });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 200); });

    $("legend").innerHTML = ["買い足しなし", "1個", "2個", "3個以上"]
      .map((t, i) => `<span><i style="background:${MISSING_COLOR[i]}"></i>${t}</span>`).join("")
      + `<span>・白い丸 = 開いている枝 / 塗った丸 = 閉じている枝(クリックで開く)</span>`;
  }
  // 条件を変えたら、開き方を戻す: 1段目は全部見せ、いちばん上の枝だけ料理まで開いておく(何が見られるか分かるように)
  function reset() {
    state.expanded = new Set(["root"]); state.more = new Map();
    let node = d3.hierarchy(buildTree(evaluate(), levelsInUse(), +$("per-group").value));
    while (node.children && node.children[0] && node.children[0].data.kind === "group") {
      node = node.children[0];
      state.expanded.add(node.data.path);
    }
    render();
  }

  RecipeData.load().then(data => {
    state.data = data;
    state.aliasMap = buildAliasMap(data.ingredients);
    initControls(data);
    reset();
  }).catch(err => {
    console.error(err);
    $("summary").textContent = "レシピデータを読み込めませんでした。VSCode の Live Server で開いてください。";
  });
})();
