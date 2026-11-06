const profileService = require("../services/profileService");

const getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;
    const registerId = req.user.registerId;

    const result = await profileService.getProfile(
      userId,
      role,
      registerId
    );

    if (!result.success) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      message: result.message,
      user: result.user,
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;
    const registerId = req.user.registerId;

    const {
      name,
      age,
      country_id,
      state_id,
      city_id,
      pincode_id,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Name is required",
      });
    }

    const result = await profileService.updateProfile(
      userId,
      role,
      registerId,
      {
        name,
        age,
        country_id,
        state_id,
        city_id,
        pincode_id,
      }
    );

    if (!result.success) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      message: result.message,
      user: result.user,
    });
  } catch (error) {
    console.error("Update profile error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const changeProfilePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;
    const registerId = req.user.registerId;

    const {
      currentPassword,
      newPassword,
      confirmPassword,
    } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message:
          "Current password, new password and confirm password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "New password and confirm password do not match",
      });
    }

    const result = await profileService.changeProfilePassword(
      userId,
      role,
      registerId,
      currentPassword,
      newPassword
    );

    if (!result.success) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      message: result.message,
    });
  } catch (error) {
    console.error("Change profile password error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changeProfilePassword,
};