(() => {
  const STORAGE_KEY = "vkMusicImporterState";
  const PANEL_ID = "vkmi-panel";
  const STYLE_READY_CLASS = "vkmi-ready";

  let state = {
    fileName: "",
    tracks: [],
    currentIndex: null,
    autoEnter: true,
    minimized: false
  };

  function normalizeLine(line) {
    return String(line || "").replace(/\r/g, "").trim();
  }

  function getSearchInput() {
    return document.querySelector('input[data-testid="search_audio_input"]');
  }

  function getClearButton() {
    return document.querySelector(".audio_search_wrapper .ui_search_reset_button");
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function saveState() {
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function loadState() {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      if (data && data[STORAGE_KEY]) {
        state = { ...state, ...data[STORAGE_KEY] };
      }
      createPanelIfNeeded();
      render();
    });
  }

  function parseFileText(text) {
    const lines = text
      .split("\n")
      .map(normalizeLine)
      .filter(Boolean);

    return lines.map((text, index) => ({
      id: `${Date.now()}_${index}`,
      text,
      status: "new"
    }));
  }

  function findResumeIndex(tracks) {
    for (let i = tracks.length - 1; i >= 0; i -= 1) {
      if (tracks[i].status === "done") {
        return i - 1;
      }
    }
    return tracks.length - 1;
  }

  async function setVkSearchValue(value) {
    const input = getSearchInput();
    if (!input) {
      showToast("Поле поиска ВК не найдено");
      return false;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;

    input.focus();

    const clearBtn = getClearButton();
    if (clearBtn) {
      clearBtn.click();
      await wait(80);
    } else {
      if (nativeSetter) {
        nativeSetter.call(input, "");
      } else {
        input.value = "";
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
    await wait(50);

    if (state.autoEnter) {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true
      }));
      input.dispatchEvent(new KeyboardEvent("keypress", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true
      }));
      input.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        which: 13,
        keyCode: 13,
        bubbles: true
      }));
    }

    return true;
  }

  function prepareTrackText(text) {
    return String(text || "")
      // убираем первый " - "
      .replace(/\s-\s/, " ")

      // убираем +
      .replace(/\+/g, " ")

      .replace(/\./g, " ")
      .replace(/\,/g, " ")
      .replace(/\&/g, " ")
      

      // убираем все виды скобок ((), [], {}, <>)
      .replace(/[\(\)\[\]\{\}<>]/g, " ")

      // убираем лишние пробелы
      .replace(/\s+/g, " ")

      .trim();
  }

  async function insertCurrentTrack() {
    const track = getCurrentTrack();
    if (!track) {
      render();
      return;
    }
    await setVkSearchValue(prepareTrackText(track.text));
    render();
  }

  function getCurrentTrack() {
    if (!state.tracks.length || state.currentIndex === null || state.currentIndex < 0) {
      return null;
    }
    return state.tracks[state.currentIndex] || null;
  }

  function getStats() {
    const done = state.tracks.filter(t => t.status === "done").length;
    const notFound = state.tracks.filter(t => t.status === "not_found").length;
    const fresh = state.tracks.filter(t => t.status === "new").length;
    return { done, notFound, fresh, total: state.tracks.length };
  }

  function setTrackStatus(index, status) {
    if (index < 0 || index >= state.tracks.length) return;
    state.tracks[index].status = status;
  }

  function moveToPreviousTrack() {
    if (state.currentIndex === null) return;
    state.currentIndex -= 1;
    if (state.currentIndex < 0) {
      state.currentIndex = -1;
    }
  }

  function moveToNextTrack() {
    if (state.currentIndex === null) return;
    if (state.currentIndex < state.tracks.length - 1) {
      state.currentIndex += 1;
    }
  }

  async function markDoneAndNext() {
    const track = getCurrentTrack();
    if (!track) {
      showToast("Больше треков нет");
      return;
    }

    setTrackStatus(state.currentIndex, "done");
    moveToPreviousTrack();
    saveState();
    render();

    if (state.currentIndex >= 0) {
      await insertCurrentTrack();
    } else {
      showToast("Готово, список закончился");
    }
  }

  async function markNotFoundAndNext() {
    const track = getCurrentTrack();
    if (!track) {
      showToast("Больше треков нет");
      return;
    }

    setTrackStatus(state.currentIndex, "not_found");
    moveToPreviousTrack();
    saveState();
    render();

    if (state.currentIndex >= 0) {
      await insertCurrentTrack();
    } else {
      showToast("Готово, список закончился");
    }
  }

  async function goBack() {
    if (!state.tracks.length) return;

    if (state.currentIndex === -1) {
      state.currentIndex = 0;
    } else {
      moveToNextTrack();
    }

    if (state.currentIndex >= state.tracks.length) {
      state.currentIndex = state.tracks.length - 1;
    }

    saveState();
    render();
    await insertCurrentTrack();
  }

  function exportResults() {
    if (!state.tracks.length) {
      showToast("Нет данных для экспорта");
      return;
    }

    const output = state.tracks
      .map(track => `[${track.status}] ${track.text}`)
      .join("\n");

    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (state.fileName || "vk_tracks")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^\wа-яА-ЯёЁ.\- ]/g, "_");

    a.href = url;
    a.download = `${safeName}_result.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetState() {
    if (!confirm("Сбросить загруженный список и прогресс?")) return;

    state = {
      fileName: "",
      tracks: [],
      currentIndex: null,
      autoEnter: true,
      minimized: false
    };

    saveState();
    render();
    showToast("Прогресс сброшен");
  }

  function formatCurrentPosition() {
    if (!state.tracks.length) return "0 / 0";
    if (state.currentIndex === -1) return `${state.tracks.length} / ${state.tracks.length}`;
    return `${state.tracks.length - state.currentIndex} / ${state.tracks.length}`;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.classList.toggle("vkmi-minimized", !!state.minimized);

    const currentTrack = getCurrentTrack();
    const stats = getStats();

    panel.querySelector(".vkmi-file-name").textContent =
      state.fileName || "Файл не загружен";

    panel.querySelector(".vkmi-counter").textContent = formatCurrentPosition();

    panel.querySelector(".vkmi-current-track").innerHTML = currentTrack
      ? escapeHtml(currentTrack.text)
      : (state.tracks.length ? "Список завершён" : "Загрузи txt со строками вида Исполнитель - Трек");

    panel.querySelector(".vkmi-stats").textContent =
      `done: ${stats.done} · not_found: ${stats.notFound} · new: ${stats.fresh}`;

    panel.querySelector(".vkmi-auto-enter").checked = !!state.autoEnter;

    panel.querySelector(".vkmi-btn-prev").disabled = !state.tracks.length;
    panel.querySelector(".vkmi-btn-next").disabled = !currentTrack;
    panel.querySelector(".vkmi-btn-not-found").disabled = !currentTrack;
    panel.querySelector(".vkmi-btn-insert").disabled = !currentTrack;
    panel.querySelector(".vkmi-btn-export").disabled = !state.tracks.length;
  }

  function showToast(message) {
    let toast = document.querySelector(".vkmi-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "vkmi-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("vkmi-toast-show");

    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove("vkmi-toast-show");
    }, 1800);
  }

  function bindPanelEvents(panel) {
    panel.querySelector(".vkmi-file-input").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      const tracks = parseFileText(text);

      state.fileName = file.name;
      state.tracks = tracks;
      state.currentIndex = findResumeIndex(tracks);
      if (state.currentIndex < 0 && tracks.length) {
        state.currentIndex = tracks.length - 1;
      }

      saveState();
      render();
      await insertCurrentTrack();
      showToast(`Загружено: ${tracks.length}`);
      event.target.value = "";
    });

    panel.querySelector(".vkmi-btn-next").addEventListener("click", markDoneAndNext);
    panel.querySelector(".vkmi-btn-prev").addEventListener("click", goBack);
    panel.querySelector(".vkmi-btn-not-found").addEventListener("click", markNotFoundAndNext);
    panel.querySelector(".vkmi-btn-export").addEventListener("click", exportResults);
    panel.querySelector(".vkmi-btn-reset").addEventListener("click", resetState);
    panel.querySelector(".vkmi-btn-insert").addEventListener("click", insertCurrentTrack);
    panel.querySelector(".vkmi-btn-notfound-export").addEventListener("click", exportNotFound);

    panel.querySelector(".vkmi-auto-enter").addEventListener("change", (event) => {
      state.autoEnter = !!event.target.checked;
      saveState();
      render();
    });

    panel.querySelector(".vkmi-toggle").addEventListener("click", () => {
      state.minimized = !state.minimized;
      saveState();
      render();
    });
  }
  function exportNotFound() {
    const output = state.tracks
      .filter(track => track.status === "not_found")
      .map(track => track.text)
      .join("\n");

    const blob = new Blob([output], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "not_found_tracks.txt";

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function createPanelIfNeeded() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = STYLE_READY_CLASS;
    panel.innerHTML = `
      <div class="vkmi-head">
        <div>
          <div class="vkmi-title">VK Music Importer</div>
          <div class="vkmi-file-name">Файл не загружен</div>
        </div>
        <button class="vkmi-toggle" type="button" title="Свернуть">—</button>
      </div>

      <div class="vkmi-body">
        <label class="vkmi-upload">
          <input class="vkmi-file-input" type="file" accept=".txt">
          <span>Загрузить txt</span>
        </label>

        <div class="vkmi-block">
          <div class="vkmi-label">Текущий трек</div>
          <div class="vkmi-current-track">Загрузи txt со строками вида Исполнитель - Трек</div>
        </div>

        <div class="vkmi-row">
          <div class="vkmi-chip">
            <span class="vkmi-chip-label">Прогресс</span>
            <span class="vkmi-counter">0 / 0</span>
          </div>
        </div>

        <div class="vkmi-stats">done: 0 · not_found: 0 · new: 0</div>

        <label class="vkmi-checkbox-row">
          <input class="vkmi-auto-enter" type="checkbox" checked>
          <span>Авто-Enter после вставки</span>
        </label>

        <div class="vkmi-grid">
          <button class="vkmi-btn vkmi-btn-secondary vkmi-btn-prev" type="button">← Назад</button>
          <button class="vkmi-btn vkmi-btn-primary vkmi-btn-next" type="button">Следующий</button>
          <button class="vkmi-btn vkmi-btn-danger vkmi-btn-not-found" type="button">Не найдено</button>
          <button class="vkmi-btn vkmi-btn-secondary vkmi-btn-insert" type="button">Вставить снова</button>
        </div>

        <div class="vkmi-grid vkmi-grid-bottom">
          <button class="vkmi-btn vkmi-btn-secondary vkmi-btn-export" type="button">Экспорт</button>
          <button class="vkmi-btn vkmi-btn-secondary vkmi-btn-reset" type="button">Сброс</button>
          <button class="vkmi-btn vkmi-btn-secondary vkmi-btn-notfound-export" type="button">
            Export not_found
          </button>
        </div>

        <div class="vkmi-help">
          Горячие клавиши: <b>Alt + Z</b> — следующий, <b>Alt + X</b> — назад, <b>Alt + V</b> — не найдено, <b>Alt + C</b> — вставить снова
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    bindPanelEvents(panel);
  }

  document.addEventListener("keydown", async (event) => {
    const tag = document.activeElement?.tagName?.toLowerCase();

    if (!event.altKey) return;

    if (event.code === "KeyZ") {
      event.preventDefault();
      await markDoneAndNext();
    } else if (event.code === "KeyX") {
      event.preventDefault();
      await goBack();
    } else if (event.code === "KeyV") {
      event.preventDefault();
      await markNotFoundAndNext();
    } else if (event.code === "KeyC") {
      event.preventDefault();
      await insertCurrentTrack();
    }
  });

  const observer = new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID)) {
      createPanelIfNeeded();
      render();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  loadState();
})();