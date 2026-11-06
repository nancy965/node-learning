
const express = require("express");

const router = express.Router();

const PATHS = require("../config/path.config");

const activityLogController = require("../controllers/activityLogController");

const authenticateToken = require("../middleware/authMiddleware");

const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.ACTIVITY_LOGS.GET_ALL,
  authenticateToken,
  checkPermission("activity_logs.view"),
  activityLogController.getActivityLogs
);

router.get(
  "/:userId/history",
  authenticateToken,
  checkPermission("activity_logs.view"),
  activityLogController.getUserActivityHistory
);

module.exports = router;