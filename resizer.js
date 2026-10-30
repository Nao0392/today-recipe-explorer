// resizer.js — 検索・詳細パネルの幅変更と保存
(() => {
  const root = document.documentElement;
  const body = document.body;
  let drawFrame = 0;

  const scheduleRefresh = () => {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      window.dispatchEvent(new Event("resize"));
    });
  };

  function stored(key) {
    try { return Number(localStorage.getItem(key)); } catch { return NaN; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* 保存不可でも操作は続ける */ }
  }

  function makeResizer({ id, variable, storageKey, initial, min, max, delta, enabled }) {
    const handle = document.getElementById(id);
    const maximum = () => Math.max(min, max());
    const limit = value => Math.max(min, Math.min(maximum(), value));
    const current = () => Number.parseFloat(getComputedStyle(root).getPropertyValue(variable)) || initial;
    const updateAria = value => {
      handle.setAttribute("aria-valuemin", String(min));
      handle.setAttribute("aria-valuemax", String(maximum()));
      handle.setAttribute("aria-valuenow", String(Math.round(value)));
    };
    const set = (value, persist = true) => {
      const width = limit(value);
      root.style.setProperty(variable, `${width}px`);
      updateAria(width);
      if (persist) save(storageKey, width);
      scheduleRefresh();
    };

    const saved = stored(storageKey);
    set(Number.isFinite(saved) ? saved : initial, false);

    let pointerId = null;
    let startX = 0;
    let startWidth = 0;
    const finish = () => {
      if (pointerId === null) return;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      pointerId = null;
      handle.classList.remove("is-resizing");
      body.classList.remove("is-resizing");
    };

    handle.addEventListener("pointerdown", event => {
      if (!enabled()) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = current();
      handle.setPointerCapture(pointerId);
      handle.classList.add("is-resizing");
      body.classList.add("is-resizing");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      set(startWidth + (event.clientX - startX) * delta);
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", () => { if (enabled()) set(initial); });
    handle.addEventListener("keydown", event => {
      if (!enabled() || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      set(current() + (event.key === "ArrowRight" ? 16 : -16));
    });
    window.addEventListener("resize", () => {
      const width = limit(current());
      root.style.setProperty(variable, `${width}px`);
      updateAria(width);
    });
  }

  makeResizer({
    id: "controls-resizer", variable: "--controls-w", storageKey: "recipe-controls-width",
    initial: 340, min: 260, max: () => Math.min(window.innerWidth * .5, 600), delta: 1,
    enabled: () => window.innerWidth > 900,
  });
  makeResizer({
    id: "detail-resizer", variable: "--detail-w", storageKey: "recipe-detail-width",
    initial: 440, min: 320, max: () => Math.min(window.innerWidth * .8, 900), delta: -1,
    enabled: () => window.innerWidth > 600 && document.getElementById("detail").classList.contains("open"),
  });
})();
