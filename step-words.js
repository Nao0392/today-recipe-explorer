// 作り方の言葉くらべ(料理の系統ごとのワードクラウド)
// ・data/step_words.json を読む。これは temp_koba/delish_pipeline/step_words.py が
//   各レシピの作り方(steps)を形態素解析し、系統(和風・洋風…)ごとに「ほかの系統より特に多い言葉」を数えたもの
// ・言葉の大きさ = その系統での多さ(score = その系統での割合 × log2(その系統での割合 ÷ ほかの系統での割合))
// ・tree-playground.js とは独立していて、d3 と d3-cloud だけを使う
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const COLORS = { "和風": "#f26b38", "洋風": "#db6f9f", "中華": "#e09b1f", "韓国風": "#3fae84", "エスニックほか": "#4a98c5" };
  const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
  const pct = v => `${Math.round(v * 100)}%`;
  let data = null, selected = null;

  function init() {
    fetch("data/step_words.json").then(r => r.json()).then(d => { data = d; render(); })
      .catch(() => { $("sw-grid").innerHTML = `<p class="hint">data/step_words.json を読み込めませんでした。</p>`; });
    for (const el of document.querySelectorAll('input[name="sw-view"]')) el.addEventListener("change", render);
    let timer;
    $("sw-n").addEventListener("input", () => { $("sw-n-val").textContent = $("sw-n").value; clearTimeout(timer); timer = setTimeout(render, 200); });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 300); });
  }

  function render() {
    if (!data) return;
    const n = +$("sw-n").value;
    const view = document.querySelector('input[name="sw-view"]:checked').value;
    const grid = d3.select("#sw-grid");
    grid.selectAll("*").remove();
    for (const g of data.groups) {
      const card = grid.append("div").attr("class", "sw-card");
      card.append("h4").html(`<span class="sw-dot" style="background:${COLORS[g.name]}"></span>${g.name}<small>${g.recipes}品</small>`);
      const words = g.words.slice(0, n);
      const w = Math.max(280, card.node().clientWidth - 20);
      if (view === "cloud") drawCloud(card, g, words, w);
      else drawBars(card, g, words.slice(0, 12), w);
    }
    showWord(selected);
  }

  // ---------- ワードクラウド ----------
  function drawCloud(card, g, words, W) {
    const H = 250;
    const svg = card.append("svg").attr("viewBox", [-W / 2, -H / 2, W, H]).attr("width", "100%").attr("height", H);
    const max = d3.max(words, d => d.score) || 1;
    const shade = d3.scaleLinear().domain([0, max]).range([0.35, 1]);
    const ink = d3.interpolateRgb("#c9bfb5", d3.color(COLORS[g.name]).darker(0.7));
    const bold = d => (d.score > max * 0.4 ? 700 : 500);
    // 入りきらない言葉が出たら、文字を少し小さくしてやり直す(全部入るまで、最大8回)
    const attempt = (k, tries) => {
      const size = d3.scaleSqrt().domain([0, max]).range([9 * Math.max(0.8, k), 40 * k]);
      d3.layout.cloud()
        .size([W, H])
        .words(words.map(d => ({ ...d, text: d.word, size: size(d.score) })))
        .padding(2)
        .rotate(0)                         // 日本語は縦にすると読みにくいので、すべて横書き
        .font(FONT).fontWeight(bold)
        .fontSize(d => d.size)
        .random(d3.randomLcg(7))           // 毎回同じ配置にする
        .on("end", placed => {
          if (placed.length < words.length && tries < 8) return attempt(k * 0.88, tries + 1);
          draw(placed);
        })
        .start();
    };
    const draw = placed => {
      svg.selectAll("text").data(placed).join("text")
        .attr("class", d => `sw-word${selected && selected.word === d.word && selected.group === g.name ? " selected" : ""}`)
        .attr("text-anchor", "middle")
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("font-family", FONT).style("font-size", d => `${d.size}px`).style("font-weight", bold)
        .style("fill", d => ink(shade(d.score)))
        .text(d => d.text)
        .on("mouseenter", (e, d) => tipShow(e, g, d)).on("mousemove", (e, d) => tipShow(e, g, d)).on("mouseleave", tipHide)
        .on("click", (e, d) => select(g, d));
      const dropped = words.length - placed.length;
      if (dropped > 0) card.append("p").attr("class", "sw-note").text(`入りきらなかった言葉: ${dropped}語(数を減らすか、横棒グラフで見られます)`);
    };
    attempt(1, 0);
  }

  // ---------- 横棒グラフ(この系統での割合 と ほかの系統での割合) ----------
  function drawBars(card, g, words, W) {
    const rowH = 20, M = { l: 104, r: 44, t: 18 };
    const H = M.t + words.length * rowH + 6;
    const svg = card.append("svg").attr("viewBox", [0, 0, W, H]).attr("width", "100%").attr("height", H);
    const x = d3.scaleLinear().domain([0, d3.max(words, d => Math.max(d.share, d.share_rest)) || 1]).range([M.l, W - M.r]);
    svg.append("text").attr("class", "sw-legend").attr("x", M.l).attr("y", 11)
      .html(`<tspan fill="${COLORS[g.name]}">■</tspan> ${g.name}の料理での割合　<tspan fill="#c9bfb5">■</tspan> ほかの系統での割合`);
    const row = svg.selectAll("g.row").data(words).join("g").attr("class", "row")
      .attr("transform", (d, i) => `translate(0,${M.t + i * rowH})`)
      .on("mouseenter", (e, d) => tipShow(e, g, d)).on("mousemove", (e, d) => tipShow(e, g, d)).on("mouseleave", tipHide)
      .on("click", (e, d) => select(g, d));
    row.append("rect").attr("class", "sw-hit").attr("x", 0).attr("width", W).attr("height", rowH);
    row.append("text").attr("x", M.l - 6).attr("y", rowH / 2).attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("class", d => `sw-bar-label${selected && selected.word === d.word && selected.group === g.name ? " selected" : ""}`).text(d => d.word);
    row.append("rect").attr("x", M.l).attr("y", 3).attr("height", 9).attr("rx", 2).attr("fill", COLORS[g.name]).attr("width", d => x(d.share) - M.l);
    row.append("rect").attr("x", M.l).attr("y", 13).attr("height", 4).attr("rx", 1).attr("fill", "#c9bfb5").attr("width", d => Math.max(1, x(d.share_rest) - M.l));
    row.append("text").attr("class", "sw-val").attr("x", d => x(d.share) + 4).attr("y", 8).attr("dy", "0.35em").text(d => pct(d.share));
  }

  // ---------- ツールチップと、クリックしたときの説明 ----------
  const tip = d3.select("body").append("div").attr("class", "sb-tip").attr("hidden", true);
  function tipShow(e, g, d) {
    tip.attr("hidden", null)
      .html(`<b>${d.word}</b>(${g.name})<br>${g.name}の料理の <b>${pct(d.share)}</b>(${d.count}品)の作り方に出てくる<br>ほかの系統では ${pct(d.share_rest)}`)
      .style("left", `${e.pageX + 14}px`).style("top", `${e.pageY + 14}px`);
  }
  function tipHide() { tip.attr("hidden", true); }

  function select(g, d) {
    selected = selected && selected.word === d.word && selected.group === g.name ? null : { group: g.name, word: d.word };
    render();
  }
  function showWord(sel) {
    const box = $("sw-info");
    if (!sel) { box.innerHTML = `<p class="hint">言葉をクリックすると、その言葉が出てくる料理の例をここに出します。</p>`; return; }
    const g = data.groups.find(x => x.name === sel.group);
    const d = g && g.words.find(x => x.word === sel.word);
    if (!d) { box.innerHTML = ""; return; }
    // ほかの系統での同じ言葉(上位に入っている場合)
    const others = data.groups.filter(x => x.name !== g.name).map(x => [x.name, x.words.find(y => y.word === d.word)]).filter(x => x[1]);
    box.innerHTML = `<h4>「${d.word}」— ${g.name}</h4>
      <p>${g.name}の料理 ${g.recipes}品のうち <b>${d.count}品(${pct(d.share)})</b> の作り方に出てきます。ほかの系統では ${pct(d.share_rest)} です。
      ${others.length ? `<br>ほかに特徴語として出ている系統: ${others.map(([n, y]) => `${n}(${pct(y.share)})`).join("、")}` : ""}</p>
      <p>例: ${d.examples.map(x => `<a href="search.html?open=${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${x.name}</a>`).join("、")}</p>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
