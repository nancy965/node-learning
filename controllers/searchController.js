const { searchGlobalRecords } = require("../services/searchService");

const globalSearch = async (req, res, next) => {
  try {
    const query = req.query.q || "";
    const user = req.user;

    const data = await searchGlobalRecords(query, user);

    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Global search error:", error);
    next(error);
  }
};

module.exports = {
  globalSearch,
};
