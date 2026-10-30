/* PC版を変更せず、トップ・お気に入り・類似度マップをモバイル用の入口で動かす。 */
(() => {
  "use strict";

  const initialBody = document.body;
  const sourcePath = initialBody.dataset.mobileSource;
  const page = initialBody.dataset.mobilePage;
  const sourceUrl = new URL(sourcePath, document.baseURI);
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

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
      document.body.append(script);
    });
  }

  async function runSourceScripts(source) {
    for (const oldScript of source.querySelectorAll("script")) {
      if (oldScript.src) {
        await loadExternalScript(new URL(oldScript.getAttribute("src"), sourceUrl).href);
        continue;
      }
      const script = document.createElement("script");
      let code = oldScript.textContent;
      // トップの検索導線だけは、スマホ用検索画面に向ける。
      if (page === "home") code = code.replace('const SEARCH_PAGE = "search.html";', 'const SEARCH_PAGE = "mobile/search.html";');
      script.text = code;
      document.body.append(script);
    }
  }

  async function start() {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      const content = [...source.body.children].filter(node => node.tagName !== "SCRIPT");
      document.body.replaceChildren(...content);
      document.body.className = `${source.body.className} mobile-page mobile-${page}`.trim();
      routeLinks();

      // 動的に追加される料理カードなどのリンクも、タップ時にはスマホ用画面へ向ける。
      document.addEventListener("click", event => {
        const link = event.target.closest?.("a[href]");
        const target = link && mobileUrl(link.getAttribute("href"));
        if (target) link.href = target;
      }, true);

      await runSourceScripts(source);
      routeLinks();
      document.body.classList.add("mobile-ready");
    } catch (error) {
      console.error(error);
      document.body.className = "mobile-page mobile-load-error";
      document.body.replaceChildren();
      const message = document.createElement("main");
      message.className = "mobile-load-error-message";
      const title = document.createElement("h1");
      title.textContent = "画面を準備できませんでした";
      const text = document.createElement("p");
      text.textContent = "Live Server などのローカルサーバーで開き、もう一度お試しください。";
      message.append(title, text);
      document.body.append(message);
    }
  }

  start();
})();
