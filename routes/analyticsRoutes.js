const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

const {
  getTaskAnalyticsOverviewController,
  getOverdueTasksAnalyticsController,
  getTaskExplorerController,
  exportTaskAnalyticsController,
} = require("../controllers/analyticsController");

router.get(
  PATHS.ANALYTICS.OVERVIEW,
  authenticateToken,
  checkPermission("task_analytics.view"),
  getTaskAnalyticsOverviewController
);

router.get(
  PATHS.ANALYTICS.OVERDUE_TASKS,
  authenticateToken,
  checkPermission("task_analytics.view"),
  getOverdueTasksAnalyticsController
);

router.get(
  PATHS.ANALYTICS.TASK_EXPLORER,
  authenticateToken,
  checkPermission("task_analytics.view"),
  getTaskExplorerController
);

router.get(
  PATHS.ANALYTICS.EXPORT,
  authenticateToken,
  checkPermission("task_analytics.export"),
  exportTaskAnalyticsController
);

module.exports = router;