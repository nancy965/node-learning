const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authMiddleware");

const {
  getLeaveTypes,
  getCompanyHolidays,
  calculateWorkingDays,
  getMyLeaveBalances,
  getEmployeeLeaveBalances,
  checkOverlap,
  applyLeave,
  getMyRequests,
  cancelRequest,
  getRequestById,
  getLeaveTransactions,
  getAdminRequests,
  getAdminStats,
  decideRequest,
  getTeamCalendar,
  adjustBalance,
} = require("../controllers/leaveController");

// All routes require authentication
router.use(authenticateToken);

// 1. Leave Types & Holidays
router.get("/types", getLeaveTypes);
router.get("/holidays", getCompanyHolidays);

// 2. Working days calculator & overlap validation
router.post("/calculate-days", calculateWorkingDays);
router.post("/check-overlap", checkOverlap);

// 3. Leave Balances
router.get("/balances", getMyLeaveBalances);
router.get("/balances/:employeeId", getEmployeeLeaveBalances);

// 4. Employee Applications & History
router.post("/apply", applyLeave);
router.get("/my-requests", getMyRequests);
router.get("/requests/:id", getRequestById);
router.patch("/requests/:id/cancel", cancelRequest);

// 5. Audit ledger transactions
router.get("/transactions", getLeaveTransactions);

// 6. Team Calendar & Availability Matrix (Step 6)
router.get("/calendar", getTeamCalendar);

// 7. Admin Endpoints
router.get("/admin/requests", getAdminRequests);
router.get("/admin/stats", getAdminStats);
router.patch("/admin/requests/:id/decide", decideRequest);
router.post("/admin/adjust-balance", adjustBalance);

module.exports = router;
