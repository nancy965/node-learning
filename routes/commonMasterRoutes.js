const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");
const authenticateToken = require("../middleware/authMiddleware");

const {
  getAllCommonMaster,
  getCommonMasterByType,
  createCommonMaster,
  updateCommonMaster,
  deleteCommonMaster,
  toggleCommonMasterStatus,
} = require("../controllers/commonMasterController");

router.get(
  PATHS.COMMON_MASTER.GET_ALL,
  authenticateToken,
  getAllCommonMaster
);

router.get(
  PATHS.COMMON_MASTER.GET_BY_TYPE,
  authenticateToken,
  getCommonMasterByType
);

router.post(
  PATHS.COMMON_MASTER.CREATE,
  authenticateToken,
  createCommonMaster
);

router.put(
  PATHS.COMMON_MASTER.UPDATE,
  authenticateToken,
  updateCommonMaster
);

router.delete(
  PATHS.COMMON_MASTER.DELETE,
  authenticateToken,
  deleteCommonMaster
);

router.patch(
  PATHS.COMMON_MASTER.TOGGLE_STATUS,
  authenticateToken,
  toggleCommonMasterStatus
);

module.exports = router;
