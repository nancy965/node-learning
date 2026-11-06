const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

const {
  getAdPlatforms,
  getAdPlatformById,
  addAdPlatform,
  updateAdPlatform,
  deleteAdPlatform,
} = require("../controllers/adPlatformController");

router.get(
  PATHS.AD_PLATFORMS.GET_ALL_PLATFORMS,
  authenticateToken,
  checkPermission("ad_platforms.view"),
  getAdPlatforms
);

router.get(
  PATHS.AD_PLATFORMS.GET_PLATFORM_BY_ID,
  authenticateToken,
  checkPermission("ad_platforms.view"),
  getAdPlatformById
);

router.post(
  PATHS.AD_PLATFORMS.CREATE_PLATFORM,
  authenticateToken,
  checkPermission("ad_platforms.create"),
  addAdPlatform
);

router.put(
  PATHS.AD_PLATFORMS.UPDATE_PLATFORM,
  authenticateToken,
  checkPermission("ad_platforms.edit"),
  updateAdPlatform
);

router.delete(
  PATHS.AD_PLATFORMS.DELETE_PLATFORM,
  authenticateToken,
  checkPermission("ad_platforms.delete"),
  deleteAdPlatform
);

module.exports = router;