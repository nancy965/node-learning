const express = require("express");
const cors = require("cors");

const PATHS = require("./config/path.config");

const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const taskRoutes = require("./routes/taskRoutes");
const chatRoutes = require("./routes/chatRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const activityLogRoutes = require("./routes/activityLogRoutes");
const countryRoutes = require("./routes/countryRoutes");
const stateRoutes = require("./routes/stateRoutes");
const cityRoutes = require("./routes/cityRoutes");
const pincodeRoutes = require("./routes/pincodeRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const adPlatformRoutes = require("./routes/adPlatformRoutes");
const adCampaignRoutes = require("./routes/adCampaignRoutes");
const navigationRoutes = require("./routes/navigationRoutes");
const userPermissionRoutes = require("./routes/userPermissionRoutes");
const rolePermissionRoutes = require("./routes/rolePermissionRoutes");

const profileRoutes = require("./routes/profileRoutes");
const commonMasterRoutes = require("./routes/commonMasterRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const lifecycleRoutes = require("./routes/lifecycleRoutes");
const searchRoutes = require("./routes/searchRoutes");
const databaseApprovalRoutes = require("./routes/databaseApprovalRoutes");
const emailRoutes = require("./routes/emailRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const leaveRoutes = require("./routes/leaveRoutes");

const errorMiddleware = require("./middleware/errorMiddleware");
const loggingMiddleware = require("./middleware/loggingMiddleware");
const path = require("path");
const encodeDecodeUuidMiddleware = require("./middleware/encodeDecodeUuidMiddleware");
const urlRewriteMiddleware = require("./middleware/urlRewriteMiddleware");

const app = express();

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "EMS Backend is running successfully",
  });
});

app.use(
  cors({
    origin: true,
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(loggingMiddleware);
app.use(urlRewriteMiddleware);
app.use(encodeDecodeUuidMiddleware);

app.use(PATHS.BASE_PREFIX + PATHS.AUTH.BASE, authRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.PROFILE.BASE, profileRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.USERS.BASE, userRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.ADMINS.BASE, userRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.TASKS.BASE, taskRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.NAVIGATION.BASE, navigationRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.ACTIVITY_LOGS.BASE, activityLogRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.NOTIFICATIONS.BASE, notificationRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.COUNTRIES.BASE, countryRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.STATES.BASE, stateRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.CITIES.BASE, cityRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.PINCODES.BASE, pincodeRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.CHAT.BASE, chatRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.ANALYTICS.BASE, analyticsRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.DASHBOARD.BASE, dashboardRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.AD_PLATFORMS.BASE, adPlatformRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.AD_CAMPAIGNS.BASE, adCampaignRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.USER_PERMISSIONS.BASE, userPermissionRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.ROLE_PERMISSIONS.BASE, rolePermissionRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.COMMON_MASTER.BASE, commonMasterRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.TICKETS.BASE, ticketRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.APPROVALS.BASE, approvalRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.LIFECYCLE.BASE, lifecycleRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.SEARCH.BASE, searchRoutes);

app.use(
  PATHS.BASE_PREFIX + PATHS.DATABASE_APPROVALS.BASE,
  databaseApprovalRoutes,
);

app.use(PATHS.BASE_PREFIX + PATHS.EMAILS.BASE, emailRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.EXPENSES.BASE, expenseRoutes);

app.use(PATHS.BASE_PREFIX + PATHS.LEAVES.BASE, leaveRoutes);

app.use(errorMiddleware);

module.exports = app;
