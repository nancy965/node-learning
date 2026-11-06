// Tracks permissions that have been revoked during a specific login session
// Key: `${userId}_${iat}`, Value: Set of revoked permission strings
const revokedSessions = new Map();

const getRevokedForSession = (userId, iat) => {
    if (!userId || !iat) {
        return new Set();
    }
    const key = `${userId}_${iat}`;
    if (!revokedSessions.has(key)) {
        revokedSessions.set(key, new Set());
    }
    return revokedSessions.get(key);
};

const recordRevokedPermissions = (userId, iat, permsArray) => {
    if (!userId || !iat || !Array.isArray(permsArray)) {
        return;
    }
    const set = getRevokedForSession(userId, iat);
    permsArray.forEach(p => set.add(p));
};

module.exports = {
    getRevokedForSession,
    recordRevokedPermissions
};
