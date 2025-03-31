require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');

// Initialize Express app
const app = express();

app.use(express.json());


// API routes
app.use('/api/v1/users/:user/heartbeats', require('./routes/heartbeats'));
app.use('/api/v1/users/current/heartbeats', require('./routes/heartbeats'));
app.use('/api/v1/users/:user/heartbeats.bulk', require('./routes/heartbeats'));
app.use('/api/v1/users/current/heartbeats.bulk', require('./routes/heartbeats'));



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app; 