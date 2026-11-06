const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getPincodes,
  getPincodesByCity,
  getPincodeLocation,
  getPincodeById,
  createPincode,
  updatePincode,
  deletePincode,
  activatePincode,
  getPincodesByState,
  getPincodesByCountry,
} = require("../controllers/pincodeController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.PINCODES.GET_ALL_PINCODES,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodes
);

router.get(
  PATHS.PINCODES.GET_PINCODES_BY_CITY,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodesByCity
);

router.get(
  PATHS.PINCODES.LOOKUP_PINCODE,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodeLocation
);

router.get(
  PATHS.PINCODES.GET_PINCODE_BY_ID,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodeById
);

router.get(
  PATHS.PINCODES.GET_PINCODES_BY_STATE,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodesByState
);

router.get(
  PATHS.PINCODES.GET_PINCODES_BY_COUNTRY,
  authenticateToken,
  checkPermission("pincodes.view"),
  getPincodesByCountry
);

router.post(
  PATHS.PINCODES.CREATE_PINCODE,
  authenticateToken,
  checkPermission("pincodes.create"),
  createPincode
);

router.put(
  PATHS.PINCODES.UPDATE_PINCODE,
  authenticateToken,
  checkPermission("pincodes.edit"),
  updatePincode
);

router.delete(
  PATHS.PINCODES.DELETE_PINCODE,
  authenticateToken,
  checkPermission("pincodes.delete"),
  deletePincode
);

router.patch(
  PATHS.PINCODES.ACTIVATE_PINCODE,
  authenticateToken,
  checkPermission("pincodes.activate"),
  activatePincode
);

module.exports = router;