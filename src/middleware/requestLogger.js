const logger = require('../utils/logger');

// Fields that should be masked in logs
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'authorization',
  'api-key',
  'x-api-key',
  'secret',
  'key',
  'credential',
  'cookie'
];

// Function to mask sensitive data
const maskSensitiveData = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = { ...obj };
  for (const key in masked) {
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field))) {
      // For Authorization header, keep the token type (Bearer) but mask the token
      if (key.toLowerCase() === 'authorization' && typeof masked[key] === 'string') {
        const [type, token] = masked[key].split(' ');
        masked[key] = `${type} ********`;
      } else {
        masked[key] = '********';
      }
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }
  return masked;
};

// Request logger middleware
const requestLogger = (req, res, next) => {
  // Log request details
  console.log("headers",  req.headers);
  console.log("body", JSON.stringify(req.body));
  
  const requestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    headers: maskSensitiveData(req.headers),
    query: req.query,
    body: maskSensitiveData(req.body),
    ip: req.ip,
    userAgent: req.get('user-agent')
  };

  // Log the request
  logger.info('Incoming Request', requestLog);

  // Log response details
  const originalSend = res.send;
  res.send = function (body) {
    const responseLog = {
      timestamp: new Date().toISOString(),
      statusCode: res.statusCode,
      responseTime: Date.now() - requestLog.timestamp,
      body: maskSensitiveData(body)
    };

    logger.info('Outgoing Response', responseLog);
    return originalSend.call(this, body);
  };

  next();
};

module.exports = requestLogger; 