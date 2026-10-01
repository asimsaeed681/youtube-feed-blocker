/**
 * "You came for" reminder.
 *
 * Shown on every YouTube page in every tab while a peek with a reason is
 * running, until the user closes it. The reason comes from the shared peek
 * session (chrome.storage.session), which YouTube's page scripts cannot read.
 * The banner itself is in YouTube's page, so the reason is visible on screen
 * there; it is never saved or sent anywhere by the extension.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const BANNER_ID = "yfb-reason-banner";
  let session = null;

  function shouldShow() {
    return (
      YFB.peekRemainingMs(session, Date.now()) > 0 &&
      !!session.reason &&
      !session.bannerClosed
    );
  }

  function render() {
    let bar = document.getElementById(BANNER_ID);
    if (!shouldShow()) {
      if (bar) bar.remove();
      return;
    }
    if (!document.body) {
      requestAnimationFrame(render);
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BANNER_ID;
      bar.setAttribute("role", "status");

      const text = document.createElement("span");
      text.className = "yfb-reason__text";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "yfb-reason__close";
      close.setAttribute("aria-label", "Close reminder");
      close.textContent = "×";
      close.addEventListener("click", () => {
        bar.remove();
        YFB.PeekSession.closeBanner();
      });

      bar.append(text, close);
      document.body.appendChild(bar);
    }
    // textContent, never innerHTML: the reason is user-typed text.
    bar.querySelector(".yfb-reason__text").textContent = "You came for: " + session.reason;
  }

  YFB.PeekSession.get().then((s) => {
    session = s;
    render();
  });
  YFB.PeekSession.onChange((s) => {
    session = s;
    render();
  });
})();
