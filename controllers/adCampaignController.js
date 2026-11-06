const adCampaignService = require("../services/adCampaignService");

const getAdCampaigns = async (req, res, next) => {
  try {
    const campaigns = await adCampaignService.getAdCampaigns();

    return res.status(200).json({
      success: true,
      message: "Ad campaigns fetched successfully",
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};

const getAdCampaignById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await adCampaignService.getAdCampaignById(id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Ad campaign not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad campaign fetched successfully",
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

const addAdCampaign = async (req, res, next) => {
  try {
    const {
      name,
      description,
      objective,
      platform_id,
      start_date,
      end_date,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    if (!objective || !objective.trim()) {
      return res.status(400).json({
        success: false,
        message: "Campaign objective is required",
      });
    }

    if (!platform_id) {
      return res.status(400).json({
        success: false,
        message: "Ad platform is required",
      });
    }

    if (!start_date) {
      return res.status(400).json({
        success: false,
        message: "Start date is required",
      });
    }

    if (end_date && end_date < start_date) {
      return res.status(400).json({
        success: false,
        message: "End date cannot be before start date",
      });
    }

    const result = await adCampaignService.addAdCampaign(
      {
        name: name.trim(),
        description: description?.trim() || null,
        objective: objective.trim(),
        platform_id,
        start_date,
        end_date: end_date || null,
      },
      req.user.userId,
    );

    return res.status(result.status).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdCampaigns,
  getAdCampaignById,
  addAdCampaign,
};