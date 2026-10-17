const mongoose = require("mongoose");

// Numeric rank so "High" sorts above "Medium" above "Low" (string sorting would be alphabetical).
const PRIORITY_RANK = { Low: 1, Medium: 2, High: 3 };

const taskSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  notes: { type: String, default: "", maxlength: 1000 },
  category: { type: String, default: "Personal", enum: ["Work", "Study", "Health", "Personal", "Other"] },
  priority: { type: String, default: "Medium", enum: ["Low", "Medium", "High"] },
  priorityRank: { type: Number, default: 2 },
  dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

taskSchema.pre("validate", function setRank(next) {
  this.priorityRank = PRIORITY_RANK[this.priority] || 2;
  next();
});

taskSchema.index({ user: 1, dueDate: 1, completed: 1 });
taskSchema.index({ user: 1, completed: 1, priorityRank: -1, createdAt: -1 });

const Task = mongoose.model("Task", taskSchema);
Task.PRIORITY_RANK = PRIORITY_RANK;

// One-off backfill for tasks created before priorityRank existed. Safe to run on every boot.
Task.backfillPriorityRank = async function backfillPriorityRank() {
  for (const [priority, rank] of Object.entries(PRIORITY_RANK)) {
    await Task.updateMany({ priority, priorityRank: { $ne: rank } }, { $set: { priorityRank: rank } });
  }
};

module.exports = Task;
