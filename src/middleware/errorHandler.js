const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err);

  if (err.name === 'ValidationError') {
    return res.status(422).json({
      error: 'Validation Error',
      details: err.details
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      error: 'Resource not found'
    });
  }

  return res.status(500).json({
    error: 'Internal Server Error'
  });
};

module.exports = { errorHandler };
