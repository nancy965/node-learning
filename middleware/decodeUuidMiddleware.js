const { decodeUUIDToId } = require('../utils/uuidUtils');

function decodeUuidMiddleware(req, res, next) {
    // Decode req.params.id if it exists and looks like our UUID
    if (req.params) {
        for (const key in req.params) {
            if (req.params[key] && typeof req.params[key] === 'string' && req.params[key].includes('-')) {
                const decoded = decodeUUIDToId(req.params[key]);
                if (decoded !== req.params[key]) {
                    req.params[key] = decoded;
                }
            }
        }
    }
    
    // We should also decode req.body if the frontend sends the UUID as ID in body during updates
    // But we need to be careful not to decode actual string fields that happen to look like UUIDs.
    // Usually, frontend sends `id` in the URL for updates.
    // If they send `id` in the body (e.g. for bulk add or relationships), maybe we should decode specifically `id`, `user_id`, etc.
    const keysToDecode = ['id', 'user_id', 'role_id', 'country_id', 'state_id', 'city_id', 'pincode_id', 'admin_id', 'assigned_to'];
    
    if (req.body && typeof req.body === 'object') {
        for (const key of keysToDecode) {
            if (req.body[key] && typeof req.body[key] === 'string' && req.body[key].includes('-')) {
                req.body[key] = decodeUUIDToId(req.body[key]);
            }
        }
    }

    if (req.query) {
        for (const key in req.query) {
            if (req.query[key] && typeof req.query[key] === 'string' && req.query[key].includes('-')) {
                req.query[key] = decodeUUIDToId(req.query[key]);
            }
        }
    }

    next();
}

module.exports = decodeUuidMiddleware;
