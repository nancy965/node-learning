const { encodeIdToUUID, decodeUUIDToId } = require('../utils/uuidUtils');

function recursiveEncode(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
        obj.forEach(item => recursiveEncode(item));
        return;
    }

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const isIdKey =
                key === 'id' ||
                key.endsWith('_id') ||
                key.endsWith('Id') ||
                key.endsWith('_ids') ||
                key.endsWith('Ids') ||
                key === 'assigned_to' ||
                key === 'assignedTo';
            
            // Encode id fields
            if (isIdKey) {
                if (typeof obj[key] === 'number') {
                    obj[key] = encodeIdToUUID(obj[key]);
                } else if (Array.isArray(obj[key])) {
                    obj[key] = obj[key].map(item => (typeof item === 'number' ? encodeIdToUUID(item) : item));
                }
            } else if (typeof obj[key] === 'object') {
                recursiveEncode(obj[key]);
            }
        }
    }
}

function recursiveDecode(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
        obj.forEach(item => recursiveDecode(item));
        return;
    }

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const isIdKey =
                key === 'id' ||
                key.endsWith('_id') ||
                key.endsWith('Id') ||
                key.endsWith('_ids') ||
                key.endsWith('Ids') ||
                key === 'assigned_to' ||
                key === 'assignedTo';
            
            if (isIdKey) {
                if (typeof obj[key] === 'string' && obj[key].includes('-')) {
                    obj[key] = decodeUUIDToId(obj[key]);
                } else if (Array.isArray(obj[key])) {
                    obj[key] = obj[key].map(item => (typeof item === 'string' && item.includes('-') ? decodeUUIDToId(item) : item));
                }
            } else if (typeof obj[key] === 'object') {
                recursiveDecode(obj[key]);
            }
        }
    }
}

function encodeDecodeUuidMiddleware(req, res, next) {
    // Decode incoming request
    if (req.params) recursiveDecode(req.params);
    if (req.body) recursiveDecode(req.body);
    if (req.query) recursiveDecode(req.query);

    // Intercept response to encode IDs
    const originalJson = res.json;
    res.json = function (body) {
        if (body) {
            recursiveEncode(body);
        }
        return originalJson.call(this, body);
    };

    next();
}

module.exports = encodeDecodeUuidMiddleware;
