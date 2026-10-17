const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PAGE_SIZE = 8;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
const state = {
  token: localStorage.getItem("dayflow_token"),
  user: readJSON("dayflow_user"),
  tasks: [], page: 1, pages: 1, total: 0,
  view: "today", filter: "all", search: "",
  stats: null, editingId: null, authMode: "login", toastTimer: null,
  enterNext: true, newId: null, listSeq: 0, prevRate: null, day: null,
  installEvent: null
};

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const addDays = (key, n) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return keyOf(d); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const dateLabel = (key, options = { weekday: "short", month: "short", day: "numeric" }) => {
  if (!key) return "";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", options);
};
const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- api (with a small read-only offline cache) ---------- */
const CACHE_PREFIX = "df_cache:";
function cacheKey(url) { return `${CACHE_PREFIX}${state.user?.id || "u"}:${url}`; }
function clearCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
}
const api = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  let response;
  try {
    response = await fetch(`/api${url}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) }
    });
  } catch {
    if (method === "GET") {
      const cached = readJSON(cacheKey(url));
      if (cached) return { ...cached, _offline: true };
    }
    throw new Error("You’re offline. Reconnect and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) logout(false);
    throw new Error(data.message || "Request failed. Please try again.");
  }
  if (method === "GET" && url !== "/auth/me") {
    try { localStorage.setItem(cacheKey(url), JSON.stringify(data)); } catch { /* storage full or blocked */ }
  }
  return data;
};

/* ---------- small UI helpers ---------- */
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2700);
}
function countTo(el, to, suffix = "") {
  const from = el.dataset.v !== undefined ? Number(el.dataset.v) : 0;
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  if (REDUCED || from === to) { el.textContent = `${to}${suffix}`; return; }
  const start = performance.now(), duration = 600;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
function replayAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(className);
}

/* ---------- confetti ---------- */
const fx = { canvas: null, ctx: null, parts: [], raf: 0 };
const CONFETTI_COLORS = ["#7866e8", "#a69aff", "#37b98b", "#f3a65c", "#ff7a90", "#4f95d4"];
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  fx.canvas.width = window.innerWidth * dpr;
  fx.canvas.height = window.innerHeight * dpr;
  fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function burst(x, y, { count = 28, power = 7, gravity = 0.22 } = {}) {
  if (REDUCED) return;
  if (!fx.canvas) { fx.canvas = $("#fx"); fx.ctx = fx.canvas.getContext("2d"); }
  fitCanvas();
  for (let i = 0; i < count && fx.parts.length < 320; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = power * (0.4 + Math.random() * 0.8);
    fx.parts.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - power * 0.5,
      size: 5 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      life: 0, max: 55 + Math.random() * 30, gravity, round: Math.random() < 0.35
    });
  }
  if (!fx.raf) fx.raf = requestAnimationFrame(tickConfetti);
}
function tickConfetti() {
  const { ctx, canvas } = fx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fx.parts = fx.parts.filter(p => p.life < p.max);
  for (const p of fx.parts) {
    p.life++; p.vy += p.gravity; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
    ctx.restore();
  }
  if (fx.parts.length) fx.raf = requestAnimationFrame(tickConfetti);
  else { fx.raf = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}
function celebrateDay() {
  const w = window.innerWidth;
  burst(w * 0.3, window.innerHeight * 0.35, { count: 60, power: 11 });
  burst(w * 0.7, window.innerHeight * 0.35, { count: 60, power: 11 });
  showToast("Day cleared. Every task done 🎉");
}

/* ---------- auth ---------- */
function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  $("#auth-title").innerHTML = isRegister ? 'Start with a<br><span>small win.</span>' : 'Make room for<br><span>what matters.</span>';
  $("#name-wrap").classList.toggle("hidden", !isRegister);
  $("#auth-name").required = isRegister;
  $("#auth-password").autocomplete = isRegister ? "new-password" : "current-password";
  $("#auth-submit").innerHTML = isRegister ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  $("#switch-label").textContent = isRegister ? "Already have an account?" : "New to Dayflow?";
  $("#auth-switch").textContent = isRegister ? "Sign in" : "Create an account";
  $("#auth-error").textContent = "";
}
$("#auth-switch").addEventListener("click", () => setAuthMode(state.authMode === "login" ? "register" : "login"));
$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  $("#auth-error").textContent = "";
  const payload = { email: $("#auth-email").value.trim(), password: $("#auth-password").value };
  if (state.authMode === "register") payload.name = $("#auth-name").value.trim();
  const button = $("#auth-submit");
  button.disabled = true; button.textContent = "Please wait…";
  try {
    const result = await api(`/auth/${state.authMode === "register" ? "register" : "login"}`, { method: "POST", body: JSON.stringify(payload) });
    state.token = result.token; state.user = result.user;
    localStorage.setItem("dayflow_token", result.token);
    localStorage.setItem("dayflow_user", JSON.stringify(result.user));
    await enterApp();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    button.disabled = false;
    button.innerHTML = state.authMode === "register" ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  }
});

async function enterApp() {
  if (!state.user) {
    try {
      state.user = (await api("/auth/me")).user;
      localStorage.setItem("dayflow_user", JSON.stringify(state.user));
    } catch (err) {
      // 401 already signed the user out; anything else (offline, server waking up) just returns to sign-in.
      $("#auth-screen").classList.remove("hidden");
      if (state.token) $("#auth-error").textContent = err.message;
      return;
    }
  } else {
    // We trust the cached profile so the app opens instantly; quietly confirm the session in the background.
    api("/auth/me").catch(() => {});
  }
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-name").textContent = state.user.name;
  $("#user-email").textContent = state.user.email;
  $("#avatar").textContent = state.user.name.charAt(0).toUpperCase();
  updateGreeting();
  state.enterNext = true;
  try { await refreshData(); } catch (err) { showToast(err.message); }
  if (new URLSearchParams(location.search).get("action") === "new") {
    history.replaceState(null, "", "/");
    openModal();
  }
}
function logout(showMessage = true) {
  state.token = null; state.user = null; state.tasks = []; state.stats = null; state.prevRate = null;
  localStorage.removeItem("dayflow_token");
  localStorage.removeItem("dayflow_user");
  clearCache();
  $("#app").classList.add("hidden"); $("#auth-screen").classList.remove("hidden");
  $("#auth-password").value = "";
  setView("today", { load: false });
  if (showMessage) showToast("You’ve signed out.");
}
$("#logout").addEventListener("click", () => logout());
$("#mobile-logout").addEventListener("click", () => logout());

function updateGreeting() {
  state.day = todayKey();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("#page-title").innerHTML = `${greeting}<span class="heading-period">.</span>`;
  $("#header-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  $("#task-date-label").textContent = dateLabel(todayKey(), { month: "short", day: "numeric", year: "numeric" });
}

/* ---------- data loading ---------- */
function listParams() {
  const today = todayKey();
  const p = new URLSearchParams({ page: state.page, limit: PAGE_SIZE });
  if (state.search) p.set("q", state.search);
  if (state.view === "today") {
    p.set("date", today);
    if (state.filter === "active") p.set("completed", "false");
    if (state.filter === "done") p.set("completed", "true");
  } else if (state.view === "upcoming") {
    p.set("from", addDays(today, 1)); p.set("completed", "false"); p.set("sort", "due");
  } else if (state.view === "overdue") {
    p.set("before", today); p.set("completed", "false"); p.set("sort", "due");
  } else if (state.view === "completed") {
    p.set("completed", "true"); p.set("sort", "recent");
  }
  return p.toString();
}
async function loadStats() {
  const stats = await api("/tasks/stats/summary?date=" + todayKey());
  state.stats = stats;
  renderStats();
  return stats;
}
async function loadList() {
  if (state.view === "progress") return;
  const seq = ++state.listSeq;
  const data = await api("/tasks?" + listParams());
  if (seq !== state.listSeq) return; // a newer request superseded this one
  state.tasks = data.tasks; state.page = data.page; state.pages = data.pages; state.total = data.total;
  renderList();
}
async function refreshData() {
  const results = await Promise.allSettled([loadStats(), loadList()]);
  const failed = results.find(r => r.status === "rejected");
  if (failed) throw failed.reason;
}

/* ---------- rendering ---------- */
function activeListEl() { return state.view === "today" ? $("#task-list") : $("#secondary-task-list"); }
function rowRects(container) {
  const map = new Map();
  container.querySelectorAll(".task-row").forEach(r => map.set(r.dataset.taskId, r.getBoundingClientRect().top));
  return map;
}
function taskMarkup(task, index, enter) {
  const safeId = escapeHTML(task._id);
  const title = escapeHTML(task.title);
  const notes = escapeHTML(task.notes || "");
  const category = escapeHTML(task.category);
  const priority = escapeHTML(task.priority);
  const today = todayKey();
  let dueChip = "";
  if (state.view === "overdue") {
    const n = daysBetween(task.dueDate, today);
    dueChip = `<span class="due-chip late">${n} day${n === 1 ? "" : "s"} overdue</span>`;
  } else if (state.view !== "today") {
    dueChip = `<span class="small-muted">${task.dueDate === today ? "Today" : dateLabel(task.dueDate, { month: "short", day: "numeric" })}</span>`;
  }
  const classes = ["task-row", task.completed ? "is-done" : "", enter ? "enter" : "", task._id === state.newId ? "is-new" : ""].filter(Boolean).join(" ");
  return `<article class="${classes}" style="--i:${index}" data-task-id="${safeId}">
    <input class="task-check" type="checkbox" aria-label="Mark ${title} as completed" ${task.completed ? "checked" : ""} data-action="toggle" data-id="${safeId}">
    <div class="task-main"><div class="task-title">${title}</div>${notes ? `<div class="task-notes">${notes}</div>` : ""}
      <div class="task-meta"><span class="tag category-${category}">${category}</span><span class="priority ${priority}">${priority} priority</span>${dueChip}</div>
    </div>
    <div class="task-actions"><button class="task-action" title="Edit task" aria-label="Edit task" data-action="edit" data-id="${safeId}">✎</button><button class="task-action" title="Delete task" aria-label="Delete task" data-action="delete" data-id="${safeId}">×</button></div>
  </article>`;
}
function renderList() {
  const container = activeListEl();
  const enter = state.enterNext;
  state.enterNext = false;
  const prev = enter ? null : rowRects(container);

  container.innerHTML = state.tasks.map((t, i) => taskMarkup(t, i, enter)).join("");
  // Keep the "new" marker until the task is actually on screen (it may sit on a later page).
  if (state.tasks.some(t => t._id === state.newId)) state.newId = null;

  // Smoothly slide surviving rows into their new positions; fade in rows that weren't there before.
  if (prev && !REDUCED) {
    container.querySelectorAll(".task-row").forEach(row => {
      const old = prev.get(row.dataset.taskId);
      if (old === undefined) { row.classList.add("enter"); row.style.setProperty("--i", 0); return; }
      const dy = old - row.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) row.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }

  const hasTasks = state.tasks.length > 0;
  if (state.view === "today") {
    $("#empty-state").classList.toggle("hidden", hasTasks);
    $("#task-list").classList.toggle("hidden", !hasTasks);
    if (!hasTasks) {
      const none = (state.stats?.today.total ?? 0) === 0;
      let title, copy;
      if (state.search) { title = "No matching tasks."; copy = "Try a different word, or clear the search."; }
      else if (none) { title = "A clear space to begin."; copy = "Add your first task and make today count."; }
      else if (state.filter === "active") { title = "Nothing left in progress."; copy = "You’ve cleared your active list. Nice work."; }
      else { title = "No completed tasks yet."; copy = "Finish a task and your win will show up here."; }
      $("#empty-title").textContent = title; $("#empty-copy").textContent = copy;
      $("#empty-add").classList.toggle("hidden", Boolean(state.search));
    }
    renderPager($("#task-pager"));
  } else {
    const meta = {
      upcoming: ["Nothing planned yet.", "Tasks you schedule for later will show up here.", true],
      overdue: ["You’re all caught up.", "No overdue tasks. Lovely.", false],
      completed: ["No wins yet.", "Finish a task and it will be collected here.", false]
    }[state.view];
    const emptyTitle = state.search ? "No matching tasks." : meta[0];
    const emptyCopy = state.search ? "Try a different word, or clear the search." : meta[1];
    $("#secondary-empty").querySelector("h3").textContent = emptyTitle;
    $("#secondary-empty").querySelector("p").textContent = emptyCopy;
    $("#secondary-add").classList.toggle("hidden", !meta[2] || Boolean(state.search));
    $("#secondary-empty").classList.toggle("hidden", hasTasks);
    $("#secondary-task-list").classList.toggle("hidden", !hasTasks);
    $("#list-total").textContent = state.total ? `${state.total} task${state.total === 1 ? "" : "s"}` : "";
    $("#reschedule-overdue").classList.toggle("hidden", !(state.view === "overdue" && state.total > 0));
    renderPager($("#list-pager"));
  }
}
// A new task sorts by priority, so it may land on page 2+. Hop to the page that holds it so the entrance animation is seen.
async function revealNewTask() {
  if (!state.newId) return;
  const home = state.page;
  for (let p = state.page + 1; state.newId && p <= Math.min(state.pages, 8); p++) {
    state.page = p; state.enterNext = true;
    await loadList();
  }
  if (state.newId) { state.newId = null; if (state.page !== home) { state.page = home; state.enterNext = true; await loadList(); } }
}
function pageWindow(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const list = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => { if (i && p - list[i - 1] > 1) out.push("…"); out.push(p); });
  return out;
}
function renderPager(el) {
  if (state.pages <= 1) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const first = (state.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(state.total, state.page * PAGE_SIZE);
  const numbers = pageWindow(state.page, state.pages).map(p =>
    p === "…" ? `<span class="pager-gap">…</span>`
      : `<button class="pager-btn ${p === state.page ? "active" : ""}" data-page="${p}" ${p === state.page ? 'aria-current="page"' : ""} aria-label="Page ${p}">${p}</button>`).join("");
  el.innerHTML = `<span class="pager-info">${first}–${last} of ${state.total}</span>
    <div class="pager-controls">
      <button class="pager-btn pager-step" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>
      ${numbers}
      <button class="pager-btn pager-step" data-page="${state.page + 1}" ${state.page === state.pages ? "disabled" : ""} aria-label="Next page">›</button>
    </div>`;
  el.classList.remove("hidden");
}
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-page]");
  if (!btn || btn.disabled) return;
  state.page = Number(btn.dataset.page);
  state.enterNext = true;
  try { await loadList(); } catch (err) { showToast(err.message); }
  activeListEl().closest(".panel").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "nearest" });
});

function growBars(container, fillSelector) {
  const fills = [...container.querySelectorAll(fillSelector)];
  if (REDUCED) { fills.forEach(f => { f.style.height = f.dataset.h; }); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach((f, i) => {
    f.style.transitionDelay = `${i * 45}ms`;
    f.style.height = f.dataset.h;
  })));
}
function renderStats() {
  const s = state.stats; if (!s) return;
  const allDone = s.today.total > 0 && s.today.rate === 100;
  countTo($("#today-rate"), s.today.rate, "%");
  $("#ring-progress").style.strokeDashoffset = 307.88 * (1 - s.today.rate / 100);
  $("#progress-headline").textContent = allDone ? "You did it. Brilliant." : s.today.completed ? "Look at you go." : "A fresh start.";
  $("#progress-message").textContent = allDone ? "You showed up for every task today." : s.today.completed ? "You’re building real momentum." : "Choose a task and build some momentum.";
  $("#mini-progress-fill").style.width = `${s.today.rate}%`;
  $("#progress-count").textContent = `${s.today.completed} of ${s.today.total} tasks done`;
  countTo($("#stat-completed"), s.today.completed);
  countTo($("#stat-remaining"), s.today.remaining);
  countTo($("#all-total"), s.overall.total);
  countTo($("#all-completed"), s.overall.completed);
  countTo($("#all-rate"), s.overall.rate, "%");
  countTo($("#week-rate"), s.week.rate, "%");
  countTo($("#best-streak"), s.streak.best);
  $("#week-total").textContent = `${s.week.completed} completed`;
  $("#task-heading-count").textContent = s.today.total;
  $("#today-count").textContent = s.today.remaining;

  const overdue = $("#overdue-count");
  overdue.textContent = s.overdue;
  overdue.classList.toggle("hidden", s.overdue === 0);

  const pill = $("#streak-pill");
  const showStreak = s.streak.current > 0;
  pill.classList.toggle("hidden", !showStreak);
  if (showStreak) {
    $("#streak-count").textContent = s.streak.current;
    $("#streak-label").textContent = s.streak.current === 1 ? "day streak" : "day streak";
    if (state.prevRate !== null && state.stats && s._streakChanged) replayAnimation(pill, "bump");
  }
  $("#ring-wrap-glow")?.classList.toggle("on", allDone);
  document.querySelector(".progress-card").classList.toggle("is-complete", allDone);

  if (state.prevRate !== null && state.prevRate < 100 && allDone) celebrateDay();
  state.prevRate = s.today.rate;
  renderWeek(); renderHistory();
}
function renderWeek() {
  const days = state.stats?.week.daily || [];
  $("#week-bars").innerHTML = days.map(d => {
    const pct = d.total ? d.completed / d.total * 100 : 0;
    return `<div class="week-day ${d.date === todayKey() ? "today" : ""}"><div class="bar-stack" title="${d.completed} of ${d.total} completed"><div class="bar-fill" data-h="${pct}%" style="height:0"></div></div><span>${escapeHTML(d.label)}</span></div>`;
  }).join("");
  growBars($("#week-bars"), ".bar-fill");
}
function renderHistory() {
  const days = state.stats?.week.daily || [];
  $("#history-chart").innerHTML = days.map(d => {
    const pct = d.total ? d.completed / d.total * 100 : 0;
    return `<div class="history-column ${d.date === todayKey() ? "today" : ""}"><span class="history-number">${d.completed}/${d.total}</span><div class="history-track" title="${d.completed} completed, ${d.total - d.completed} remaining"><div class="history-fill" data-h="${pct}%" style="height:0"></div></div><span class="history-label">${escapeHTML(d.label)}</span></div>`;
  }).join("");
  growBars($("#history-chart"), ".history-fill");
}

/* ---------- views, filters, search ---------- */
const VIEW_COPY = {
  today: { name: "My day", subtitle: "Here’s your focus for today." },
  upcoming: { name: "Upcoming", subtitle: "Give your future self a head start.", title: "Coming up", blurb: "A little preview of what’s next." },
  overdue: { name: "Overdue", subtitle: "A gentle nudge. Nothing here is lost.", title: "Overdue tasks", blurb: "Reschedule, finish, or let go. Your call." },
  completed: { name: "Completed", subtitle: "Look at everything you’ve followed through on.", title: "Completed tasks", blurb: "Every finished task is progress." },
  progress: { name: "Progress", subtitle: "Your effort, collected over time." }
};
function setView(view, { load = true } = {}) {
  state.view = view; state.page = 1; state.search = ""; state.enterNext = true;
  $("#task-search").value = ""; $("#list-search").value = "";
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const sections = { "today-view": view === "today", "list-view": ["upcoming", "overdue", "completed"].includes(view), "progress-view": view === "progress" };
  for (const [id, show] of Object.entries(sections)) {
    const el = $("#" + id);
    el.classList.toggle("hidden", !show);
    if (show && !REDUCED) replayAnimation(el, "view-enter");
  }
  const copy = VIEW_COPY[view];
  $("#breadcrumb-current").textContent = copy.name;
  $("#page-subtitle").textContent = copy.subtitle;
  if (copy.title) { $("#list-view-title").textContent = copy.title; $("#list-view-subtitle").textContent = copy.blurb; }
  $("#add-task-top").classList.toggle("hidden", view === "completed" || view === "progress");
  $("#list-add").classList.toggle("hidden", view === "completed");
  if (view === "progress") renderHistory();
  if (load && state.token) loadList().catch(err => showToast(err.message));
}
$$(".nav-item").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("#task-filters").addEventListener("click", e => {
  const button = e.target.closest("[data-filter]"); if (!button) return;
  state.filter = button.dataset.filter; state.page = 1; state.enterNext = true;
  $$(".filter-tab").forEach(b => b.classList.toggle("active", b === button));
  loadList().catch(err => showToast(err.message));
});
let searchTimer;
function onSearch(e) {
  clearTimeout(searchTimer);
  const value = e.target.value.trim();
  searchTimer = setTimeout(() => {
    if (value === state.search) return;
    state.search = value; state.page = 1; state.enterNext = true;
    loadList().catch(err => showToast(err.message));
  }, 250);
}
$("#task-search").addEventListener("input", onSearch);
$("#list-search").addEventListener("input", onSearch);

/* ---------- quick add ---------- */
$("#quick-add").addEventListener("submit", async e => {
  e.preventDefault();
  const input = $("#quick-title");
  const title = input.value.trim();
  if (!title) { replayAnimation($("#quick-add"), "shake"); input.focus(); return; }
  input.disabled = true;
  try {
    const { task } = await api("/tasks", { method: "POST", body: JSON.stringify({ title, category: $("#quick-category").value, priority: "Medium", dueDate: todayKey() }) });
    input.value = "";
    state.newId = task._id; state.page = 1;
    if (state.filter === "done") { state.filter = "all"; $$(".filter-tab").forEach(b => b.classList.toggle("active", b.dataset.filter === "all")); }
    if (state.search) { state.search = ""; $("#task-search").value = ""; }
    await refreshData();
    await revealNewTask();
    const rect = $("#quick-add").getBoundingClientRect();
    burst(rect.left + 28, rect.top + rect.height / 2, { count: 10, power: 4 });
    showToast("Added to your day.");
  } catch (err) { showToast(err.message); }
  finally { input.disabled = false; input.focus(); }
});

/* ---------- task modal ---------- */
function openModal(task = null) {
  state.editingId = task?._id || null;
  $("#task-form").reset();
  $("#task-error").textContent = "";
  $("#modal-title").textContent = task ? "Edit task" : "Add a task";
  $("#save-task").innerHTML = task ? "Save changes <span>↗</span>" : "Save task <span>↗</span>";
  $("#task-title").value = task?.title || "";
  $("#task-notes").value = task?.notes || "";
  $("#task-category").value = task?.category || "Study";
  $("#task-priority").value = task?.priority || "Medium";
  $("#task-date").value = task?.dueDate || (state.view === "upcoming" ? addDays(todayKey(), 1) : todayKey());
  $("#task-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#task-title").focus(), 50);
}
function closeModal() { $("#task-modal").classList.add("hidden"); document.body.style.overflow = ""; state.editingId = null; }
["#add-task-top", "#add-task-inline", "#empty-add", "#list-add", "#secondary-add"].forEach(sel => $(sel).addEventListener("click", () => openModal()));
$("#modal-close").addEventListener("click", closeModal);
$("#modal-cancel").addEventListener("click", closeModal);
$("#task-modal").addEventListener("click", e => { if (e.target === $("#task-modal")) closeModal(); });
$("#task-form").addEventListener("submit", async e => {
  e.preventDefault();
  $("#task-error").textContent = "";
  const payload = {
    title: $("#task-title").value.trim(), notes: $("#task-notes").value.trim(),
    category: $("#task-category").value, priority: $("#task-priority").value, dueDate: $("#task-date").value
  };
  const button = $("#save-task"); const wasEditing = Boolean(state.editingId); button.disabled = true; button.textContent = "Saving…";
  try {
    const result = await api(state.editingId ? `/tasks/${state.editingId}` : "/tasks", { method: state.editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
    closeModal();
    state.newId = wasEditing ? null : result.task._id;
    state.page = wasEditing ? state.page : 1;
    await refreshData();
    await revealNewTask();
    const elsewhere = payload.dueDate !== todayKey() && state.view === "today";
    showToast(wasEditing ? "Task updated." : elsewhere ? `Task planned for ${dateLabel(payload.dueDate)}.` : "Task added to your day.");
  } catch (err) { $("#task-error").textContent = err.message; }
  finally { button.disabled = false; button.innerHTML = wasEditing ? "Save changes <span>↗</span>" : "Save task <span>↗</span>"; }
});

/* ---------- confirm dialog ---------- */
function confirmDialog({ title, text, okLabel = "Delete" }) {
  return new Promise(resolve => {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel;
    const modal = $("#confirm-modal");
    modal.classList.remove("hidden");
    $("#confirm-cancel").focus();
    const finish = (value) => {
      modal.classList.add("hidden");
      $("#confirm-ok").removeEventListener("click", ok);
      $("#confirm-cancel").removeEventListener("click", cancel);
      modal.removeEventListener("click", backdrop);
      document.removeEventListener("keydown", key, true);
      resolve(value);
    };
    const ok = () => finish(true), cancel = () => finish(false);
    const backdrop = (ev) => { if (ev.target === modal) finish(false); };
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(false); } };
    $("#confirm-ok").addEventListener("click", ok);
    $("#confirm-cancel").addEventListener("click", cancel);
    modal.addEventListener("click", backdrop);
    document.addEventListener("keydown", key, true);
  });
}

/* ---------- row actions ---------- */
function leavesCurrentList(completed) {
  if (state.view === "today") return (state.filter === "active" && completed) || (state.filter === "done" && !completed);
  if (state.view === "completed") return !completed;
  return completed; // upcoming / overdue only list unfinished tasks
}
document.addEventListener("click", async e => {
  const control = e.target.closest("[data-action]");
  if (!control || control.dataset.action === "toggle") return;
  const { action, id } = control.dataset;
  const task = state.tasks.find(t => t._id === id);
  if (!task) return;
  if (action === "edit") return openModal(task);
  if (action === "delete") {
    const ok = await confirmDialog({ title: "Delete this task?", text: `“${task.title}” will be removed for good.` });
    if (!ok) return;
    const row = control.closest(".task-row");
    row?.classList.add("leaving");
    try {
      await Promise.all([api(`/tasks/${id}`, { method: "DELETE" }), wait(REDUCED ? 0 : 320)]);
      await refreshData();
      showToast("Task deleted.");
    } catch (err) { row?.classList.remove("leaving"); showToast(err.message); }
  }
});
document.addEventListener("change", async e => {
  const control = e.target.closest('[data-action="toggle"]'); if (!control) return;
  const row = control.closest(".task-row");
  const completed = control.checked;
  control.disabled = true;
  row.classList.toggle("is-done", completed);
  if (completed) {
    replayAnimation(row, "just-done");
    const r = control.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, { count: 22, power: 6 });
  }
  try {
    await Promise.all([api(`/tasks/${control.dataset.id}`, { method: "PATCH", body: JSON.stringify({ completed }) }), wait(REDUCED ? 0 : 420)]);
    if (leavesCurrentList(completed)) { row.classList.add("leaving"); await wait(REDUCED ? 0 : 320); }
    await refreshData();
    if (!completed) showToast("Task moved back to in progress.");
    else if (!(state.stats && state.stats.today.rate === 100)) showToast("One small win, collected ✨");
  } catch (err) {
    control.checked = !completed; row.classList.toggle("is-done", !completed); control.disabled = false;
    showToast(err.message);
  }
});
$("#reschedule-overdue").addEventListener("click", async () => {
  try {
    const { moved } = await api("/tasks/reschedule-overdue", { method: "POST", body: JSON.stringify({ date: todayKey() }) });
    state.enterNext = true; state.page = 1;
    await refreshData();
    showToast(moved ? `Moved ${moved} task${moved === 1 ? "" : "s"} to today.` : "Nothing to move.");
  } catch (err) { showToast(err.message); }
});

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === "Escape" && !$("#task-modal").classList.contains("hidden")) return closeModal();
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#app").classList.contains("hidden")) return;
  if (!$("#task-modal").classList.contains("hidden")) return;
  if (e.key === "n") { e.preventDefault(); openModal(); }
  if (e.key === "/") {
    e.preventDefault();
    (state.view === "today" ? $("#task-search") : $("#list-search")).focus();
  }
});

/* ---------- PWA: offline banner, install, service worker ---------- */
function syncOnline() { document.body.classList.toggle("is-offline", !navigator.onLine); }
window.addEventListener("online", () => { syncOnline(); if (state.token) { state.enterNext = false; refreshData().catch(() => {}); showToast("Back online."); } });
window.addEventListener("offline", syncOnline);
syncOnline();

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function showInstall(show) { ["#install-btn", "#mobile-install"].forEach(sel => $(sel).classList.toggle("hidden", !show)); }
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.installEvent = e; showInstall(true); });
window.addEventListener("appinstalled", () => { state.installEvent = null; showInstall(false); showToast("Dayflow installed. Find it on your home screen."); });
async function promptInstall() {
  if (state.installEvent) {
    state.installEvent.prompt();
    await state.installEvent.userChoice.catch(() => {});
    state.installEvent = null; showInstall(false);
  } else if (isIOS) {
    showToast("Tap the Share icon, then “Add to Home Screen”.");
  }
}
$("#install-btn").addEventListener("click", promptInstall);
$("#mobile-install").addEventListener("click", promptInstall);
if (isIOS && !isStandalone()) showInstall(true);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// If the app stays open past midnight (common for an installed app), roll over to the new day.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.token || !state.user) return;
  if (state.day && state.day !== todayKey()) { updateGreeting(); state.enterNext = true; refreshData().catch(() => {}); }
});

(async function init() {
  setAuthMode("login");
  if (state.token) await enterApp();
})();
