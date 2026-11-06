
const stateService = require("../services/stateService");
const { decodeUUIDToId } = require("../utils/uuidUtils");


const getStates = async (req, res, next) => {
  try {
    const hasPagination =
      req.query.page !== undefined ||
      req.query.limit !== undefined ||
      req.query.search !== undefined ||
      req.query.status !== undefined ||
      req.query.countryId !== undefined;

    if (!hasPagination) {
      const states =
        await stateService.getStates();

      return res.status(200).json({
        success: true,
        message: "States fetched successfully",
        data: states,
      });
    }

    const page = Math.max(
      parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 50,
        1
      ),
      500
    );

    const search = req.query.search || "";
    const status = req.query.status || "all";
    const countryId =
      req.query.countryId || "all";

    const result =
      await stateService.getStates(
        page,
        limit,
        search,
        status,
        countryId
      );

    res.status(200).json({
      success: true,
      message: "States fetched successfully",
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


const getStateById = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await stateService.getStateById(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "State fetched successfully",
      data: result.state,
    });
  } catch (error) {
    next(error);
  }
};

const createState = async (req, res, next) => {
  try {
    let { country_id, countryId, name, is_active = true } = req.body;
    let targetCountryId = country_id || countryId;
    if (typeof targetCountryId === "string" && targetCountryId.includes("-")) {
      targetCountryId = decodeUUIDToId(targetCountryId);
    }

    if (!targetCountryId) {
      return res.status(400).json({
        success: false,
        message: "Country is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    const stateName = String(name).trim();

    if (!stateName) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(stateName)) {
      return res.status(400).json({
        success: false,
        message: "State name should contain only letters",
      });
    }

    const result = await stateService.createState(
      targetCountryId,
      stateName,
      is_active,
      req.user.userId
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.state,
    });
  } catch (error) {
    next(error);
  }
};

const updateState = async (req, res, next) => {
  try {
    let id = req.params.id;
    if (typeof id === "string" && id.includes("-")) {
      id = decodeUUIDToId(id);
    }

    let { country_id, countryId, name, is_active = true } = req.body;
    let targetCountryId = country_id || countryId;
    if (typeof targetCountryId === "string" && targetCountryId.includes("-")) {
      targetCountryId = decodeUUIDToId(targetCountryId);
    }

    if (!targetCountryId) {
      return res.status(400).json({
        success: false,
        message: "Country is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    const stateName = String(name).trim();

    if (!stateName) {
      return res.status(400).json({
        success: false,
        message: "State name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(stateName)) {
      return res.status(400).json({
        success: false,
        message: "State name should contain only letters",
      });
    }

    const result = await stateService.updateState(
      id,
      targetCountryId,
      stateName,
      is_active
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.state,
    });
  } catch (error) {
    next(error);
  }
};

const deleteState = async (req, res, next) => {
  try {
   
    const id = req.params.id;

    const result = await stateService.deleteState(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.state,
    });
  } catch (error) {
    next(error);
  }
};

const activateState = async (req, res, next) => {
  try {
    
    const id = req.params.id;

    const result = await stateService.activateState(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.state,
    });
  } catch (error) {
    next(error);
  }
};

const getStatesByCountry = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const page = Math.max(
      parseInt(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit) || 50,
        1
      ),
      500
    );

    const search = req.query.search || "";

    const result =
      await stateService.getStatesByCountry(
        countryId,
        page,
        limit,
        search
      );

    res.status(200).json({
      success: true,
      states: result.rows,
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

const getStateLocation = async (req, res, next) => {
  try {
    const { state } = req.params;

    const result = await stateService.getStateLocation(state);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      location: result.location,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStates,
  getStateById,
  createState,
  updateState,
  deleteState,
  activateState,
  getStatesByCountry,
  getStateLocation,
};
