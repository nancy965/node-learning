const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getCities,
  getCitiesByState,
  getCityById,
  createCity,
  updateCity,
  deleteCity,
  activateCity,
  getCitiesByCountry,
  getCityLocation,
} = require("../controllers/cityController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

router.get(
  PATHS.CITIES.GET_ALL_CITIES,
  authenticateToken,
  checkPermission("cities.view"),
  getCities
);

router.get(
  PATHS.CITIES.GET_CITIES_BY_STATE,
  authenticateToken,
  checkPermission("cities.view"),
  getCitiesByState
);

router.get(
  PATHS.CITIES.GET_CITY_BY_ID,
  authenticateToken,
  checkPermission("cities.view"),
  getCityById
);

router.get(
  PATHS.CITIES.GET_CITIES_BY_COUNTRY,
  authenticateToken,
  checkPermission("cities.view"),
  getCitiesByCountry
);

router.get(
  PATHS.CITIES.LOOKUP_CITY,
  authenticateToken,
  checkPermission("cities.view"),
  getCityLocation
);

router.post(
  PATHS.CITIES.CREATE_CITY,
  authenticateToken,
  checkPermission("cities.create"),
  createCity
);

router.put(
  PATHS.CITIES.UPDATE_CITY,
  authenticateToken,
  checkPermission("cities.edit"),
  updateCity
);

router.delete(
  PATHS.CITIES.DELETE_CITY,
  authenticateToken,
  checkPermission("cities.delete"),
  deleteCity
);

router.patch(
  PATHS.CITIES.ACTIVATE_CITY,
  authenticateToken,
  checkPermission("cities.activate"),
  activateCity
);

module.exports = router;