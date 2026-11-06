const adPlatformService = require("../services/adPlatformService");

const getAdPlatforms = async (req, res, next) => {
  try {
    const platforms = await adPlatformService.getAdPlatforms();

    return res.status(200).json({
      success: true,
      message: "Ad platforms fetched successfully",
      data: platforms,
    });
  } catch (error) {
    next(error);
  }
};

const getAdPlatformById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const platform = await adPlatformService.getAdPlatformById(id);

    if (!platform) {
      return res.status(404).json({
        success: false,
        message: "Ad platform not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad platform fetched successfully",
      data: platform,
    });
  } catch (error) {
    next(error);
  }
};

const addAdPlatform = async (req, res, next) => {
  try {
    const { name, code, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Platform name is required",
      });
    }

    if (!code || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Platform code is required",
      });
    }

    const result = await adPlatformService.addAdPlatform(
      {
        name: name.trim(),
        code: code.trim().toLowerCase(),
        description: description?.trim() || null,
      },
      req.user.userId
    );

    return res.status(result.status).json(result);
  } catch (error) {
    next(error);
  }
};

const updateAdPlatform = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, description, is_active } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Platform name is required",
      });
    }

    if (!code || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Platform code is required",
      });
    }

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "is_active must be true or false",
      });
    }

    const result = await adPlatformService.updateAdPlatform(
      id,
      {
        name: name.trim(),
        code: code.trim().toLowerCase(),
        description: description?.trim() || null,
        is_active,
      },
      req.user.userId
    );

    return res.status(result.status).json(result);
  } catch (error) {
    next(error);
  }
};

const deleteAdPlatform = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await adPlatformService.deleteAdPlatform(
      id,
      req.user.userId
    );

    return res.status(result.status).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdPlatforms,
  getAdPlatformById,
  addAdPlatform,
  updateAdPlatform,
  deleteAdPlatform,
};