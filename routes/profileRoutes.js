const express = require("express");

const router = express.Router();

const PATHS = require("../config/path.config");

const {
  getProfile,
  updateProfile,
  changeProfilePassword,
} = require("../controllers/profileController");

const authenticateToken = require("../middleware/authMiddleware");

router.get(
  PATHS.PROFILE.GET_PROFILE,
  authenticateToken,
  getProfile
);

router.put(
  PATHS.PROFILE.UPDATE_PROFILE,
  authenticateToken,
  updateProfile
);

router.put(
  PATHS.PROFILE.CHANGE_PASSWORD,
  authenticateToken,
  changeProfilePassword
);

module.exports = router;