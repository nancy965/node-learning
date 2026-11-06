const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getStates,
  getStatesByCountry,
  getStateLocation,
  getStateById,
  createState,
  updateState,
  deleteState,
  activateState,
} = require("../controllers/stateController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.STATES.GET_ALL_STATES,
  authenticateToken,
  checkPermission("states.view"),
  getStates
);

router.get(
  PATHS.STATES.GET_STATES_BY_COUNTRY,
  authenticateToken,
  checkPermission("states.view"),
  getStatesByCountry
);

router.get(
  PATHS.STATES.LOOKUP_STATE,
  authenticateToken,
  checkPermission("states.view"),
  getStateLocation
);

router.get(
  PATHS.STATES.GET_STATE_BY_ID,
  authenticateToken,
  checkPermission("states.view"),
  getStateById
);

router.post(
  PATHS.STATES.CREATE_STATE,
  authenticateToken,
  checkPermission("states.create"),
  createState
);

router.put(
  PATHS.STATES.UPDATE_STATE,
  authenticateToken,
  checkPermission("states.edit"),
  updateState
);

router.delete(
  PATHS.STATES.DELETE_STATE,
  authenticateToken,
  checkPermission("states.delete"),
  deleteState
);

router.patch(
  PATHS.STATES.ACTIVATE_STATE,
  authenticateToken,
  checkPermission("states.activate"),
  activateState
);

module.exports = router;