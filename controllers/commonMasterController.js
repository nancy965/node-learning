const commonMasterService = require("../services/commonMasterService");

const getAllCommonMaster = async (req, res, next) => {
  try {
    const data = await commonMasterService.getAllMasterRecords();
    return res.status(200).json({
      success: true,
      message: "Common master records retrieved successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
};

const getCommonMasterByType = async (req, res, next) => {
  try {
    const { type } = req.params;
    const data = await commonMasterService.getMasterRecordsByType(type);
    return res.status(200).json({
      success: true,
      message: `Common master records for ${type} retrieved successfully`,
      data,
    });
  } catch (error) {
    next(error);
  }
};

const createCommonMaster = async (req, res, next) => {
  try {
    const { type, name } = req.body;
    const userId = req.user?.userId || null;
    const result = await commonMasterService.addMasterRecord(type, name, userId);

    return res.status(result.status || (result.success ? 201 : 400)).json(result);
  } catch (error) {
    next(error);
  }
};

const updateCommonMaster = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user?.userId || null;
    const result = await commonMasterService.updateMasterRecord(id, name, userId);

    return res.status(result.status || (result.success ? 200 : 400)).json(result);
  } catch (error) {
    next(error);
  }
};

const deleteCommonMaster = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || null;
    const result = await commonMasterService.deleteMasterRecord(id, userId);

    return res.status(result.status || (result.success ? 200 : 400)).json(result);
  } catch (error) {
    next(error);
  }
};

const toggleCommonMasterStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || null;
    const result = await commonMasterService.toggleMasterStatus(id, userId);

    return res.status(result.status || (result.success ? 200 : 400)).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllCommonMaster,
  getCommonMasterByType,
  createCommonMaster,
  updateCommonMaster,
  deleteCommonMaster,
  toggleCommonMasterStatus,
};
