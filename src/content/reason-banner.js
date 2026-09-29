/**
 * "You came for" reminder.
 *
 * After a "reason" peek, feed-replacer.js calls YFB.setReason(text). The reason
 * is shown in a small banner on every YouTube page in this tab until the user
 * closes it.
 *
 * The reason is kept in this content script's memory, not in sessionStorage:
 * page storage is readable by YouTube's own scripts, and the reason is the
 * user's private note. Memory survives YouTube's client-side navigation, which
 * is how YouTube moves between pages; a full reload clears it.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const BANNER_ID = "yfb-reason-banner";
  let reason = "";

  function render() {
    let bar = document.getElementById(BANNER_ID);
    if (!reason) {
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
      close.addEventListener("click", () => YFB.setReason(""));

      bar.append(text, close);
      document.body.appendChild(bar);
    }
    // textContent, never innerHTML: the reason is user-typed text.
    bar.querySelector(".yfb-reason__text").textContent = "You came for: " + reason;
  }

  YFB.setReason = function setReason(value) {
    reason = typeof value === "string" ? value.trim() : "";
    render();
  };

  YFB.getReason = function getReason() {
    return reason;
  };
})();
