/*
 * モバイル専用の検索画面。
 * PC版のファイルを変更せず、search.html の構造と既存スクリプトを読み込んで利用する。
 */
(() => {
  "use strict";

  const sourceUrl = new URL("search.html", document.baseURI);
  const $ = (selector, root = document) => root.querySelector(selector);
  const mobileTargets = {
    "index.html": "index.html",
    "search.html": "search.html",
    "favorites.html": "favorites.html",
    "atlas-discovery.html": "map.html",
    "atlas-discovery.htm": "map.html",
    "atlas.html": "map.html",
  };

  function mobileUrl(url) {
    const resolved = new URL(url, sourceUrl);
    if (resolved.origin !== location.origin) return null;
    const file = resolved.pathname.split("/").pop();
    const target = mobileTargets[file];
    if (!target) return null;
    const mobile = new URL(`mobile/${target}`, document.baseURI);
    mobile.search = resolved.search;
    mobile.hash = resolved.hash;
    return mobile.href;
  }

  function routeLinks(root = document) {
    root.querySelectorAll?.("a[href]").forEach(link => {
      const target = mobileUrl(link.getAttribute("href"));
      if (target) link.href = target;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
      document.body.append(script);
    });
  }

  function buildMobileControls() {
    const main = $("main");
    const controls = $("#controls");
    if (!main || !controls) return;

    const toolbar = document.createElement("div");
    toolbar.className = "mobile-filter-bar";
    toolbar.innerHTML = `
      <p>食材・条件を指定して、今日作れる料理を探します。</p>
      <button class="mobile-filter-trigger" type="button" aria-controls="controls" aria-expanded="false">
        <span aria-hidden="true">☷</span> 条件を絞り込む
      </button>`;
    main.before(toolbar);

    const backdrop = document.createElement("button");
    backdrop.className = "mobile-filter-backdrop";
    backdrop.type = "button";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", "条件パネルを閉じる");
    document.body.append(backdrop);

    const heading = document.createElement("div");
    heading.className = "mobile-filter-heading";
    heading.innerHTML = `
      <div><p>FILTERS</p><h2>食材・条件を絞り込む</h2></div>
      <button type="button" class="mobile-filter-close" aria-label="条件パネルを閉じる">×</button>`;
    controls.prepend(heading);

    const trigger = $(".mobile-filter-trigger");
    const closeButton = $(".mobile-filter-close", controls);
    let lastFocus = null;

    const setOpen = open => {
      document.body.classList.toggle("mobile-filters-open", open);
      trigger.setAttribute("aria-expanded", String(open));
      controls.setAttribute("aria-hidden", String(!open));
      controls.inert = !open;
      if (open) {
        lastFocus = document.activeElement;
        requestAnimationFrame(() => $("#ing-input")?.focus());
      } else if (lastFocus instanceof HTMLElement) {
        lastFocus.focus();
      }
    };

    setOpen(false);
    trigger.addEventListener("click", () => setOpen(true));
    closeButton.addEventListener("click", () => setOpen(false));
    backdrop.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && document.body.classList.contains("mobile-filters-open")) {
        setOpen(false);
      }
    });

    // ヘッダー検索から食材を渡したときは、既存処理が入力欄にフォーカスできるようにする。
    $("#header-search")?.addEventListener("submit", () => setOpen(true), true);
  }

  async function start() {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`検索画面を読み込めませんでした (HTTP ${response.status})`);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      const content = [...source.body.children].filter(node => node.tagName !== "SCRIPT");
      document.body.replaceChildren(...content);
      document.body.className = "search-layout-only mobile-search";
      routeLinks();

      // 詳細パネルなど、既存の描画スクリプトが後から作るリンクもPC版へ逃がさない。
      // capture 段階で変換するため、recipe-navigation.js の既存クリック処理より先に適用される。
      document.addEventListener("click", event => {
        const link = event.target.closest?.("a[href]");
        const target = link && mobileUrl(link.getAttribute("href"));
        if (target) link.href = target;
      }, true);

      buildMobileControls();

      const scripts = [...source.querySelectorAll("script[src]")]
        .map(script => new URL(script.getAttribute("src"), sourceUrl).href);
      for (const src of scripts) await loadScript(src);
      routeLinks();
      document.body.classList.add("mobile-ready");
      window.dispatchEvent(new Event("mobile:ready"));
    } catch (error) {
      console.error(error);
      document.body.className = "mobile-search mobile-load-error";
      document.body.replaceChildren();
      const message = document.createElement("main");
      message.className = "mobile-load-error-message";
      const title = document.createElement("h1");
      title.textContent = "検索画面を準備できませんでした";
      const body = document.createElement("p");
      body.textContent = "Live Server などのローカルサーバーで開き、もう一度お試しください。";
      message.append(title, body);
      document.body.append(message);
    }
  }

  start();
})();
