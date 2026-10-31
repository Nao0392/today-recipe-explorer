/* モバイル版の画面間を移動する共通フッター。PC版には読み込まれない。 */
(() => {
  "use strict";

  const pages = [
    { file: "index.html", label: "ホーム", icon: "⌂" },
    { file: "search.html", label: "探す", icon: "⌕" },
    { file: "favorites.html", label: "お気に入り", icon: "♡" },
    { file: "map.html", label: "類似マップ", icon: "◌" },
  ];

  function addTabbar() {
    if (!document.body.classList.contains("mobile-ready") || document.querySelector(".mobile-tabbar")) return;
    const current = location.pathname.split("/").pop() || "index.html";
    const nav = document.createElement("nav");
    nav.className = "mobile-tabbar";
    nav.setAttribute("aria-label", "メインメニュー");
    nav.innerHTML = pages.map(page => `
      <a href="mobile/${page.file}"${page.file === current ? ' aria-current="page"' : ""}>
        <span class="mobile-tabbar-icon" aria-hidden="true">${page.icon}</span>
        <span>${page.label}</span>
      </a>`).join("");
    document.body.append(nav);
  }

  window.addEventListener("mobile:ready", addTabbar);
  addTabbar();
})();
