const express = require("express");
const Task = require("../models/Task");
const auth = require("../middleware/auth");

const router = express.Router();
router.use(auth);

const allowedCategories = ["Work", "Study", "Health", "Personal", "Other"];
const allowedPriorities = ["Low", "Medium", "High"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const SORTS = {
  // open tasks first, then High -> Low, newest first
  priority: { completed: 1, priorityRank: -1, createdAt: -1 },
  // soonest due date first (used for Upcoming / Overdue)
  due: { dueDate: 1, priorityRank: -1, createdAt: -1 },
  // most recently finished first (used for Completed)
  recent: { completedAt: -1, updatedAt: -1 }
};

// "2026-02-31" matches the regex but is not a real day.
function isRealDate(key) {
  if (typeof key !== "string" || !DATE_RE.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

// ---- date helpers that never touch the server's timezone -------------------
const dayNumber = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const keyFromDayNumber = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const weekdayLabel = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

router.get("/", async (req, res, next) => {
  try {
    const query = { user: req.userId };

    const dueDate = {};
    if (isRealDate(req.query.date)) dueDate.$eq = req.query.date;
    if (isRealDate(req.query.from)) dueDate.$gte = req.query.from;
    if (isRealDate(req.query.to)) dueDate.$lte = req.query.to;
    if (isRealDate(req.query.before)) dueDate.$lt = req.query.before;
    if (Object.keys(dueDate).length) query.dueDate = dueDate;

    if (req.query.completed === "true") query.completed = true;
    if (req.query.completed === "false") query.completed = false;

    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      query.$or = [{ title: rx }, { notes: rx }];
    }

    const limit = Math.min(Math.max(toInt(req.query.limit, DEFAULT_LIMIT), 1), MAX_LIMIT);
    const total = await Task.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(toInt(req.query.page, 1), 1), pages);
    const sort = SORTS[req.query.sort] || SORTS.priority;

    const tasks = await Task.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean();
    res.json({ tasks, page, pages, limit, total });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const { title, notes = "", category = "Personal", priority = "Medium", dueDate } = req.body;
    if (!String(title || "").trim()) return res.status(400).json({ message: "Give your task a title." });
    if (!isRealDate(dueDate)) return res.status(400).json({ message: "Choose a valid date." });
    if (!allowedCategories.includes(category)) return res.status(400).json({ message: "Choose a valid category." });
    if (!allowedPriorities.includes(priority)) return res.status(400).json({ message: "Choose a valid priority." });
    const task = await Task.create({
      user: req.userId, title: String(title).trim().slice(0, 180), notes: String(notes).slice(0, 1000), category, priority, dueDate
    });
    res.status(201).json({ task });
  } catch (err) { next(err); }
});

// Move every unfinished task from before `date` onto `date` (the "catch up" button).
router.post("/reschedule-overdue", async (req, res, next) => {
  try {
    const date = req.body.date;
    if (!isRealDate(date)) return res.status(400).json({ message: "Choose a valid date." });
    const result = await Task.updateMany({ user: req.userId, completed: false, dueDate: { $lt: date } }, { $set: { dueDate: date } });
    res.json({ moved: result.modifiedCount ?? result.nModified ?? 0 });
  } catch (err) { next(err); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const updates = {};
    for (const key of ["title", "notes", "category", "priority", "dueDate", "completed"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.title !== undefined && !String(updates.title).trim()) return res.status(400).json({ message: "Task title cannot be empty." });
    if (updates.category && !allowedCategories.includes(updates.category)) return res.status(400).json({ message: "Invalid category." });
    if (updates.priority && !allowedPriorities.includes(updates.priority)) return res.status(400).json({ message: "Invalid priority." });
    if (updates.dueDate !== undefined && !isRealDate(updates.dueDate)) return res.status(400).json({ message: "Invalid date." });
    if (updates.completed !== undefined && typeof updates.completed !== "boolean") return res.status(400).json({ message: "Invalid completion value." });
    if (updates.priority) updates.priorityRank = Task.PRIORITY_RANK[updates.priority];
    if (typeof updates.completed === "boolean") updates.completedAt = updates.completed ? new Date() : null;
    const task = await Task.findOneAndUpdate({ _id: req.params.id, user: req.userId }, updates, { new: true, runValidators: true });
    if (!task) return res.status(404).json({ message: "Task not found." });
    res.json({ task });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!task) return res.status(404).json({ message: "Task not found." });
    res.json({ message: "Task deleted." });
  } catch (err) { next(err); }
});

router.get("/stats/summary", async (req, res, next) => {
  try {
    // The browser tells us what "today" is so stats match the user's timezone, not the server's.
    const today = isRealDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const todayNum = dayNumber(today);
    const weekFrom = keyFromDayNumber(todayNum - 6);

    const allTasks = await Task.find({ user: req.userId }).select("dueDate completed").lean();

    const byDay = new Map();
    let totalCompleted = 0, overdue = 0;
    for (const t of allTasks) {
      const entry = byDay.get(t.dueDate) || { total: 0, completed: 0 };
      entry.total++;
      if (t.completed) { entry.completed++; totalCompleted++; }
      else if (t.dueDate < today) overdue++;
      byDay.set(t.dueDate, entry);
    }

    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const key = keyFromDayNumber(todayNum - i);
      const e = byDay.get(key) || { total: 0, completed: 0 };
      daily.push({ date: key, label: weekdayLabel(key), total: e.total, completed: e.completed });
    }
    const weekTotal = daily.reduce((n, d) => n + d.total, 0);
    const weekDone = daily.reduce((n, d) => n + d.completed, 0);
    const todayE = byDay.get(today) || { total: 0, completed: 0 };

    // Streak = consecutive days with at least one finished task. Today doesn't break it until the day is over.
    const doneDays = new Set([...byDay].filter(([, e]) => e.completed > 0).map(([k]) => dayNumber(k)));
    let cursor = doneDays.has(todayNum) ? todayNum : todayNum - 1;
    let streak = 0;
    while (doneDays.has(cursor)) { streak++; cursor--; }
    let best = 0, run = 0, prev = null;
    for (const n of [...doneDays].sort((a, b) => a - b)) {
      run = prev !== null && n === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = n;
    }

    res.json({
      date: today,
      today: { total: todayE.total, completed: todayE.completed, remaining: todayE.total - todayE.completed, rate: todayE.total ? Math.round(todayE.completed / todayE.total * 100) : 0 },
      week: { from: weekFrom, total: weekTotal, completed: weekDone, rate: weekTotal ? Math.round(weekDone / weekTotal * 100) : 0, daily },
      overall: { total: allTasks.length, completed: totalCompleted, rate: allTasks.length ? Math.round(totalCompleted / allTasks.length * 100) : 0 },
      overdue,
      streak: { current: streak, best }
    });
  } catch (err) { next(err); }
});

module.exports = router;
