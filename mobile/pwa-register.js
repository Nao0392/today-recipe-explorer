/* PWAの登録・更新通知・Android系ブラウザのインストール導線。 */
(() => {
  "use strict";
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  let deferredInstallPrompt = null;
  let reloadingForUpdate = false;

  function showNotice({ message, action, onAction }) {
    let notice = document.querySelector(".pwa-notice");
    if (!notice) {
      notice = document.createElement("aside");
      notice.className = "pwa-notice";
      notice.setAttribute("role", "status");
      document.body.append(notice);
    }
    notice.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    notice.append(text);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action;
      button.addEventListener("click", onAction, { once: true });
      notice.append(button);
    }
    notice.hidden = false;
    return notice;
  }

  function hideNotice() {
    document.querySelector(".pwa-notice")?.setAttribute("hidden", "");
  }

  function offerInstall() {
    if (!deferredInstallPrompt || window.matchMedia("(display-mode: standalone)").matches) return;
    showNotice({
      message: "ホーム画面に追加すると、アプリのように開けます。",
      action: "追加する",
      onAction: async () => {
        const prompt = deferredInstallPrompt;
        deferredInstallPrompt = null;
        hideNotice();
        await prompt.prompt();
      }
    });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    offerInstall();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideNotice();
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadingForUpdate) return;
    window.location.reload();
  });

  navigator.serviceWorker.register("mobile/service-worker.js", { scope: "mobile/" })
    .then(registration => {
      const offerUpdate = worker => {
        if (!worker || !navigator.serviceWorker.controller) return;
        showNotice({
          message: "新しいバージョンがあります。",
          action: "更新する",
          onAction: () => {
            reloadingForUpdate = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      };
      offerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") offerUpdate(worker);
        });
      });
    })
    .catch(error => console.warn("PWAの準備に失敗しました:", error));
})();
