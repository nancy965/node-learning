//Runs before the controller(checks JWT authentication, authorization, validation)
const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({
                message: "Access denied"
            });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: "You do not have permission to perform this action"
            });
        }
        next();
    };
};
module.exports = authorizeRole;