const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

const {
  getAdCampaigns,
  getAdCampaignById,
  addAdCampaign,
} = require("../controllers/adCampaignController");

router.get(
  PATHS.AD_CAMPAIGNS.GET_ALL_CAMPAIGNS,
  authenticateToken,
  checkPermission("ad_campaigns.view"),
  getAdCampaigns
);

router.get(
  PATHS.AD_CAMPAIGNS.GET_CAMPAIGN_BY_ID,
  authenticateToken,
  checkPermission("ad_campaigns.view"),
  getAdCampaignById
);

router.post(
  PATHS.AD_CAMPAIGNS.CREATE_CAMPAIGN,
  authenticateToken,
  checkPermission("ad_campaigns.create"),
  addAdCampaign
);

module.exports = router;