const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getCountries,
  getActiveCountries,
  getCountryById,
  createCountry,
  updateCountry,
  deleteCountry,
  activateCountry,
} = require("../controllers/countryController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.COUNTRIES.GET_ALL_COUNTRIES,
  authenticateToken,
  checkPermission("countries.view"),
  getCountries
);

router.get(
  PATHS.COUNTRIES.GET_ACTIVE_COUNTRIES,
  authenticateToken,
  checkPermission("countries.view"),
  getActiveCountries
);

router.get(
  PATHS.COUNTRIES.GET_COUNTRY_BY_ID,
  authenticateToken,
  checkPermission("countries.view"),
  getCountryById
);

router.post(
  PATHS.COUNTRIES.CREATE_COUNTRY,
  authenticateToken,
  checkPermission("countries.create"),
  createCountry
);

router.put(
  PATHS.COUNTRIES.UPDATE_COUNTRY,
  authenticateToken,
  checkPermission("countries.edit"),
  updateCountry
);

router.delete(
  PATHS.COUNTRIES.DELETE_COUNTRY,
  authenticateToken,
  checkPermission("countries.delete"),
  deleteCountry
);

router.patch(
  PATHS.COUNTRIES.ACTIVATE_COUNTRY,
  authenticateToken,
  checkPermission("countries.activate"),
  activateCountry
);

module.exports = router;