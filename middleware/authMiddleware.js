// Runs before the controller and checks JWT authentication.

const jwt = require("jsonwebtoken");

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                message: "Authorization token is required"
            });
        }

        const parts = authHeader.split(" ");

        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(401).json({
                message: "Invalid authorization format"
            });
        }

        const token = parts[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // Use role, roleId, and permissions directly from the JWT (set at login time).
        // Permission changes only take effect after the user logs out and logs back in.
        req.user = {
            userId: decoded.userId,
            registerId: decoded.registerId,
            role: decoded.role,
            baseRole: decoded.baseRole,
            roleId: decoded.roleId,
            permissions: decoded.permissions || [],
            isMasterLogin: Boolean(decoded.isMasterLogin),
            iat: decoded.iat
        };

        // Keep user presence alive while making authenticated requests
        try {
            const presenceService = require("../services/presenceService");
            presenceService.setUserOnline(decoded.userId, decoded.email);
            if (decoded.registerId && decoded.registerId !== decoded.userId) {
                presenceService.setUserOnline(decoded.registerId, decoded.email);
            }
        } catch (e) {}

        next();

    } catch (error) {
        console.log(
            "JWT ERROR:",
            error.message
        );

        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
};

module.exports = authenticateToken;