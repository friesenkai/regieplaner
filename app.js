const STORAGE_KEY = "regieplan-livestream-v1";
const taskColors = ["default", "blue", "green", "yellow", "orange", "pink", "violet"];
const taskColorLabels = {
  default: "Weiß",
  blue: "Blau",
  green: "Grün",
  yellow: "Gelb",
  orange: "Orange",
  pink: "Rosa",
  violet: "Violett"
};
const starterTasks = [
  { id: "welcome", title: "Begrüßung & Stream-Start" },
  { id: "intro", title: "Thema und Ablauf vorstellen" },
  { id: "main", title: "Hauptteil: erste Gesprächsrunde" },
  { id: "chat", title: "Fragen aus dem Chat beantworten" },
  { id: "outro", title: "Zusammenfassung & Verabschiedung" }
];

const elements = {
  workspace: document.querySelector(".workspace"),
  list: document.querySelector("#task-list"),
  historyList: document.querySelector("#history-list"),
  history: document.querySelector("#history"),
  historyLabel: document.querySelector("#history-label"),
  count: document.querySelector("#task-count"),
  form: document.querySelector("#add-form"),
  input: document.querySelector("#task-input"),
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  transferStatus: document.querySelector("#transfer-status"),
  systemClock: document.querySelector("#system-clock"),
  showName: document.querySelector("#page-title"),
  modeButton: document.querySelector("#mode-button"),
  sidePanel: document.querySelector(".side-panel"),
  transferActions: document.querySelector(".transfer-actions"),
  storageNote: document.querySelector(".storage-note")
};

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.pending) && Array.isArray(stored.completed)) return stored;
  } catch (error) {
    console.warn("Der gespeicherte Regieplan konnte nicht geladen werden.", error);
  }
  return { pending: [...starterTasks], completed: [] };
}

let state = loadState();
state.showName = typeof state.showName === "string" ? state.showName : "";
state.mode = state.mode === "live" ? "live" : "edit";
elements.showName.value = state.showName;
for (const task of [...state.pending, ...state.completed]) {
  task.scheduleEnabled = task.scheduleEnabled === true;
  task.scheduledTime = normalizeClockTime(task.scheduledTime);
  task.scheduleTriggered = task.scheduleTriggered === true;
  task.planNumber = Number.isInteger(task.planNumber) && task.planNumber > 0 ? task.planNumber : null;
  task.color = taskColors.includes(task.color) ? task.color : "default";
  task.note = typeof task.note === "string" ? task.note.slice(0, 1000) : "";
  task.vmixEnabled = task.vmixEnabled === true;
  task.vmixUrl = typeof task.vmixUrl === "string" ? task.vmixUrl.slice(0, 2048) : "";
  task.vmixTriggered = task.vmixTriggered === true;
}
delete state.schedule;
let draggedTaskId = null;
let editingScheduledTaskId = null;
const vmixRequestStatus = new Map();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Der Regieplan konnte nicht gespeichert werden.", error);
  }
}

function makeTaskCard(task, index, completed = false) {
  const card = document.createElement("article");
  const isCurrent = index === 0 && !completed && state.mode === "live";
  card.className = `task-card${isCurrent ? " current" : ""}${completed ? " completed" : ""}${!completed && state.mode === "edit" ? " editing" : ""} color-${task.color}`;
  card.dataset.taskId = task.id;
  if (!completed && state.mode === "edit") {
    card.draggable = true;
    card.title = "Zum Sortieren ziehen";
  }

  const canEditPosition = !completed && state.mode === "edit";
  const number = document.createElement(canEditPosition ? "button" : "div");
  number.className = `task-index${canEditPosition ? " task-index-button" : ""}${task.vmixEnabled ? " vmix-enabled" : ""}`;
  number.textContent = completed ? "✓" : String(state.mode === "live" ? task.planNumber ?? index + 1 : index + 1).padStart(2, "0");
  if (canEditPosition) {
    number.type = "button";
    number.title = "Position im Ablauf ändern";
    number.setAttribute("aria-label", `Position von „${task.title}“ ändern`);
    number.addEventListener("click", () => {
      const positionInput = document.createElement("input");
      positionInput.className = "task-position-input";
      positionInput.type = "number";
      positionInput.min = "1";
      positionInput.max = String(state.pending.length);
      positionInput.step = "1";
      positionInput.required = true;
      positionInput.value = String(index + 1);
      positionInput.setAttribute("aria-label", `Neue Position für „${task.title}“ (1 bis ${state.pending.length})`);
      const commitPosition = () => {
        const position = Number(positionInput.value);
        if (!positionInput.validity.valid || !Number.isInteger(position)) {
          render();
          return;
        }
        moveTaskToPosition(task.id, position);
      };
      positionInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (positionInput.reportValidity()) commitPosition();
        } else if (event.key === "Escape") {
          render();
        }
      });
      positionInput.addEventListener("blur", commitPosition);
      number.replaceWith(positionInput);
      positionInput.focus();
      positionInput.select();
    });
  } else {
    number.setAttribute("aria-hidden", "true");
  }

  const copy = document.createElement("div");
  copy.className = "task-copy";
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  copy.append(title);

  const note = document.createElement("p");
  note.className = "task-note";
  note.textContent = task.note;
  note.hidden = !task.note || (state.mode !== "live" && !completed);
  copy.append(note);

  const scheduledTime = document.createElement("div");
  scheduledTime.className = "scheduled-time-display";
  scheduledTime.textContent = task.scheduleEnabled && isValidClockTime(task.scheduledTime)
    ? formatClockTime(task.scheduledTime)
    : "";
  if (isCurrent && task.vmixEnabled) {
    const vmixStatus = document.createElement("div");
    vmixStatus.className = "vmix-status";
    vmixStatus.textContent = vmixRequestStatus.get(task.id) || "";
    copy.append(vmixStatus);
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";
  if (!completed && state.mode === "edit") {
    const titleInput = document.createElement("input");
    titleInput.className = "task-title-input";
    titleInput.type = "text";
    titleInput.maxLength = 120;
    titleInput.value = task.title;
    titleInput.hidden = true;
    titleInput.setAttribute("aria-label", `Aufgabenname ändern: ${task.title}`);
    titleInput.addEventListener("input", () => {
      const newTitle = titleInput.value.trim();
      if (!newTitle) return;
      task.title = newTitle;
      title.textContent = newTitle;
      saveState();
    });
    titleInput.addEventListener("blur", () => {
      const newTitle = titleInput.value.trim();
      if (newTitle) task.title = newTitle;
      title.textContent = task.title;
      title.hidden = false;
      titleInput.hidden = true;
      saveState();
    });
    const rename = document.createElement("button");
    rename.className = "icon-button";
    rename.type = "button";
    rename.title = "Aufgabe umbenennen";
    rename.setAttribute("aria-label", `Aufgabe „${task.title}“ umbenennen`);
    rename.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/></svg>';
    rename.addEventListener("click", () => {
      title.hidden = true;
      titleInput.hidden = false;
      rename.hidden = true;
      titleInput.focus();
      titleInput.select();
    });
    copy.append(titleInput);
    actions.append(rename);

    const editDetails = document.createElement("div");
    editDetails.className = "task-edit-details";
    const noteInput = document.createElement("textarea");
    noteInput.className = "task-note-input";
    noteInput.maxLength = 1000;
    noteInput.placeholder = "Notiz für die Live-Anzeige";
    noteInput.value = task.note;
    noteInput.setAttribute("aria-label", `Notiz zu „${task.title}“`);
    noteInput.addEventListener("input", () => {
      task.note = noteInput.value;
      note.textContent = task.note;
      note.hidden = !task.note || state.mode !== "live";
      saveState();
    });

    const colorLabel = document.createElement("label");
    colorLabel.className = "task-color-control";
    colorLabel.append(document.createTextNode("Kartenfarbe"));
    const colorSelect = document.createElement("select");
    colorSelect.className = "task-color-select";
    colorSelect.setAttribute("aria-label", `Kartenfarbe für „${task.title}“`);
    taskColors.forEach((color) => {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = taskColorLabels[color];
      option.selected = task.color === color;
      colorSelect.append(option);
    });
    colorSelect.addEventListener("change", () => {
      task.color = colorSelect.value;
      taskColors.forEach((color) => card.classList.remove(`color-${color}`));
      card.classList.add(`color-${task.color}`);
      saveState();
    });
    colorLabel.append(colorSelect);
    editDetails.append(noteInput, colorLabel);

    const vmixControl = document.createElement("div");
    vmixControl.className = "vmix-control";
    const vmixLabel = document.createElement("label");
    vmixLabel.className = "vmix-enable";
    const vmixCheckbox = document.createElement("input");
    vmixCheckbox.className = "vmix-checkbox";
    vmixCheckbox.type = "checkbox";
    vmixCheckbox.checked = task.vmixEnabled;
    vmixCheckbox.setAttribute("aria-label", `vMix-Befehl für „${task.title}“ aktivieren`);
    const vmixLabelText = document.createElement("span");
    vmixLabelText.textContent = "vMix-Befehl beim Aktivieren ausführen";
    vmixLabel.append(vmixCheckbox, vmixLabelText);
    const vmixUrlInput = document.createElement("input");
    vmixUrlInput.className = "vmix-url";
    vmixUrlInput.type = "url";
    vmixUrlInput.maxLength = 2048;
    vmixUrlInput.placeholder = "http://192.168.1.20:8088/api/?Function=...";
    vmixUrlInput.value = task.vmixUrl;
    vmixUrlInput.hidden = !task.vmixEnabled;
    vmixUrlInput.autocomplete = "off";
    vmixUrlInput.spellcheck = false;
    vmixUrlInput.setAttribute("aria-label", `vMix-API-Link für „${task.title}“`);
    const vmixHelp = document.createElement("span");
    vmixHelp.className = "task-color-control";
    vmixHelp.textContent = "Wird einmal beim Aktivieren im Live-Modus in diesem Tab geöffnet.";
    vmixCheckbox.addEventListener("change", () => {
      task.vmixEnabled = vmixCheckbox.checked;
      task.vmixTriggered = false;
      vmixUrlInput.hidden = !task.vmixEnabled;
      saveState();
      if (task.vmixEnabled) vmixUrlInput.focus();
    });
    vmixUrlInput.addEventListener("input", () => {
      task.vmixUrl = vmixUrlInput.value.trim();
      task.vmixTriggered = false;
      saveState();
    });
    vmixControl.append(vmixLabel, vmixUrlInput, vmixHelp);
    editDetails.append(vmixControl);
    copy.append(editDetails);

    const scheduleLabel = document.createElement("label");
    scheduleLabel.className = "schedule-control";
    const scheduleCheckbox = document.createElement("input");
    scheduleCheckbox.className = "schedule-checkbox";
    scheduleCheckbox.type = "checkbox";
    scheduleCheckbox.checked = task.scheduleEnabled;
    scheduleCheckbox.setAttribute("aria-label", `Uhrzeit für „${task.title}“ aktivieren`);
    const scheduleText = document.createElement("span");
    scheduleText.textContent = "Uhrzeit";
    const timeInput = document.createElement("input");
    timeInput.className = "schedule-time";
    timeInput.type = "time";
    timeInput.step = "1";
    timeInput.value = task.scheduledTime;
    timeInput.hidden = !task.scheduleEnabled;
    timeInput.setAttribute("aria-label", `Startzeit für „${task.title}“`);
    scheduleCheckbox.addEventListener("change", () => {
      const currentTask = state.pending.find((item) => item.id === task.id);
      if (!currentTask) return;
      currentTask.scheduleEnabled = scheduleCheckbox.checked;
      currentTask.scheduleTriggered = false;
      saveState();
      render();
      processScheduledTasks();
    });
    timeInput.addEventListener("focus", () => {
      editingScheduledTaskId = task.id;
    });
    timeInput.addEventListener("input", () => {
      editingScheduledTaskId = task.id;
    });
    timeInput.addEventListener("blur", () => {
      const currentTask = state.pending.find((item) => item.id === task.id);
      if (!currentTask) return;
      currentTask.scheduledTime = normalizeClockTime(timeInput.value);
      currentTask.scheduleTriggered = false;
      editingScheduledTaskId = null;
      saveState();
      render();
      processScheduledTasks();
    });
    scheduleLabel.append(scheduleCheckbox, scheduleText);
    const scheduleControls = document.createElement("div");
    scheduleControls.className = "task-schedule-controls";
    scheduleControls.append(scheduleLabel, timeInput);
    actions.append(scheduleControls);

    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    dragHandle.title = "Ziehen, um die Aufgabe zu sortieren";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.innerHTML = '<svg viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="9" r="1.2"/><circle cx="9" cy="9" r="1.2"/><circle cx="3" cy="15" r="1.2"/><circle cx="9" cy="15" r="1.2"/></svg>';
    actions.append(dragHandle);

    const moveUp = document.createElement("button");
    moveUp.className = "icon-button";
    moveUp.type = "button";
    moveUp.disabled = index === 0;
    moveUp.title = "Aufgabe nach oben verschieben";
    moveUp.setAttribute("aria-label", `Aufgabe „${task.title}“ nach oben verschieben`);
    moveUp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
    moveUp.addEventListener("click", () => moveTask(task.id, -1));
    const moveDown = document.createElement("button");
    moveDown.className = "icon-button";
    moveDown.type = "button";
    moveDown.disabled = index === state.pending.length - 1;
    moveDown.title = "Aufgabe nach unten verschieben";
    moveDown.setAttribute("aria-label", `Aufgabe „${task.title}“ nach unten verschieben`);
    moveDown.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>';
    moveDown.addEventListener("click", () => moveTask(task.id, 1));
    actions.append(moveUp, moveDown);

    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.type = "button";
    remove.setAttribute("aria-label", `Aufgabe „${task.title}“ entfernen`);
    remove.title = "Aufgabe entfernen";
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener("click", () => {
      state.pending = state.pending.filter((item) => item.id !== task.id);
      saveState();
      render();
    });
    actions.append(remove);
  } else if (completed && state.mode === "edit") {
    const restore = document.createElement("button");
    restore.className = "icon-button";
    restore.type = "button";
    restore.title = "Aufgabe wieder in den Ablauf aufnehmen";
    restore.setAttribute("aria-label", `Aufgabe „${task.title}“ wieder in den Ablauf aufnehmen`);
    restore.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>';
    restore.addEventListener("click", () => {
      const [restored] = state.completed.splice(index, 1);
      restored.vmixTriggered = false;
      state.pending.unshift(restored);
      saveState();
      render();
    });
    actions.append(restore);
  }

  if (!completed) {
    const complete = document.createElement("button");
    complete.className = "icon-button complete-button";
    complete.type = "button";
    complete.title = "Als erledigt markieren";
    complete.setAttribute("aria-label", `Aufgabe „${task.title}“ als erledigt markieren`);
    complete.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
    complete.addEventListener("click", () => completeTask(task.id));
    actions.append(complete);
  }

  card.append(number, copy, scheduledTime, actions);
  if (!completed && state.mode === "edit") {
    card.addEventListener("dragstart", (event) => {
      draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      const sourceIndex = state.pending.findIndex((item) => item.id === draggedTaskId);
      const targetIndex = state.pending.findIndex((item) => item.id === task.id);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        clearDragPreview();
        return;
      }

      clearDragPreview();
      const rect = card.getBoundingClientRect();
      const insertAfter = event.clientY > rect.top + rect.height / 2;
      const insertionIndex = targetIndex + (insertAfter ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
      card.classList.add("drop-target", insertAfter ? "drop-after" : "drop-before");
      state.pending.forEach((item, index) => {
        const previewCard = elements.list.children[index];
        if (!previewCard) return;
        if (insertionIndex > sourceIndex && index > sourceIndex && index <= insertionIndex) {
          previewCard.classList.add("shift-up");
        } else if (insertionIndex < sourceIndex && index >= insertionIndex && index < sourceIndex) {
          previewCard.classList.add("shift-down");
        }
      });
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = draggedTaskId || event.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === task.id) return;
      const sourceIndex = state.pending.findIndex((item) => item.id === sourceId);
      const targetIndex = state.pending.findIndex((item) => item.id === task.id);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [moved] = state.pending.splice(sourceIndex, 1);
      const rect = card.getBoundingClientRect();
      const insertAfter = event.clientY > rect.top + rect.height / 2;
      const insertionIndex = targetIndex + (insertAfter ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
      state.pending.splice(insertionIndex, 0, moved);
      draggedTaskId = null;
      saveState();
      render();
    });
    card.addEventListener("dragend", () => {
      draggedTaskId = null;
      clearDragPreview();
      card.classList.remove("dragging");
    });
  }
  return card;
}

function clearDragPreview() {
  elements.list.querySelectorAll(".drop-target, .drop-before, .drop-after, .shift-up, .shift-down").forEach((card) => {
    card.classList.remove("drop-target", "drop-before", "drop-after", "shift-up", "shift-down");
  });
}

function moveTask(taskId, offset) {
  const sourceIndex = state.pending.findIndex((task) => task.id === taskId);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= state.pending.length) return;
  const [task] = state.pending.splice(sourceIndex, 1);
  state.pending.splice(targetIndex, 0, task);
  saveState();
  render();
}

function moveTaskToPosition(taskId, position) {
  const sourceIndex = state.pending.findIndex((task) => task.id === taskId);
  if (sourceIndex < 0 || !Number.isInteger(position) || position < 1 || position > state.pending.length) return;
  const targetIndex = position - 1;
  if (sourceIndex === targetIndex) {
    render();
    return;
  }
  const [task] = state.pending.splice(sourceIndex, 1);
  state.pending.splice(targetIndex, 0, task);
  saveState();
  render();
}

function completeTask(taskId) {
  const taskIndex = state.pending.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) return;
  const [task] = state.pending.splice(taskIndex, 1);
  state.completed.unshift(task);
  saveState();
  render();
  activateCurrentTask();
}

function render() {
  elements.list.replaceChildren();
  if (state.pending.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.completed.length
      ? "Der Ablauf ist geschafft. Füge eine neue Aufgabe hinzu, um weiterzumachen."
      : "Noch keine Aufgaben im Ablauf. Füge im Bearbeitungsmodus den ersten Programmpunkt hinzu.";
    elements.list.append(empty);
  } else {
    state.pending.forEach((task, index) => elements.list.append(makeTaskCard(task, index)));
  }

  elements.historyList.replaceChildren();
  state.completed.forEach((task, index) => elements.historyList.append(makeTaskCard(task, index, true)));
  elements.history.hidden = state.completed.length === 0;
  elements.historyLabel.textContent = `Erledigte Aufgaben (${state.completed.length})`;
  elements.count.textContent = `${state.pending.length} offen`;
  elements.exportButton.disabled = state.pending.length + state.completed.length === 0;
  elements.modeButton.textContent = state.mode === "live" ? "Bearbeitungsmodus öffnen" : "Live-Modus starten";
  elements.modeButton.classList.toggle("live", state.mode === "live");
  elements.workspace.classList.toggle("live-mode", state.mode === "live");
  elements.workspace.classList.toggle("edit-mode", state.mode === "edit");
  elements.sidePanel.hidden = state.mode === "live";
  elements.form.hidden = state.mode === "live";
  elements.transferActions.hidden = state.mode === "live";
  elements.storageNote.hidden = state.mode === "live";
  elements.showName.disabled = state.mode === "live";
  updateClock();
}

function isValidClockTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
}

function normalizeClockTime(value) {
  if (typeof value !== "string") return "";
  const normalized = /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? `${value}:00` : value;
  return isValidClockTime(normalized) ? normalized : "";
}

function formatClockTime(value) {
  return isValidClockTime(value) ? value : "";
}

function vmixUrlError(value) {
  if (typeof value !== "string" || !value.trim()) return "Hinterlege einen vMix-API-Link.";
  if (value.length > 2048) return "Der vMix-Link ist zu lang.";
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return "Der vMix-Link ist ungültig.";
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    return "Erlaubt sind HTTP-/HTTPS-Links ohne Zugangsdaten oder Fragment.";
  }
  return "";
}

function setVmixStatus(taskId, message) {
  vmixRequestStatus.set(taskId, message);
  const card = Array.from(elements.list.querySelectorAll(".task-card")).find((item) => item.dataset.taskId === taskId);
  const status = card?.querySelector(".vmix-status");
  if (status) status.textContent = message;
}

function activateCurrentTask() {
  if (state.mode !== "live") return;
  const task = state.pending[0];
  if (!task || !task.vmixEnabled || task.vmixTriggered) return;
  task.vmixTriggered = true;
  saveState();
  const error = vmixUrlError(task.vmixUrl);
  if (error) {
    console.warn(`vMix-Befehl für „${task.title}“ wurde nicht aufgerufen: ${error}`);
    setVmixStatus(task.id, error);
    return;
  }
  const url = new URL(task.vmixUrl.trim());
  setVmixStatus(task.id, "vMix-Link wird im Hintergrund abgerufen.");
  fetch(url.href, {
    method: "GET",
    mode: "no-cors",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer"
  }).then(() => {
    setVmixStatus(task.id, "vMix-Link wurde im Hintergrund abgerufen.");
  }).catch((error) => {
    console.warn(`vMix-Aufruf für „${task.title}“ ist fehlgeschlagen.`, error);
    setVmixStatus(task.id, "vMix-Link konnte nicht abgerufen werden. Netzwerk- oder Browserfreigaben prüfen.");
  });
}

function updateClock() {
  const now = new Date();
  elements.systemClock.textContent = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(now);
}

function processScheduledTasks() {
  const now = new Date();
  updateClock();
  if (state.mode !== "live") return;
  const currentSecond = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const dueTasks = state.pending
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.id !== editingScheduledTaskId && task.scheduleEnabled && !task.scheduleTriggered && isValidClockTime(task.scheduledTime))
    .map(({ task, index }) => ({
      task,
      index,
      time: Number(task.scheduledTime.slice(0, 2)) * 3600 + Number(task.scheduledTime.slice(3, 5)) * 60 + Number(task.scheduledTime.slice(6, 8))
    }))
    .filter(({ time }) => time <= currentSecond)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  let changed = false;
  for (const { task } of dueTasks) {
    const currentIndex = state.pending.indexOf(task);
    if (currentIndex < 0) continue;
    task.scheduleTriggered = true;
    if (currentIndex > 0) {
      const previousTask = state.pending.shift();
      state.completed.unshift(previousTask);
      const targetIndex = state.pending.indexOf(task);
      if (targetIndex >= 0) state.pending.splice(targetIndex, 1);
      state.pending.unshift(task);
    }
    changed = true;
  }
  if (changed) {
    saveState();
    render();
  }
  activateCurrentTask();
}

function exportTasks() {
  const tasks = [...state.completed].reverse().concat(state.pending).map((task) => ({
    title: task.title,
    scheduleEnabled: task.scheduleEnabled === true,
    scheduledTime: task.scheduledTime || "",
    color: taskColors.includes(task.color) ? task.color : "default",
    note: typeof task.note === "string" ? task.note : "",
    vmixEnabled: task.vmixEnabled === true,
    vmixUrl: typeof task.vmixUrl === "string" ? task.vmixUrl : ""
  }));
  const payload = {
    format: "regieplan-tasks",
    version: 5,
    exportedAt: new Date().toISOString(),
    showName: state.showName,
    tasks
  };
  const file = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  const fileName = state.showName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "regieplan";
  link.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.transferStatus.classList.remove("error");
  elements.transferStatus.textContent = `${tasks.length} Aufgaben exportiert.`;
}

async function importTasks(file) {
  if (!file) return;
  elements.importFile.value = "";
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "regieplan-tasks" || ![1, 2, 3, 4, 5].includes(payload.version) || !Array.isArray(payload.tasks)) {
      throw new Error("Die Datei hat kein unterstütztes Regieplan-Format.");
    }
    if (payload.tasks.length > 500 || payload.tasks.some((task) => {
      const title = typeof task === "string" ? task : task?.title;
      if (typeof title !== "string" || !title.trim() || title.trim().length > 120) return true;
      if (payload.version >= 2 && typeof task !== "string") {
        return (task.scheduleEnabled !== undefined && typeof task.scheduleEnabled !== "boolean") ||
          (task.scheduledTime !== undefined && task.scheduledTime !== "" && !normalizeClockTime(task.scheduledTime)) ||
          (payload.version >= 4 && task.note !== undefined && (typeof task.note !== "string" || task.note.length > 1000)) ||
          (payload.version >= 4 && task.color !== undefined && !taskColors.includes(task.color)) ||
          (payload.version >= 5 && task.vmixEnabled !== undefined && typeof task.vmixEnabled !== "boolean") ||
          (payload.version >= 5 && task.vmixUrl !== undefined && (typeof task.vmixUrl !== "string" || task.vmixUrl.length > 2048));
      }
      return false;
    })) {
      throw new Error("Die Datei enthält ungültige Aufgaben.");
    }
    const includesVmixCommands = payload.version >= 5 && payload.tasks.some((task) => typeof task !== "string" && task.vmixEnabled === true && task.vmixUrl);
    const importMessage = includesVmixCommands
      ? "Der Import ersetzt die aktuelle Aufgabenliste und deren Erledigt-Historie. Enthaltene vMix-Befehle werden beim Aktivieren der jeweiligen Karte im Live-Modus aufgerufen. Fortfahren?"
      : "Der Import ersetzt die aktuelle Aufgabenliste und deren Erledigt-Historie. Fortfahren?";
    if (!window.confirm(importMessage)) return;

    state = {
      pending: payload.tasks.map((task) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: (typeof task === "string" ? task : task.title).trim(),
        scheduleEnabled: payload.version >= 2 && typeof task !== "string" && task.scheduleEnabled === true,
        scheduledTime: payload.version >= 2 && typeof task !== "string" ? normalizeClockTime(task.scheduledTime) : "",
        color: payload.version >= 4 && typeof task !== "string" && taskColors.includes(task.color) ? task.color : "default",
        note: payload.version >= 4 && typeof task !== "string" && typeof task.note === "string" ? task.note : "",
        vmixEnabled: payload.version >= 5 && typeof task !== "string" && task.vmixEnabled === true,
        vmixUrl: payload.version >= 5 && typeof task !== "string" && typeof task.vmixUrl === "string" ? task.vmixUrl : "",
        vmixTriggered: false,
        planNumber: null,
        scheduleTriggered: false
      })),
      completed: [],
      mode: "edit",
      showName: typeof payload.showName === "string" ? payload.showName.trim().slice(0, 100) : ""
    };
    vmixRequestStatus.clear();
    elements.showName.value = state.showName;
    saveState();
    render();
    elements.transferStatus.classList.remove("error");
    elements.transferStatus.textContent = `${state.pending.length} Aufgaben importiert.`;
  } catch (error) {
    elements.transferStatus.classList.add("error");
    elements.transferStatus.textContent = error instanceof SyntaxError
      ? "Die Datei ist kein gültiges JSON."
      : error.message || "Die Aufgabenliste konnte nicht importiert werden.";
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = elements.input.value.trim();
  if (!title) return;
  state.pending.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, scheduleEnabled: false, scheduledTime: "", scheduleTriggered: false, planNumber: null, color: "default", note: "", vmixEnabled: false, vmixUrl: "", vmixTriggered: false });
  elements.input.value = "";
  saveState();
  render();
  elements.input.focus();
});

elements.showName.addEventListener("input", () => {
  state.showName = elements.showName.value.trim();
  saveState();
});

elements.modeButton.addEventListener("click", () => {
  if (state.mode === "edit") {
    state.pending.forEach((task, index) => {
      task.planNumber = index + 1;
      task.scheduleTriggered = false;
    });
    state.mode = "live";
  } else {
    state.mode = "edit";
    state.pending.forEach((task) => { task.planNumber = null; });
    state.pending.forEach((task) => { task.vmixTriggered = false; });
    state.completed.forEach((task) => {
      task.planNumber = null;
      task.vmixTriggered = false;
    });
    vmixRequestStatus.clear();
  }
  saveState();
  render();
  processScheduledTasks();
});

setInterval(processScheduledTasks, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) processScheduledTasks();
});

elements.exportButton.addEventListener("click", exportTasks);
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", () => importTasks(elements.importFile.files[0]));

render();
processScheduledTasks();
