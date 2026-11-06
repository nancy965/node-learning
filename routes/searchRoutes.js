const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");
const { globalSearch } = require("../controllers/searchController");

router.get(
  PATHS.SEARCH.GLOBAL,
  authenticateToken,
  globalSearch
);

module.exports = router;
