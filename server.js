require("dotenv").config();

const app = require("./app");
// const { generateDailyTasks } =
 require("./jobs/taskScheduler");

const initDatabaseChangeApproval = require("./utils/initDatabaseChangeApproval");
initDatabaseChangeApproval().catch((err) => console.error("DB Change Schema Init Warning:", err.message));

const initTaskDependencies = require("./utils/initTaskDependencies");
initTaskDependencies().catch((err) => console.error("Task Dependencies Schema Init Warning:", err.message));

const initEmailCenterSchema = require("./utils/initEmailCenterSchema");
initEmailCenterSchema().catch((err) => console.error("Email Center Schema Init Warning:", err.message));

const initExpenseSchema = require("./utils/initExpenseSchema");
initExpenseSchema().catch((err) => console.error("Expense Schema Init Warning:", err.message));

const initLeaveManagementSchema = require("./utils/initLeaveManagementSchema");
initLeaveManagementSchema().catch((err) => console.error("Leave Management Schema Init Warning:", err.message));

app.listen(process.env.PORT || 5000, () => {
  console.log(
    `Server running on http://localhost:${process.env.PORT || 5000}`
  );
});

// generateDailyTasks();
