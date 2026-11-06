
const dashboardService = require("../services/dashboardService");
const pool = require("../config/databse");
const ExcelJS = require("exceljs");

const getDashboardStats = async (req, res, next) => {
  try {
    const {
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const result = await dashboardService.getDashboardStats(
      userId,
      userRole,
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getDashboardUsers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const result = await dashboardService.getDashboardUsers(
      userId,
      userRole,
      Number(page),
      Number(limit),
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const exportDashboardUsers = async (req, res, next) => {
  try {
    const {
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const filters = {
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth:
        newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
};

    const [
      dashboardStats,
      dashboardUsers,
      recentActivity,
      needsAttention,
      systemHealth,
      permissionCoverage,
    ] = await Promise.all([
      dashboardService.getDashboardStats(
        userId,
        userRole,
        status,
        search,
        role,
        permissionRole,
        fromDate,
        toDate,
        filters.newThisMonth,
  filters.adminId,
  filters.employeeId
),

      dashboardService.getDashboardUsers(
        userId,
        userRole,
        1,
        100000,
        status,
        search,
        role,
        permissionRole,
        fromDate,
        toDate,
        filters.newThisMonth,
  filters.adminId,
  filters.employeeId
),

      dashboardService.getRecentActivity(
        100000,
        filters,
        userId,
        userRole,
      ),

      dashboardService.getNeedsAttention(
        userId,
        userRole,
        filters,
      ),

      dashboardService.getSystemHealth(
        userId,
        userRole,
      ),

      dashboardService.getPermissionCoverage(
        filters,
        userId,
        userRole,
      ),
    ]);

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "User Dashboard";
    workbook.lastModifiedBy = "User Dashboard";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("User Dashboard Report", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const borderStyle = {
      top: {
        style: "thin",
        color: { argb: "FFD9E1F2" },
      },
      left: {
        style: "thin",
        color: { argb: "FFD9E1F2" },
      },
      bottom: {
        style: "thin",
        color: { argb: "FFD9E1F2" },
      },
      right: {
        style: "thin",
        color: { argb: "FFD9E1F2" },
      },
    };

    const titleStyle = {
      font: {
        bold: true,
        size: 18,
        color: { argb: "FFFFFFFF" },
      },
      alignment: {
        horizontal: "center",
        vertical: "middle",
      },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E78" },
      },
    };

    const sectionStyle = {
      font: {
        bold: true,
        size: 12,
        color: { argb: "FFFFFFFF" },
      },
      alignment: {
        horizontal: "left",
        vertical: "middle",
      },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" },
      },
    };

    const headerStyle = {
      font: {
        bold: true,
        color: { argb: "FFFFFFFF" },
      },
      alignment: {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF5B9BD5" },
      },
      border: borderStyle,
    };

    const cellStyle = {
      alignment: {
        vertical: "middle",
        wrapText: true,
      },
      border: borderStyle,
    };

    const addSectionTitle = (title) => {
      const row = worksheet.addRow([title]);

      worksheet.mergeCells(
        row.number,
        1,
        row.number,
        12,
      );

      row.height = 24;

      row.eachCell((cell) => {
        cell.style = sectionStyle;
      });

      return row;
    };

    const addHeader = (headers) => {
      const row = worksheet.addRow(headers);

      row.height = 30;

      row.eachCell((cell) => {
        cell.style = headerStyle;
      });

      return row;
    };

    const addDataRow = (values) => {
      const row = worksheet.addRow(values);

      row.eachCell((cell) => {
        cell.style = cellStyle;
      });

      return row;
    };

    const formatDate = (value) => {
      if (!value) {
        return "";
      }

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return date;
    };

    const formatValue = (value) => {
      if (value === null || value === undefined) {
        return "";
      }

      if (typeof value === "object") {
        return JSON.stringify(value);
      }

      return value;
    };

    const safeArray = (value) => {
      if (Array.isArray(value)) {
        return value;
      }

      return [];
    };

    const stats = dashboardStats || {};
    const users = safeArray(dashboardUsers?.users);
    const activities = Array.isArray(recentActivity)
      ? recentActivity
      : safeArray(recentActivity?.activities || recentActivity?.data);

    const attentionItems = Array.isArray(needsAttention)
      ? needsAttention
      : safeArray(
          needsAttention?.items ||
            needsAttention?.data ||
            needsAttention?.needsAttention,
        );

    const healthItems = Array.isArray(systemHealth)
      ? systemHealth
      : safeArray(
          systemHealth?.checks ||
            systemHealth?.data ||
            systemHealth?.systemHealth,
        );

    const coverageItems = Array.isArray(permissionCoverage)
      ? permissionCoverage
      : safeArray(
          permissionCoverage?.data ||
            permissionCoverage?.coverage ||
            permissionCoverage?.items,
        );

    worksheet.mergeCells("A1:L1");

    const titleRow = worksheet.getRow(1);

    titleRow.getCell(1).value = "USER DASHBOARD REPORT";
    titleRow.height = 32;

    titleRow.eachCell((cell) => {
      cell.style = titleStyle;
    });

    worksheet.addRow([]);

    addSectionTitle("Export Information");

    addHeader([
      "Field",
      "Value",
    ]);

    addDataRow([
      "Exported For Role",
      userRole,
    ]);

    addDataRow([
      "Exported At",
      new Date(),
    ]);

    worksheet.lastRow.getCell(2).numFmt =
      "dd-mmm-yyyy hh:mm:ss";

    addDataRow([
      "Status Filter",
      status,
    ]);

    addDataRow([
      "Search",
      search || "All",
    ]);

    addDataRow([
      "Role Filter",
      role,
    ]);

    addDataRow([
      "Permission Role",
      permissionRole,
    ]);

    addDataRow([
      "From Date",
      fromDate || "All",
    ]);

    addDataRow([
      "To Date",
      toDate || "All",
    ]);

    addDataRow([
      "New This Month",
      filters.newThisMonth ? "Yes" : "No",
    ]);

    worksheet.addRow([]);

    addSectionTitle("Dashboard Summary");

    addHeader([
      "Metric",
      "Value",
    ]);

    const summary = stats.stats || stats.summary || {};

    const summaryEntries = [
      ["Total Users", summary.totalUsers ?? stats.totalUsers ?? 0],
      ["Active Users", summary.activeUsers ?? stats.activeUsers ?? 0],
      ["Inactive Users", summary.inactiveUsers ?? stats.inactiveUsers ?? 0],
      ["Total Admins", summary.totalAdmins ?? stats.totalAdmins ?? 0],
      ["Total Employees", summary.totalEmployees ?? stats.totalEmployees ?? 0],
      ["New Users", summary.newUsers ?? stats.newUsers ?? 0],
    ];

    summaryEntries.forEach(([label, value]) => {
      addDataRow([label, formatValue(value)]);
    });

    worksheet.addRow([]);

    addSectionTitle("User Details");

    addHeader([
      "ID",
      "Name",
      "Email",
      "Age",
      "Country",
      "State",
      "City",
      "Pincode",
      "Role",
      "Permission Role",
      "Status",
      "Created At",
    ]);


users.forEach((user) => {
  const row = addDataRow([
    user.id !== null && user.id !== undefined
      ? String(user.id)
      : "",
    formatValue(user.name),
    formatValue(user.email),
    user.age !== null && user.age !== undefined
      ? String(user.age)
      : "",
    formatValue(user.country_name),
    formatValue(user.state_name),
    formatValue(user.city_name),
    formatValue(user.pincode),
    formatValue(user.role),
    formatValue(user.permission_role),
    user.is_active ? "Active" : "Inactive",
    formatDate(user.created_at),
  ]);

  row.getCell(1).numFmt = "@";
  row.getCell(4).numFmt = "@";
  row.getCell(12).numFmt = "dd-mmm-yyyy hh:mm:ss";
});




    if (users.length === 0) {
      addDataRow([
        "",
        "No users found for the selected filters.",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Status Overview");

    addHeader([
      "Status",
      "Count",
      "Percentage",
    ]);

    const statusDistribution =
      stats.statusDistribution ||
      stats.statusOverview ||
      [];

    safeArray(statusDistribution).forEach((item) => {
      addDataRow([
        formatValue(
          item.status ||
            item.name ||
            item.label,
        ),
        formatValue(
          item.count ??
            item.total ??
            item.value ??
            0,
        ),
        item.percentage !== undefined
          ? `${item.percentage}%`
          : "",
      ]);
    });

    if (safeArray(statusDistribution).length === 0) {
      addDataRow([
        "No data",
        0,
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Role Distribution");

    addHeader([
      "Role",
      "Count",
      "Percentage",
    ]);

    const roleDistribution =
      stats.roleDistribution || [];

    safeArray(roleDistribution).forEach((item) => {
      addDataRow([
        formatValue(
          item.role ||
            item.name ||
            item.label,
        ),
        formatValue(
          item.count ??
            item.total ??
            item.value ??
            0,
        ),
        item.percentage !== undefined
          ? `${item.percentage}%`
          : "",
      ]);
    });

    if (safeArray(roleDistribution).length === 0) {
      addDataRow([
        "No data",
        0,
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Permission Roles");

    addHeader([
      "Permission Role",
      "Count",
      "Percentage",
    ]);

    const permissionRoleDistribution =
      stats.permissionRoleDistribution || [];

    safeArray(permissionRoleDistribution).forEach((item) => {
      addDataRow([
        formatValue(
          item.permission_role ||
            item.permissionRole ||
            item.role ||
            item.name ||
            item.label,
        ),
        formatValue(
          item.count ??
            item.total ??
            item.value ??
            0,
        ),
        item.percentage !== undefined
          ? `${item.percentage}%`
          : "",
      ]);
    });

    if (
      safeArray(permissionRoleDistribution).length === 0
    ) {
      addDataRow([
        "No data",
        0,
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Registration Trend");

    addHeader([
      "Date",
      "Count",
      "Percentage",
    ]);

    const registrationTrend =
      stats.registrationTrend || [];

    safeArray(registrationTrend).forEach((item) => {
      const row = addDataRow([
        formatDate(
          item.date ||
            item.created_at ||
            item.day,
        ),
        formatValue(
          item.count ??
            item.total ??
            item.value ??
            0,
        ),
        item.percentage !== undefined
          ? `${item.percentage}%`
          : "",
      ]);

      if (row.getCell(1).value instanceof Date) {
        row.getCell(1).numFmt = "dd-mmm-yyyy";
      }
    });

    if (safeArray(registrationTrend).length === 0) {
      addDataRow([
        "No data",
        0,
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Permission Coverage");

    addHeader([
      "Identifier",
      "Identifier Name",
      "Operation",
      "Assigned",
      "Available",
      "Coverage",
    ]);

    coverageItems.forEach((item) => {
      addDataRow([
        formatValue(
          item.identifier ||
            item.identifier_name ||
            item.identifierId,
        ),
        formatValue(
          item.name ||
            item.identifier_name,
        ),
        formatValue(
          item.operation ||
            item.permission,
        ),
        formatValue(
          item.assigned ??
            item.granted ??
            item.assignedCount ??
            0,
        ),
        formatValue(
          item.available ??
            item.total ??
            item.availableCount ??
            0,
        ),
        item.coverage !== undefined
          ? `${item.coverage}%`
          : "",
      ]);
    });

    if (coverageItems.length === 0) {
      addDataRow([
        "No data",
        "",
        "",
        0,
        0,
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Recent Activity");

    addHeader([
      "ID",
      "User",
      "Action",
      "Module",
      "Description",
      "IP Address",
      "Created At",
    ]);

    activities.forEach((item) => {
      const row = addDataRow([
        formatValue(item.id),
        formatValue(
          item.user_name ||
            item.username ||
            item.name,
        ),
        formatValue(
          item.action ||
            item.activity,
        ),
        formatValue(
          item.module ||
            item.entity ||
            item.type,
        ),
        formatValue(
          item.description ||
            item.message,
        ),
        formatValue(
          item.ip_address ||
            item.ip,
        ),
        formatDate(
          item.created_at ||
            item.createdAt ||
            item.timestamp,
        ),
      ]);

      row.getCell(7).numFmt =
        "dd-mmm-yyyy hh:mm:ss";
    });

    if (activities.length === 0) {
      addDataRow([
        "",
        "No recent activity found.",
        "",
        "",
        "",
        "",
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Needs Attention");

    addHeader([
      "Type",
      "Title",
      "Description",
      "Status",
      "Priority",
      "Created At",
    ]);

    attentionItems.forEach((item) => {
      const row = addDataRow([
        formatValue(
          item.type ||
            item.category,
        ),
        formatValue(
          item.title ||
            item.name,
        ),
        formatValue(
          item.description ||
            item.message,
        ),
        formatValue(item.status),
        formatValue(item.priority),
        formatDate(
          item.created_at ||
            item.createdAt,
        ),
      ]);

      row.getCell(6).numFmt =
        "dd-mmm-yyyy hh:mm:ss";
    });

    if (attentionItems.length === 0) {
      addDataRow([
        "No data",
        "No items require attention.",
        "",
        "",
        "",
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("System Health");

    addHeader([
      "Component",
      "Status",
      "Message",
      "Details",
    ]);

    healthItems.forEach((item) => {
      addDataRow([
        formatValue(
          item.name ||
            item.component ||
            item.service,
        ),
        formatValue(
          item.status ||
            item.health,
        ),
        formatValue(
          item.message ||
            item.description,
        ),
        formatValue(
          item.details ||
            item.response,
        ),
      ]);
    });

    if (healthItems.length === 0) {
      addDataRow([
        "No data",
        "",
        "",
        "",
      ]);
    }

    worksheet.addRow([]);

    addSectionTitle("Exported Records");

    addHeader([
      "Record Type",
      "Count",
    ]);

    addDataRow([
      "Users",
      users.length,
    ]);

    addDataRow([
      "Recent Activity",
      activities.length,
    ]);

    addDataRow([
      "Needs Attention",
      attentionItems.length,
    ]);

    addDataRow([
      "System Health Checks",
      healthItems.length,
    ]);

    addDataRow([
      "Permission Coverage",
      coverageItems.length,
    ]);

    const columnWidths = {
  1: 22,
  2: 24,
  3: 32,
  4: 12,
  5: 22,
  6: 22,
  7: 22,
  8: 18,
  9: 20,
  10: 22,
  11: 16,
  12: 24,
};
    Object.entries(columnWidths).forEach(
      ([column, width]) => {
        worksheet.getColumn(Number(column)).width =
          width;
      },
    );

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.border || !cell.border.top) {
          cell.border = borderStyle;
        }

        if (!cell.alignment) {
          cell.alignment = {
            vertical: "middle",
            wrapText: true,
          };
        }
      });
    });

    worksheet.autoFilter = {
      from: "A1",
      to: "L1",
    };

    const buffer = await workbook.xlsx.writeBuffer();

const filenameParts = [];

if (search.trim()) {
  filenameParts.push(search.trim());
}

if (status && status !== "all") {
  filenameParts.push(
    status.charAt(0).toUpperCase() + status.slice(1),
  );
}

if (role && role !== "all") {
  filenameParts.push(role);
}

if (permissionRole && permissionRole !== "all") {
  filenameParts.push(permissionRole);
}

if (fromDate && toDate) {
  filenameParts.push(`${fromDate}_to_${toDate}`);
} else if (fromDate) {
  filenameParts.push(`from_${fromDate}`);
} else if (toDate) {
  filenameParts.push(`to_${toDate}`);
}

if (filters.newThisMonth) {
  filenameParts.push("New_This_Month");
}

    let targetPersonName = "";
    if (employeeId) {
      try {
        const empRes = await pool.query("SELECT name FROM users WHERE id = $1", [employeeId]);
        if (empRes.rows[0]?.name) {
          targetPersonName = empRes.rows[0].name.trim();
        }
      } catch (e) {
        console.error("Error looking up employee name for export:", e);
      }
    } else if (adminId) {
      try {
        const admRes = await pool.query(
          "SELECT name FROM admin WHERE id = $1 UNION SELECT name FROM users WHERE id = $1",
          [adminId]
        );
        if (admRes.rows[0]?.name) {
          targetPersonName = admRes.rows[0].name.trim();
        }
      } catch (e) {
        console.error("Error looking up admin name for export:", e);
      }
    }

    let filename = "user dashboard.xlsx";
    if (targetPersonName) {
      filename = `user dashboard ${targetPersonName.toLowerCase()}.xlsx`;
    } else if (filterName) {
      filename = `user dashboard ${filterName.toLowerCase()}.xlsx`;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition",
    );

    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

const getRecentActivity = async (req, res, next) => {
  try {
    const {
      limit = 8,
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const filters = {
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth:
        newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
};

    const result = await dashboardService.getRecentActivity(
      Number(limit),
      filters,
      userId,
      userRole,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getNeedsAttention = async (req, res, next) => {
  try {
    const {
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const filters = {
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth:
        newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
};

    const result = await dashboardService.getNeedsAttention(
      userId,
      userRole,
      filters,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getSystemHealth = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    const result = await dashboardService.getSystemHealth(
      userId,
      userRole,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getPermissionCoverage = async (req, res, next) => {
  try {
    const {
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const userId = req.user.userId;
    const userRole = req.user.role;

    const filters = {
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth:
        newThisMonth === "true" || newThisMonth === true,
  adminId,
  employeeId
};

    const result =
      await dashboardService.getPermissionCoverage(
        filters,
        userId,
        userRole,
      );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};


const getSmartUserInsights = async (req, res) => {
  try {
    const {
      status = "all",
      search = "",
      role: roleFilter = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = "false",
      adminId = "",
      employeeId = "",
      limit = "5",
    } = req.query;

    const insights = await dashboardService.getSmartUserInsights(
      req.user.userId,
      req.user.role,
      {
        status,
        search,
        role: roleFilter,
        permissionRole,
        fromDate,
        toDate,
        newThisMonth: newThisMonth === "true",
        adminId,
        employeeId,
      },
      Number(limit) || 5,
    );

    return res.status(200).json({
      success: true,
      message: "Smart user insights retrieved successfully",
      data: insights,
    });
  } catch (error) {
    console.error("Smart user insights error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve smart user insights",
    });
  }
};

const getDashboardOverview = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 5,
      status = "all",
      search = "",
      role = "all",
      permissionRole = "all",
      fromDate = "",
      toDate = "",
      newThisMonth = false,
  adminId = "",
  employeeId = "",
} = req.query;

    const filters = {
      status,
      search,
      role,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth:
        newThisMonth === true || newThisMonth === "true",
  adminId,
  employeeId
};

    const result = await dashboardService.getDashboardOverview(
      req.user.userId,
      req.user.role,
      Number(page),
      Number(limit),
      filters,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching dashboard overview:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard overview",
    });
  }
};

module.exports = {
  getDashboardStats,
  getDashboardUsers,
  exportDashboardUsers,
  getRecentActivity,
  getNeedsAttention,
  getSystemHealth,
  getPermissionCoverage,
  getDashboardOverview,
  getSmartUserInsights,
};
