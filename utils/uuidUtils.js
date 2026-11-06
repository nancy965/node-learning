const Hashids = require('hashids/cjs');
// We use a hex alphabet to simulate a UUID
const hashids = new Hashids(process.env.JWT_SECRET || 'my-secret', 32, 'abcdef0123456789');

function encodeIdToUUID(id) {
    if (!id) return id;
    const hexStr = hashids.encode(id);
    if (!hexStr) return id; // fallback if encoding fails (e.g. string passed)
    // Format as UUID: 8-4-4-4-12
    return `${hexStr.slice(0, 8)}-${hexStr.slice(8, 12)}-${hexStr.slice(12, 16)}-${hexStr.slice(16, 20)}-${hexStr.slice(20, 32)}`;
}

function decodeUUIDToId(uuidStr) {
    if (!uuidStr || typeof uuidStr !== 'string') return uuidStr;
    const hexStr = uuidStr.replace(/-/g, '');
    const decoded = hashids.decode(hexStr);
    return decoded && decoded.length > 0 ? decoded[0] : uuidStr;
}

module.exports = {
    encodeIdToUUID,
    decodeUUIDToId
};
