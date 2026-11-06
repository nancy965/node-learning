const expenseService = require("../services/expenseService");

const getCategories = async (req, res, next) => {
  try {
    const categories = await expenseService.getCategories();
    res.status(200).json({ success: true, categories });
  } catch (err) {
    next(err);
  }
};

const updateCategoryLimits = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await expenseService.updateCategoryLimits(id, req.body, req.user);
    res.status(200).json({ success: true, message: "Category limits updated.", category });
  } catch (err) {
    next(err);
  }
};

const createClaim = async (req, res, next) => {
  try {
    const claim = await expenseService.createClaim(req.body, req.user, req.files || []);
    res.status(201).json({
      success: true,
      message: `Expense claim ${claim.claim_code} submitted successfully.`,
      claim,
    });
  } catch (err) {
    next(err);
  }
};

const getClaims = async (req, res, next) => {
  try {
    const result = await expenseService.getClaims(req.user, req.query);
    res.status(200).json({
      success: true,
      claims: result.claims,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

const getClaimById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await expenseService.getClaimById(id, req.user);
    res.status(200).json({ success: true, claim });
  } catch (err) {
    next(err);
  }
};

const approveClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await expenseService.approveClaim(id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: `Expense claim ${claim.claim_code} approved successfully.`,
      claim,
    });
  } catch (err) {
    next(err);
  }
};

const rejectClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await expenseService.rejectClaim(id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: `Expense claim ${claim.claim_code} has been rejected.`,
      claim,
    });
  } catch (err) {
    next(err);
  }
};

const settleClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await expenseService.settleClaim(id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: `Expense claim ${claim.claim_code} marked as reimbursed.`,
      claim,
    });
  } catch (err) {
    next(err);
  }
};

const deleteClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await expenseService.deleteClaim(id, req.user);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

const getExpenseStats = async (req, res, next) => {
  try {
    const scope = req.query.scope || "all";
    const stats = await expenseService.getExpenseStats(req.user, scope);
    res.status(200).json({ success: true, stats });
  } catch (err) {
    next(err);
  }
};

const initiateInstantPayout = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await expenseService.initiateInstantPayout(id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: result.payout?.message || `Instant payout completed for ${result.claim.claim_code}.`,
      claim: result.claim,
      payout: result.payout,
    });
  } catch (err) {
    next(err);
  }
};

const getMyBankDetails = async (req, res, next) => {
  try {
    const details = await expenseService.getMyBankDetails(req.user);
    res.status(200).json({ success: true, details });
  } catch (err) {
    next(err);
  }
};

const saveMyBankDetails = async (req, res, next) => {
  try {
    const details = await expenseService.saveMyBankDetails(req.user, req.body);
    res.status(200).json({
      success: true,
      message: "Bank and payout details saved successfully.",
      details,
    });
  } catch (err) {
    next(err);
  }
};

const getEmployeeBankDetailsById = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const details = await expenseService.getEmployeeBankDetailsById(employeeId, req.user);
    res.status(200).json({ success: true, details });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};

