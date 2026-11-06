

const pincodeService = require("../services/pincodeService");
const { decodeUUIDToId } = require("../utils/uuidUtils");

const getPincodes = async (
  req,
  res
) => {
  try {
    const hasPagination =
      req.query.page !== undefined ||
      req.query.limit !== undefined ||
      req.query.search !== undefined ||
      req.query.status !== undefined;

    if (!hasPagination) {
      const pincodes =
        await pincodeService.getPincodes();

      return res.status(200).json({
        success: true,
        pincodes,
      });
    }

    const page = Math.max(
      parseInt(
        req.query.page,
        10
      ) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(
          req.query.limit,
          10
        ) || 50,
        1
      ),
      500
    );

    const search =
      req.query.search || "";

    const status =
      req.query.status || "all";

    const result =
      await pincodeService.getPincodes(
        page,
        limit,
        search,
        status
      );

    return res.status(200).json({
      success: true,
      pincodes: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords:
          result.totalRecords,
        totalPages:
          result.totalPages,
      },
    });
  } catch (error) {
    console.error(
      "Get pincodes error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to fetch pincodes.",
    });
  }
};

const getPincodeById = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const result =
      await pincodeService.getPincodeById(
        id
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(200).json({
      success: true,
      pincode: result.pincode,
    });
  } catch (error) {
    console.error(
      "Get pincode error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to fetch pincode.",
    });
  }
};

const createPincode = async (
  req,
  res
) => {
  try {
    console.log(
      "REQ USER:",
      req.user
    );

    let {
      city_id,
      cityId,
      pincode,
      is_active,
    } = req.body;
    let targetCityId = city_id || cityId;
    if (typeof targetCityId === "string" && targetCityId.includes("-")) {
      targetCityId = decodeUUIDToId(targetCityId);
    }

    const created_by =
      req.user?.userId;

    const result =
      await pincodeService.createPincode(
        targetCityId,
        pincode,
        is_active ?? true,
        created_by
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(result.status).json({
      success: true,
      message: result.message,
      pincode: result.pincode,
    });
  } catch (error) {
    console.error(
      "Create pincode error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to create pincode.",
    });
  }
};

const updatePincode = async (
  req,
  res
) => {
  try {
    let { id } = req.params;
    if (typeof id === "string" && id.includes("-")) {
      id = decodeUUIDToId(id);
    }

    let {
      city_id,
      cityId,
      pincode,
      is_active,
    } = req.body;
    let targetCityId = city_id || cityId;
    if (typeof targetCityId === "string" && targetCityId.includes("-")) {
      targetCityId = decodeUUIDToId(targetCityId);
    }

    const result =
      await pincodeService.updatePincode(
        id,
        targetCityId,
        pincode,
        is_active ?? true
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(result.status).json({
      success: true,
      message: result.message,
      pincode: result.pincode,
    });
  } catch (error) {
    console.error(
      "Update pincode error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to update pincode.",
    });
  }
};

const deletePincode = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const result =
      await pincodeService.deletePincode(
        id
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(result.status).json({
      success: true,
      message: result.message,
      pincode: result.pincode,
    });
  } catch (error) {
    console.error(
      "Delete pincode error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to deactivate pincode.",
    });
  }
};

const activatePincode = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const result =
      await pincodeService.activatePincode(
        id
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(result.status).json({
      success: true,
      message: result.message,
      pincode: result.pincode,
    });
  } catch (error) {
    console.error(
      "Activate pincode error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to activate pincode.",
    });
  }
};

const getPincodesByCity = async (req, res, next) => {
  try {
    const { cityId } = req.params;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search || "";

    const result = await pincodeService.getPincodesByCity(
      cityId,
      page,
      limit,
      search
    );

    res.status(200).json({
      success: true,
      message: "Pincodes fetched successfully",
      data: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPincodeLocation = async (
  req,
  res
) => {
  try {
    const { pincode } = req.params;

    const result =
      await pincodeService.getPincodeLocation(
        pincode
      );

    if (!result.success) {
      return res
        .status(result.status)
        .json({
          success: false,
          message:
            result.message,
        });
    }

    res.status(200).json({
      success: true,
      location: result.location,
    });
  } catch (error) {
    console.error(
      "Get pincode location error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to find pincode location.",
    });
  }
};

const getPincodesByState = async (req, res, next) => {
  try {
    const { stateId } = req.params;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search || "";

    const result = await pincodeService.getPincodesByState(
      stateId,
      page,
      limit,
      search
    );

    res.status(200).json({
      success: true,
      message: "Pincodes fetched successfully",
      data: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPincodesByCountry = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search || "";

    const result =
      await pincodeService.getPincodesByCountry(
        countryId,
        page,
        limit,
        search
      );

    res.status(200).json({
      success: true,
      message: "Pincodes fetched successfully",
      data: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPincodes,
  getPincodeById,
  createPincode,
  updatePincode,
  deletePincode,
  activatePincode,
  getPincodesByCity,
  getPincodeLocation,
  getPincodesByState,
  getPincodesByCountry,
};
