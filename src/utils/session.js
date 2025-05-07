const { verify } = require('jsonwebtoken');
const logger = require('./logger');

const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key';

/**
 * Validates a session key (JWT) and returns the associated userId if valid
 * @param {string} sessionKey - The JWT session key to validate
 * @returns {string|null} - The userId if valid, null if invalid
 */
function validateSessionKey(sessionKey) {
  try {
    const decoded = verify(sessionKey, SESSION_SECRET, { algorithms: ['HS256'] });
    return decoded.userId;
  } catch (error) {
    logger.error('Error validating session key:', error);
    return null;
  }
}

module.exports = {
  validateSessionKey
}; 