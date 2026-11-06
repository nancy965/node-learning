const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  registerUser,
  loginUser,
  getCurrentUser,
  changePassword,
  refreshAccess,
  logoutUser,
} = require("../controllers/authController");

const authenticateToken = require("../middleware/authMiddleware");

router.post("/logout", logoutUser);
router.post(PATHS.AUTH.REGISTER, registerUser);
router.post(PATHS.AUTH.LOGIN, loginUser);

router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Auth route is working",
    });
});

router.get(PATHS.AUTH.GET_CURRENT_USER, authenticateToken, getCurrentUser);

router.get(PATHS.AUTH.PROTECTED_TEST, authenticateToken, (req, res) => {
  res.status(200).json({
    message: "Access granted",
    user: req.user,
  });
});

router.get("/me", authenticateToken, getCurrentUser);
router.post("/refresh-access", authenticateToken, refreshAccess);

router.get('/check-permission/:permission', authenticateToken, (req, res, next) => { 
  require('../middleware/permissionMiddleware')(req.params.permission)(req, res, next);
}, (req, res) => res.status(200).json({ hasAccess: true }));

module.exports = router;
