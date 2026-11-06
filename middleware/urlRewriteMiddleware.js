const { decodeUUIDToId } = require('../utils/uuidUtils');

function urlRewriteMiddleware(req, res, next) {
    // Check if the URL contains a UUID-like string
    // A UUID format from our hashids mapping is like 8-4-4-4-12 hex chars
    // Regex for our mapped UUID: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
    const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    
    if (uuidRegex.test(req.url)) {
        req.url = req.url.replace(uuidRegex, (match) => {
            const decoded = decodeUUIDToId(match);
            return decoded; // Replace UUID with integer ID
        });
        
        // Also update req.originalUrl if needed, but usually modifying req.url is enough for Express routing
    }
    
    next();
}

module.exports = urlRewriteMiddleware;
