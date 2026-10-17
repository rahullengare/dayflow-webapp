require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./src/routes/auth");
const taskRoutes = require("./src/routes/tasks");
const Task = require("./src/models/Task");

const app = express();
const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// PWA files: the service worker and manifest must never be served stale, or installs can't update.
app.get("/sw.js", (_req, res) => {
  res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/", "Content-Type": "application/javascript; charset=utf-8" });
  res.sendFile(path.join(PUBLIC_DIR, "sw.js"));
});
app.get("/manifest.webmanifest", (_req, res) => {
  res.set({ "Cache-Control": "no-cache", "Content-Type": "application/manifest+json; charset=utf-8" });
  res.sendFile(path.join(PUBLIC_DIR, "manifest.webmanifest"));
});

// Icons rarely change; everything else revalidates so deploys show up straight away.
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}icons${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=604800");
    else res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Dayflow", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Something went wrong." });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI. Copy .env.example to .env and configure MongoDB.");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error("Missing JWT_SECRET. Set it in .env or your host's environment settings.");
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");
    await Task.backfillPriorityRank();
    app.listen(PORT, () => console.log(`Dayflow running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not connect to MongoDB:", error.message);
    process.exit(1);
  }
}

if (require.main === module) start();
module.exports = app;
