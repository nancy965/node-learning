const {
    getNavigationByRole
} = require("../services/navigationService");

const getNavigation = async (req, res) => {
    try {
        const navigation = await getNavigationByRole(req.user.role, req.user.userId);

        return res.status(200).json({
            success: true,
            data: navigation
        });
    } catch (error) {
        console.error("Navigation error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load navigation"
        });
    }
};

module.exports = {
    getNavigation
};