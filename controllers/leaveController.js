const leaveService = require("../services/leaveService");

const checkIsAdmin = (user) => {
  const role = (user?.role || "").toLowerCase().trim().replace(/\s+/g, "_");
  return role === "admin" || role === "general_admin" || role === "super_admin";
};

const checkIsGeneralAdmin = (user) => {
  const role = (user?.role || "").toLowerCase().trim().replace(/\s+/g, "_");
  const email = (user?.email || "").toLowerCase().trim();
  return (
    role === "general_admin" ||
    role === "super_admin" ||
    email === "nency@gmail.com"
  );
};

/**
 * 1. Get all active leave types
 */
const getLeaveTypes = async (req, res) => {
  try {
    const types = await leaveService.getLeaveTypes();
    return res.status(200).json({
      success: true,
      data: types,
    });
  } catch (err) {
    console.error("GET LEAVE TYPES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leave types",
    });
  }
};

/**
 * 2. Get company holidays
 */
const getCompanyHolidays = async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const holidays = await leaveService.getCompanyHolidays(year);
    return res.status(200).json({
      success: true,
      data: holidays,
    });
  } catch (err) {
    console.error("GET COMPANY HOLIDAYS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company holidays",
    });
  }
};

/**
 * 3. Calculate working days between dates
 */
const calculateWorkingDays = async (req, res) => {
  try {
    const startDate = req.body.startDate || req.body.start_date;
    const endDate = req.body.endDate || req.body.end_date || startDate;
    if (!startDate) {
      return res.status(400).json({
        success: false,
        message: "Start date is required",
      });
    }

    const calculation = await leaveService.calculateWorkingDays(
      startDate,
      endDate,
    );
    return res.status(200).json({
      success: true,
      data: calculation,
    });
  } catch (err) {
    console.error("CALCULATE WORKING DAYS ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to calculate working days",
    });
  }
};

/**
 * 4. Get current user's leave balances
 */
const getMyLeaveBalances = async (req, res) => {
  try {
    const employeeId = req.user.userId || req.user.registerId || req.user.id;
    const year = req.query.year || new Date().getFullYear();

    const data = await leaveService.getEmployeeLeaveBalances(employeeId, year);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("GET MY LEAVE BALANCES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leave balances",
    });
  }
};

/**
 * 5. Get specific employee's leave balance (Admin view)
 */
const getEmployeeLeaveBalances = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const year = req.query.year || new Date().getFullYear();

    const data = await leaveService.getEmployeeLeaveBalances(employeeId, year);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("GET EMPLOYEE LEAVE BALANCES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch employee leave balances",
    });
  }
};

/**
 * 6. Check overlapping leave
 */
const checkOverlap = async (req, res) => {
  try {
    const employeeId = req.user.userId || req.user.registerId || req.user.id;
    const startDate = req.body.startDate || req.body.start_date;
    const endDate = req.body.endDate || req.body.end_date || startDate;
    const excludeRequestId =
      req.body.excludeRequestId || req.body.exclude_request_id;

    if (!startDate) {
      return res.status(400).json({
        success: false,
        message: "Start date is required",
      });
    }

    const overlapData = await leaveService.checkOverlappingLeave(
      employeeId,
      startDate,
      endDate,
      excludeRequestId,
    );

    return res.status(200).json({
      success: true,
      data: overlapData,
    });
  } catch (err) {
    console.error("CHECK OVERLAP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to check overlapping leave",
    });
  }
};

/**
 * 7. Apply for Leave (Employee side)
 */
const applyLeave = async (req, res) => {
  try {
    const employeeId = req.user.userId || req.user.registerId || req.user.id;
    const employeeName =
      req.user.name || req.user.email?.split("@")[0] || "Employee";
    const employeeEmail = req.user.email || "";
    const employeeRole = req.user.role || "employee";

    const employeeData = {
      employeeId,
      employeeName,
      employeeEmail,
      employeeRole,
    };

    const newRequest = await leaveService.applyLeave(employeeData, req.body);
    return res.status(201).json({
      success: true,
      message: "Leave application submitted successfully",
      data: newRequest,
    });
  } catch (err) {
    console.error("APPLY LEAVE ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to apply for leave",
    });
  }
};

/**
 * 8. Get current employee's leave requests
 */
const getMyRequests = async (req, res) => {
  try {
    const employeeId = req.user.userId || req.user.registerId || req.user.id;
    const { status, year, search } = req.query;

    const requests = await leaveService.getMyLeaveRequests(employeeId, {
      status,
      year,
      search,
    });

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (err) {
    console.error("GET MY REQUESTS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leave requests",
    });
  }
};

/**
 * 9. Cancel a pending leave request
 */
const cancelRequest = async (req, res) => {
  try {
    const employeeId = req.user.userId || req.user.registerId || req.user.id;
    const { id } = req.params;

    const cancelled = await leaveService.cancelLeaveRequest(employeeId, id);
    return res.status(200).json({
      success: true,
      message: "Leave request cancelled successfully",
      data: cancelled,
    });
  } catch (err) {
    console.error("CANCEL LEAVE REQUEST ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to cancel leave request",
    });
  }
};

/**
 * 10. Get leave request by ID
 */
const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await leaveService.getLeaveRequestById(id);
    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (err) {
    console.error("GET LEAVE REQUEST BY ID ERROR:", err);
    return res.status(404).json({
      success: false,
      message: err.message || "Leave request not found",
    });
  }
};

/**
 * 11. Get leave transaction ledger
 */
const getLeaveTransactions = async (req, res) => {
  try {
    const isGeneralAdmin = checkIsGeneralAdmin(req.user);

    const employeeId = isGeneralAdmin
      ? req.query.employeeId || null
      : req.user.userId || req.user.registerId || req.user.id;

    const year = req.query.year || null;
    const { transactionType, leaveTypeId, search } = req.query;

    const transactions = await leaveService.getLeaveTransactions(
      employeeId,
      year,
      { transactionType, leaveTypeId, search },
    );

    return res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (err) {
    console.error("GET LEAVE TRANSACTIONS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leave transactions",
    });
  }
};

/**
 * 12. Get all leave requests for Admin
 */
const getAdminRequests = async (req, res) => {
  try {
    const isAdmin = checkIsAdmin(req.user) || false || false;

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin access required",
      });
    }

    const { status, year, search, leaveTypeId, employeeId } = req.query;
    const requests = await leaveService.getAllLeaveRequests({
      status,
      year,
      search,
      leaveTypeId,
      employeeId,
    });

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (err) {
    console.error("GET ADMIN LEAVE REQUESTS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin leave requests",
    });
  }
};

/**
 * 13. Get Admin Leave Stats
 */
const getAdminStats = async (req, res) => {
  try {
    const isAdmin = checkIsAdmin(req.user) || false || false;

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin access required",
      });
    }

    const { year } = req.query;
    const stats = await leaveService.getAdminLeaveStats(year);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error("GET ADMIN LEAVE STATS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin leave statistics",
    });
  }
};

/**
 * 14. Admin Decide on Leave Request (Approve / Reject)
 */
const decideRequest = async (req, res) => {
  try {
    const isAdmin = checkIsAdmin(req.user) || false || false;

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin access required",
      });
    }

    const adminId = req.user.userId || req.user.registerId;
    const adminName = req.user.name || req.user.email?.split("@")[0] || "Admin";
    const { id } = req.params;

    const result = await leaveService.decideLeaveRequest(
      { adminId, adminName },
      id,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: `Leave request ${result.request_code} has been ${result.status.toLowerCase()} successfully`,
      data: result,
    });
  } catch (err) {
    console.error("ADMIN DECIDE LEAVE ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to process leave decision",
    });
  }
};

/**
 * 15. Get Team Leave Calendar & Availability Matrix (Step 6)
 */
const getTeamCalendar = async (req, res) => {
  try {
    const { year, month, leaveTypeId, employeeId, search } = req.query;
    const calendarData = await leaveService.getTeamLeaveCalendar(year, month, {
      leaveTypeId,
      employeeId,
      search,
    });

    return res.status(200).json({
      success: true,
      data: calendarData,
    });
  } catch (err) {
    console.error("GET TEAM LEAVE CALENDAR ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch team leave calendar",
    });
  }
};

/**
 * 16. Admin Adjust Employee Leave Balance (Step 4 & 5)
 */
const adjustBalance = async (req, res) => {
  try {
    const isGeneralAdmin = checkIsGeneralAdmin(req.user);

    if (!isGeneralAdmin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only General Admin can manually adjust leave balances",
      });
    }

    const adminId = req.user.userId || req.user.registerId;
    const adminName = req.user.name || req.user.email?.split("@")[0] || "Admin";

    const result = await leaveService.adjustEmployeeLeaveBalance(
      { adminId, adminName },
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Leave balance adjusted successfully",
      data: result,
    });
  } catch (err) {
    console.error("ADJUST LEAVE BALANCE ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to adjust leave balance",
    });
  }
};

module.exports = {
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
};
