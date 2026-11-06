
const countryService = require("../services/countryService");

// Get all countries / paginated countries
const getCountries = async (req, res, next) => {
  try {
    const hasPagination =
      req.query.page !== undefined ||
      req.query.limit !== undefined ||
      req.query.search !== undefined ||
      req.query.status !== undefined;

    if (!hasPagination) {
      const countries =
        await countryService.getCountries();

      return res.status(200).json({
        success: true,
        message: "Countries fetched successfully",
        data: countries,
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

    const result =
      await countryService.getCountries(
        page,
        limit,
        search,
        status
      );

    res.status(200).json({
      success: true,
      message: "Countries fetched successfully",
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

// Keep everything below this exactly as your current controller:

const getCountryById = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result =
      await countryService.getCountryById(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "Country fetched successfully",
      data: result.country,
    });
  } catch (error) {
    next(error);
  }
};

const createCountry = async (req, res, next) => {
  try {

    const { name, is_active = true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Country name is required",
      });
    }

    const countryName = String(name).trim();

    if (!countryName) {
      return res.status(400).json({
        success: false,
        message: "Country name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(countryName)) {
      return res.status(400).json({
        success: false,
        message: "Country name should contain only letters",
      });
    }

    const result =
      await countryService.createCountry(
        countryName,
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
      data: result.country,
    });
  } catch (error) {
    next(error);
  }
};

const updateCountry = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { name, is_active = true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Country name is required",
      });
    }

    const countryName = String(name).trim();

    if (!countryName) {
      return res.status(400).json({
        success: false,
        message: "Country name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(countryName)) {
      return res.status(400).json({
        success: false,
        message: "Country name should contain only letters",
      });
    }

    const result = await countryService.updateCountry(
      id,
      countryName,
      is_active,
      req.user.userId
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
      data: result.country,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCountry = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result =
      await countryService.deleteCountry(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.country,
    });
  } catch (error) {
    next(error);
  }
};

const activateCountry = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result =
      await countryService.activateCountry(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.country,
    });
  } catch (error) {
    next(error);
  }
};

const getActiveCountries = async (req, res, next) => {
  try {
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
      await countryService.getActiveCountries(
        page,
        limit,
        search
      );

    res.status(200).json({
      success: true,
      countries: result.rows,
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
  getCountries,
  getCountryById,
  createCountry,
  updateCountry,
  deleteCountry,
  activateCountry,
  getActiveCountries,
};
