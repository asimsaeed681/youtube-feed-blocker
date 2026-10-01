/**
 * Productivity widget set for the "widgets" feed mode:
 *   - to-do list  (persisted in chrome.storage.local)
 *   - quote       (rotates daily from YFB.QUOTES)
 *
 * Exposes YFB.Widgets.render(container, settings). The container is owned by
 * feed-replacer.js; this module only fills it.
 */
(function () {
  "use strict";

  const YFB = window.YFB;
  const LOCAL_KEY = "yfb_widget_data";

  // --- local storage helpers (todo items live here, not in sync) ----------
  function loadData() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(LOCAL_KEY, (res) => {
          resolve((res && res[LOCAL_KEY]) || { todos: [] });
        });
      } catch (e) {
        resolve({ todos: [] });
      }
    });
  }
  function saveData(data) {
    try {
      chrome.storage.local.set({ [LOCAL_KEY]: data });
    } catch (e) {
      /* ignore */
    }
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // --- to-do widget ------------------------------------------------------
  async function buildTodo() {
    const card = el("section", "yfb-widget yfb-widget--todo");
    card.appendChild(el("h2", "yfb-widget__title", "To-do"));

    const list = el("ul", "yfb-todo__list");
    card.appendChild(list);

    const data = await loadData();
    data.todos = Array.isArray(data.todos) ? data.todos : [];

    function persist() {
      saveData(data);
    }

    function renderItem(item, index) {
      const li = el("li", "yfb-todo__item" + (item.done ? " is-done" : ""));

      const cb = el("input", "yfb-todo__check");
      cb.type = "checkbox";
      cb.checked = !!item.done;
      cb.addEventListener("change", () => {
        item.done = cb.checked;
        li.classList.toggle("is-done", cb.checked);
        persist();
      });

      const label = el("span", "yfb-todo__text", item.text);

      const del = el("button", "yfb-todo__del", "×");
      del.type = "button";
      del.title = "Delete";
      del.addEventListener("click", () => {
        data.todos.splice(index, 1);
        persist();
        redraw();
      });

      li.append(cb, label, del);
      return li;
    }

    function redraw() {
      list.textContent = "";
      data.todos.forEach((item, i) => list.appendChild(renderItem(item, i)));
      if (data.todos.length === 0) {
        list.appendChild(el("li", "yfb-todo__empty", "Nothing yet. Add something below."));
      }
    }
    redraw();

    const form = el("form", "yfb-todo__form");
    const input = el("input", "yfb-todo__input");
    input.type = "text";
    input.placeholder = "Add a task and press Enter";
    input.maxLength = 200;
    form.appendChild(input);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      data.todos.push({ text, done: false });
      persist();
      input.value = "";
      redraw();
    });
    card.appendChild(form);

    return card;
  }

  // --- quote widget --------------------------------------------------
  function buildQuote() {
    const card = el("section", "yfb-widget yfb-widget--quote");
    const quotes = YFB.QUOTES;
    const dayIndex = Math.floor(Date.now() / 86400000) % quotes.length;
    const q = quotes[dayIndex];
    const block = el("blockquote", "yfb-quote__text", q.text);
    const by = el("cite", "yfb-quote__by", q.by);
    card.append(block, by);
    return card;
  }

  // --- public API --------------------------------------------------
  YFB.Widgets = {
    async render(container, settings) {
      container.textContent = "";
      const w = settings.widgets || {};
      const grid = el("div", "yfb-widgets__grid");
      container.appendChild(grid);

      if (w.quote) grid.appendChild(buildQuote());
      if (w.todo) grid.appendChild(await buildTodo());

      if (!w.quote && !w.todo) {
        grid.appendChild(
          el("p", "yfb-widgets__none", "All widgets are turned off in the popup.")
        );
      }
    },
    teardown(container) {
      container
        .querySelectorAll(".yfb-widget")
        .forEach((n) => n.dispatchEvent(new CustomEvent("yfb:teardown")));
    },
  };
})();
