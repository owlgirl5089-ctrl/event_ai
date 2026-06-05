document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindChipSelects();
});

const SECTION_KEYS = [
  { key: "title", label: "이벤트 제목", style: "title" },
  { key: "reason", label: "추천 이유", style: "body" },
  { key: "preparation", label: "준비물", style: "body" },
  { key: "steps", label: "진행 순서", style: "steps" },
  { key: "duration", label: "예상 소요 시간", style: "body" },
  { key: "notice", label: "공지문 예시", style: "notice" },
  { key: "engagementTips", label: "참여 유도 멘트", style: "body" },
  { key: "caution", label: "주의사항", style: "body" },
];

let lastRawText = "";
let lastResult = null;
let lastFormData = null;
let toastTimer;
let retryCount = 0;

function bindNavigation() {
  onClick("btn-start", () => goTo("screen-form"));
  onClick("btn-saved-home", () => {
    renderSaved();
    goTo("screen-saved");
  });
  onClick("btn-back-form", () => goTo("screen-home"));
  onClick("btn-back-result", () => goTo("screen-form"));
  onClick("btn-back-saved", () => goTo("screen-home"));
  onClick("btn-generate", () => generateEvent(false));
  onClick("btn-retry", () => generateEvent(true));
  onClick("btn-copy", copyResult);
  onClick("btn-save", saveResult);
}

function onClick(id, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("click", handler);
}

function goTo(screenId) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
    screen.setAttribute("aria-hidden", "true");
  });
  const target = document.getElementById(screenId);
  if (!target) return;
  target.classList.add("active");
  target.setAttribute("aria-hidden", "false");
  document.body.classList.toggle("screen-locked", screenId === "screen-home");
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function bindChipSelects() {
  document.querySelectorAll(".chip-select").forEach(group => {
    group.addEventListener("click", event => {
      const button = event.target.closest(".chip-btn");
      if (!button) return;
      group.querySelectorAll(".chip-btn").forEach(item => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function getSelected(groupId) {
  const selected = document.querySelector(`#${groupId} .chip-btn.selected`);
  return selected ? selected.dataset.val : "";
}

function collectForm() {
  return {
    eventPurpose: getSelected("eventPurpose"),
    memberCount: document.getElementById("memberCount").value.trim(),
    activeTime: getSelected("activeTime"),
    vibe: getSelected("vibe"),
    operationTime: getSelected("difficulty") || "30분 정도",
    extra: document.getElementById("extraRequest").value.trim(),
  };
}

function validateForm(data) {
  if (!data.eventPurpose) return showToastAndFail("이벤트 목적을 선택해주세요.");
  if (!data.memberCount) return showToastAndFail("서버 인원수를 입력해주세요.");
  if (!data.activeTime) return showToastAndFail("주 활동 시간대를 선택해주세요.");
  if (!data.vibe) return showToastAndFail("원하는 분위기를 선택해주세요.");
  return true;
}

function showToastAndFail(message) {
  showToast(message);
  return false;
}

async function generateEvent(isRetry = false) {
  const data = collectForm();
  if (!validateForm(data)) return;

  if (isRetry) retryCount += 1;
  else retryCount = 0;

  lastFormData = data;
  goTo("screen-result");

  const loadingBox = document.getElementById("loading-box");
  const resultCard = document.getElementById("result-card");
  const resultActions = document.getElementById("result-actions");

  loadingBox.classList.remove("hidden");
  resultCard.classList.add("hidden");
  resultActions.classList.add("hidden");

  try {
    const response = await fetch("/api/generate-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, retryCount, avoidTitle: lastResult?.title || "" }),
    });

    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || `서버 오류: ${response.status}`);

    const eventData = payload.event || parseEventFromText(payload.text) || {};
    lastResult = normalizeResult(eventData);
    lastRawText = formatResultAsText(lastResult);
    renderResult(lastResult);
  } catch (error) {
    console.error(error);
    loadingBox.classList.add("hidden");
    resultCard.innerHTML = `<div class="error-box"><strong>오류가 발생했어요.</strong><span>${escHtml(error.message)}</span></div>`;
    resultCard.classList.remove("hidden");
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { error: text }; }
}

function parseEventFromText(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(cleaned.slice(first, last + 1)); }
  catch { return null; }
}

function normalizeResult(result) {
  const safe = result && typeof result === "object" ? result : {};
  const aliases = {
    title: ["title", "eventTitle", "이벤트 제목"],
    reason: ["reason", "추천 이유"],
    preparation: ["preparation", "materials", "준비물"],
    steps: ["steps", "진행 순서"],
    duration: ["duration", "예상 소요 시간"],
    notice: ["notice", "공지문 예시"],
    engagementTips: ["engagementTips", "참여 유도 멘트"],
    caution: ["caution", "cautions", "주의사항"],
  };
  const out = {};
  for (const section of SECTION_KEYS) {
    const possibleKeys = aliases[section.key] || [section.key];
    let value = "";
    for (const k of possibleKeys) {
      if (safe[k] !== undefined && safe[k] !== null && safe[k] !== "") {
        value = safe[k];
        break;
      }
    }
    if (Array.isArray(value)) out[section.key] = value.map(v => String(v).trim()).filter(Boolean);
    else out[section.key] = String(value || "내용 없음").trim();
  }
  return out;
}

function renderResult(result) {
  const loadingBox = document.getElementById("loading-box");
  const resultCard = document.getElementById("result-card");
  const resultActions = document.getElementById("result-actions");

  resultCard.innerHTML = SECTION_KEYS.map(({ key, label, style }) => {
    const value = result[key] || "내용 없음";
    if (style === "title") {
      return `<div class="result-section"><div class="result-section-label">${label}</div><div class="result-event-title">${escHtml(value)}</div></div>`;
    }
    if (style === "notice") {
      return `<div class="result-section"><div class="result-section-label">${label}</div><div class="notice-box">${formatMultiline(value)}</div></div>`;
    }
    if (style === "steps") {
      const items = Array.isArray(value) ? value : String(value).split(/\n|(?=\d+\.)/).map(v => v.trim()).filter(Boolean);
      return `<div class="result-section"><div class="result-section-label">${label}</div><ol class="result-steps">${items.map(item => `<li>${escHtml(String(item).replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol></div>`;
    }
    return `<div class="result-section"><div class="result-section-label">${label}</div><div class="result-section-body">${formatMultiline(value)}</div></div>`;
  }).join("");

  loadingBox.classList.add("hidden");
  resultCard.classList.remove("hidden");
  resultActions.classList.remove("hidden");
}

function formatMultiline(value) {
  if (Array.isArray(value)) return value.map(v => escHtml(v)).join("<br>");
  return escHtml(value).replace(/\n/g, "<br>");
}

function formatResultAsText(result) {
  return SECTION_KEYS.map(({ key, label }) => {
    const value = Array.isArray(result[key]) ? result[key].map((v, i) => `${i + 1}. ${v}`).join("\n") : result[key];
    return `${label}\n${value || "내용 없음"}`;
  }).join("\n\n");
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function copyResult() {
  if (!lastRawText) return showToast("복사할 결과가 없어요.");
  try {
    await navigator.clipboard.writeText(lastRawText);
    showToast("결과를 복사했어요.");
  } catch { showToast("복사에 실패했어요."); }
}

function saveResult() {
  if (!lastResult || !lastFormData) return showToast("저장할 결과가 없어요.");
  const saved = getSaved();
  saved.unshift({ id: Date.now(), title: lastResult.title || "이벤트", result: lastResult, text: lastRawText, form: lastFormData, date: new Date().toLocaleDateString("ko-KR") });
  localStorage.setItem("eventmate_saved", JSON.stringify(saved));
  showToast("이벤트를 저장했어요.");
}

function getSaved() {
  try { return JSON.parse(localStorage.getItem("eventmate_saved")) || []; }
  catch { return []; }
}

function renderSaved() {
  const list = document.getElementById("saved-list");
  const saved = getSaved();
  if (!saved.length) {
    list.innerHTML = `<div class="saved-empty"><p style="font-size:40px;margin-bottom:12px">☆</p><p>저장된 이벤트가 없어요.<br />마음에 드는 이벤트를 저장해보세요.</p></div>`;
    return;
  }
  list.innerHTML = saved.map(item => `
    <div class="saved-item">
      <div class="saved-item-title">${escHtml(item.title)}</div>
      <div class="saved-item-date">저장일: ${escHtml(item.date)} · ${escHtml(item.form?.eventPurpose || "")}</div>
      <div class="saved-item-actions">
        <button class="btn-tiny" type="button" data-action="view" data-id="${item.id}">보기</button>
        <button class="btn-tiny" type="button" data-action="copy" data-id="${item.id}">복사</button>
        <button class="btn-tiny danger" type="button" data-action="delete" data-id="${item.id}">삭제</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id);
      const action = button.dataset.action;
      if (action === "view") viewSaved(id);
      if (action === "copy") copySaved(id);
      if (action === "delete") deleteSaved(id);
    });
  });
}

function viewSaved(id) {
  const item = getSaved().find(savedItem => savedItem.id === id);
  if (!item) return;
  lastResult = normalizeResult(item.result);
  lastRawText = item.text || formatResultAsText(lastResult);
  lastFormData = item.form;
  goTo("screen-result");
  renderResult(lastResult);
}

async function copySaved(id) {
  const item = getSaved().find(savedItem => savedItem.id === id);
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.text || formatResultAsText(normalizeResult(item.result)));
    showToast("저장된 이벤트를 복사했어요.");
  } catch { showToast("복사에 실패했어요."); }
}

function deleteSaved(id) {
  const saved = getSaved().filter(savedItem => savedItem.id !== id);
  localStorage.setItem("eventmate_saved", JSON.stringify(saved));
  renderSaved();
  showToast("삭제했어요.");
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}
