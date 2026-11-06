const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");

const {
    getNavigation
} = require("../controllers/navigationController");

router.get(
    PATHS.NAVIGATION.GET_ALL,
    authenticateToken,
    getNavigation
);

module.exports = router;