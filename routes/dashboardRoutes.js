
const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getDashboardStats,
  getDashboardUsers,
  exportDashboardUsers,
  getRecentActivity,
  getNeedsAttention,
  getSystemHealth,
  getPermissionCoverage,
  getDashboardOverview,
  getSmartUserInsights,
} = require("../controllers/dashboardController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.DASHBOARD.STATS,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getDashboardStats,
);

router.get(
  PATHS.DASHBOARD.USERS,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getDashboardUsers,
);

router.get(
  PATHS.DASHBOARD.EXPORT_USERS,
  authenticateToken,
  checkPermission("user_dashboard.export"),
  exportDashboardUsers,
);

router.get(
  PATHS.DASHBOARD.RECENT_ACTIVITY,
  authenticateToken,
  checkPermission("activity_logs.view"),
  getRecentActivity,
);

router.get(
  PATHS.DASHBOARD.NEEDS_ATTENTION,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getNeedsAttention,
);

router.get(
  PATHS.DASHBOARD.SYSTEM_HEALTH,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getSystemHealth,
);

router.get(
  PATHS.DASHBOARD.PERMISSION_COVERAGE,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getPermissionCoverage,
);

router.get(
  PATHS.DASHBOARD.OVERVIEW,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getDashboardOverview,
);

router.get(
  PATHS.DASHBOARD.SMART_INSIGHTS,
  authenticateToken,
  checkPermission("user_dashboard.view"),
  getSmartUserInsights,
);

module.exports = router;
