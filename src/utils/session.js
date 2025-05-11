const { verify } = require('jsonwebtoken');
const logger = require('./logger');

const SESSION_SECRET = process.env.SESSION_SECRET ;
if (!SESSION_SECRET) throw new Error('SESSION_SECRET not defined') 
console.log("SESSION_SECRET",SESSION_SECRET);

/**
 * Validates a session key (JWT) and returns the associated userId if valid
 * @param {string} sessionKey - The JWT session key to validate
 * @returns {string|null} - The userId if valid, null if invalid
 */
function validateSessionKey(sessionKey) {
  try {
    const decoded = verify(sessionKey, SESSION_SECRET, { algorithms: ['HS256'] });
    console.log("decoded",decoded);
    return decoded.userId;
  } catch (error) {
    logger.error('Error validating session key:', error);
    return null;
  }
}

module.exports = {
  validateSessionKey
}; 