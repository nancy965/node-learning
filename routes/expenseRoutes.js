const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authMiddleware");
const expenseUpload = require("../middleware/expenseUploadMiddleware");

const {
  getCategories,
  updateCategoryLimits,
  createClaim,
  getClaims,
  getClaimById,
  approveClaim,
  rejectClaim,
  settleClaim,
  deleteClaim,
  getExpenseStats,
  initiateInstantPayout,
  getMyBankDetails,
  saveMyBankDetails,
  getEmployeeBankDetailsById,
} = require("../controllers/expenseController");

// All routes require authentication
router.use(authenticateToken);

// Employee Bank & Payout Details
router.get("/bank-details", getMyBankDetails);
router.post("/bank-details", saveMyBankDetails);
router.get("/bank-details/:employeeId", getEmployeeBankDetailsById);

// Category routes
router.get("/categories", getCategories);
router.put("/categories/:id", updateCategoryLimits);

// Stats
router.get("/stats", getExpenseStats);

// Claims CRUD & listing
router.get("/claims", getClaims);
router.get("/claims/:id", getClaimById);
router.post("/claims", expenseUpload.array("receipts", 5), createClaim);
router.delete("/claims/:id", deleteClaim);

// Admin workflow actions
router.patch("/claims/:id/approve", approveClaim);
router.patch("/claims/:id/reject", rejectClaim);
router.patch("/claims/:id/settle", settleClaim);
router.post("/claims/:id/instant-payout", initiateInstantPayout);
router.patch("/claims/:id/instant-payout", initiateInstantPayout);

module.exports = router;

