const {
  getTaskAnalyticsOverview,
  getOverdueTasksAnalytics,
  getTaskExplorer,
  exportTaskAnalytics,
} = require("../services/analyticsService");
const pool = require("../config/databse");

const getTaskAnalyticsOverviewController = async (req, res) => {
  try {
    let userId = req.user.userId;
    const role = req.user.role;
    let baseRole = req.user.baseRole;

    if (baseRole === "employee") {
      const userResult = await pool.query(
        "SELECT admin_id FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].admin_id;
        baseRole = "admin";
      }
    }

    const dateRange = req.query.dateRange;
    const employeeId = req.query.employeeId;
    const taskType = req.query.taskType;
    const status = req.query.status;
    const customFrom = req.query.customFrom;
    const customTo = req.query.customTo;

    const result = await getTaskAnalyticsOverview(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo
    );

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("GET TASK ANALYTICS OVERVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const getOverdueTasksAnalyticsController = async (req, res) => {
  try {
    let userId = req.user.userId;
    const role = req.user.role;
    let baseRole = req.user.baseRole;

    if (baseRole === "employee") {
      const userResult = await pool.query(
        "SELECT admin_id FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].admin_id;
        baseRole = "admin";
      }
    }

    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search;
    const filter = req.query.filter;
    const dateRange = req.query.dateRange;
    const employeeId = req.query.employeeId;
    const taskType = req.query.taskType;
    const status = req.query.status;
    const customFrom = req.query.customFrom;
    const customTo = req.query.customTo;

    const result = await getOverdueTasksAnalytics(
      role,
      baseRole,
      userId,
      {
        page,
        limit,
        search,
        startDate: customFrom,
        endDate: customTo,
        employeeId: employeeId,
        type: taskType,
        status: status,
      }
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("GET OVERDUE TASKS ANALYTICS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const exportTaskAnalyticsController = async (req, res) => {
  try {
    let userId = req.user.userId;
    const role = req.user.role;
    let baseRole = req.user.baseRole;

    if (baseRole === "employee") {
      const userResult = await pool.query(
        "SELECT admin_id FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].admin_id;
        baseRole = "admin";
      }
    }

    const dateRange = req.query.dateRange;
    const employeeId = req.query.employeeId;
    const taskType = req.query.taskType;
    const status = req.query.status;
    const customFrom = req.query.customFrom;
    const customTo = req.query.customTo;

    const result = await exportTaskAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo
    );

    if (!result.success) {
      return res.status(result.status).json(result);
    }

    const date = new Date().toISOString().split("T")[0];

    const safeEmployeeName = result.employeeName
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    const fileName = `Task_Analytics_${safeEmployeeName}_${date}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition"
    );

    return res.send(result.data);
  } catch (error) {
    console.error("EXPORT TASK ANALYTICS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to export task analytics",
    });
  }
};

const getTaskExplorerController = async (req, res) => {
  try {
    let userId = req.user.userId;
    const role = req.user.role;
    let baseRole = req.user.baseRole;

    if (baseRole === "employee") {
      const userResult = await pool.query(
        "SELECT admin_id FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].admin_id;
        baseRole = "admin";
      }
    }

    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search;
    const employeeId = req.query.employeeId;
    const taskType = req.query.taskType;
    const status = req.query.status;
    const dateRange = req.query.dateRange;
    const customFrom = req.query.customFrom;
    const customTo = req.query.customTo;

    const result = await getTaskExplorer(
      userId,
      role,
      baseRole,
      page,
      limit,
      search,
      employeeId,
      taskType,
      status,
      dateRange,
      customFrom,
      customTo
    );

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("GET TASK EXPLORER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = {
  getTaskAnalyticsOverviewController,
  getOverdueTasksAnalyticsController,
  getTaskExplorerController,
  exportTaskAnalyticsController,
};