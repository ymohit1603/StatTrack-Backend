require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const http = require('http');
const url = require('url');
const { authenticateUser } = require('./middleware/auth');
const {
  checkProjectLimit,
  checkApiLimit,
  checkAiLimit,
  checkFileSizeLimit,
  checkConcurrentConnections,
  checkHistoryAccess,
  checkStorageLimit,
  checkCustomReportAccess,
  checkExportAccess
} = require('./middleware/tierLimits');

// Import routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const projectsRoutes = require('./routes/projects');
const heartbeatsRoutes = require('./routes/heartbeats');
const statsRoutes = require('./routes/stats');
const goalsRoutes = require('./routes/goals');
const leaderboardsRoutes = require('./routes/leaderboards');
const reportsRouter = require('./routes/reports');
const insightsRouter = require('./routes/insights');
const statusRouter = require('./routes/status');
const preferencesRouter = require('./routes/preferences');
const aiRouter = require('./routes/ai');
const resourcesRouter = require('./routes/resources');
const { router: collaborationRouter, wsServer } = require('./routes/collaboration');
const subscriptionsRouter = require('./routes/subscriptions');

// Initialize Express app
const app = express();

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD
});

// Make Redis available throughout the app
app.set('redis', redis);

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      fontSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-site" },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}));

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400
}));

// Rate limiting with different tiers
const createRateLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use API key or IP address
    return req.headers['x-api-key'] || req.ip;
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.headers['x-api-key'] || req.ip}`);
    res.status(429).json({
      error: message,
      retry_after: Math.ceil(windowMs / 1000)
    });
  }
});

// Different rate limits for different endpoints
const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100,
  'Too many requests, please try again later'
);

const heartbeatLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  300,
  'Too many heartbeats, please try again later'
);

const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5,
  'Too many authentication attempts, please try again later'
);

// Middleware
app.use(compression({
  level: 6,
  threshold: 100 * 1024 // 100kb
}));
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
    }
  }
}));
app.use(morgan('combined', { 
  stream: { 
    write: message => logger.info(message.trim()) 
  },
  skip: (req) => req.path === '/health' || req.path === '/metrics'
}));

// API version prefix
const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;

// Create HTTP server
const server = http.createServer(app);

// WebSocket upgrade handling
server.on('upgrade', async (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;

  if (pathname === `${API_PREFIX}/collaboration/ws`) {
    try {
      // Authenticate WebSocket connection
      const token = request.headers['sec-websocket-protocol'];
      const user = await authenticateUser(token);
      request.user = user;

      wsServer.handleUpgrade(request, socket, head, (ws) => {
        wsServer.emit('connection', ws, request);
      });
    } catch (error) {
      logger.error('WebSocket authentication failed:', error);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

// Mount routes with tier-based limits
app.use(`${API_PREFIX}/auth`, authLimiter, authRoutes);
app.use(`${API_PREFIX}/heartbeats`, [heartbeatLimiter, checkApiLimit, checkFileSizeLimit, checkStorageLimit], heartbeatsRoutes);
app.use(`${API_PREFIX}/users`, [apiLimiter, checkApiLimit], usersRoutes);
app.use(`${API_PREFIX}/projects`, [apiLimiter, checkApiLimit, checkProjectLimit, checkStorageLimit], projectsRoutes);
app.use(`${API_PREFIX}/stats`, [apiLimiter, checkApiLimit, checkHistoryAccess], statsRoutes);
app.use(`${API_PREFIX}/goals`, [apiLimiter, checkApiLimit], goalsRoutes);
app.use(`${API_PREFIX}/leaderboards`, [apiLimiter, checkApiLimit], leaderboardsRoutes);
app.use(`${API_PREFIX}/reports`, [apiLimiter, checkApiLimit, checkHistoryAccess, checkCustomReportAccess], reportsRouter);
app.use(`${API_PREFIX}/insights`, [apiLimiter, checkApiLimit, checkCustomReportAccess], insightsRouter);
app.use(`${API_PREFIX}/status`, statusRouter);
app.use(`${API_PREFIX}/preferences`, [apiLimiter, checkApiLimit], preferencesRouter);
app.use(`${API_PREFIX}/ai`, [apiLimiter, checkApiLimit, checkAiLimit], aiRouter);
app.use(`${API_PREFIX}/resources`, [apiLimiter, checkApiLimit, checkStorageLimit], resourcesRouter);
app.use(`${API_PREFIX}/collaboration`, [apiLimiter, checkApiLimit, checkConcurrentConnections], collaborationRouter);
app.use(`${API_PREFIX}/subscriptions`, subscriptionsRouter);

// Resource Routes
// Heartbeats
app.get(`${API_PREFIX}/users/:user/heartbeats`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.get(`${API_PREFIX}/users/current/heartbeats`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.post(`${API_PREFIX}/users/:user/heartbeats`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.post(`${API_PREFIX}/users/current/heartbeats`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.post(`${API_PREFIX}/users/:user/heartbeats.bulk`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.post(`${API_PREFIX}/users/current/heartbeats.bulk`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.delete(`${API_PREFIX}/users/:user/heartbeats.bulk`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.delete(`${API_PREFIX}/users/current/heartbeats.bulk`, [apiLimiter, checkApiLimit], heartbeatsRoutes);

// Insights
app.get(`${API_PREFIX}/users/:user/insights/:insight_type/:range`, [apiLimiter, checkApiLimit], insightsRouter);
app.get(`${API_PREFIX}/users/current/insights/:insight_type/:range`, [apiLimiter, checkApiLimit], insightsRouter);

// Leaders
app.get(`${API_PREFIX}/leaders`, [apiLimiter, checkApiLimit], leaderboardsRoutes);

// All Time Since Today
app.get(`${API_PREFIX}/users/:user/all_time_since_today`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/all_time_since_today`, [apiLimiter, checkApiLimit], statsRoutes);

// Commits
app.get(`${API_PREFIX}/users/:user/projects/:project/commits/:hash`, [apiLimiter, checkApiLimit], projectsRoutes);
app.get(`${API_PREFIX}/users/current/projects/:project/commits/:hash`, [apiLimiter, checkApiLimit], projectsRoutes);
app.get(`${API_PREFIX}/users/:user/projects/:project/commits`, [apiLimiter, checkApiLimit], projectsRoutes);
app.get(`${API_PREFIX}/users/current/projects/:project/commits`, [apiLimiter, checkApiLimit], projectsRoutes);

// Data Dumps
app.get(`${API_PREFIX}/users/:user/data_dumps`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/data_dumps`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/:user/data_dumps`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/current/data_dumps`, [apiLimiter, checkApiLimit], statsRoutes);

// Durations
app.get(`${API_PREFIX}/users/:user/durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/durations`, [apiLimiter, checkApiLimit], statsRoutes);

// Editors
app.get(`${API_PREFIX}/editors`, [apiLimiter, checkApiLimit], resourcesRouter);

// External Durations
app.get(`${API_PREFIX}/users/:user/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/:user/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/current/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/:user/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/current/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);
app.delete(`${API_PREFIX}/users/:user/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);
app.delete(`${API_PREFIX}/users/current/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);

// Goals
app.get(`${API_PREFIX}/users/:user/goals/:goal`, [apiLimiter, checkApiLimit], goalsRoutes);
app.get(`${API_PREFIX}/users/current/goals/:goal`, [apiLimiter, checkApiLimit], goalsRoutes);
app.get(`${API_PREFIX}/users/:user/goals`, [apiLimiter, checkApiLimit], goalsRoutes);
app.get(`${API_PREFIX}/users/current/goals`, [apiLimiter, checkApiLimit], goalsRoutes);

// Health check endpoint (no rate limiting)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    uptime: process.uptime()
  });
});

// Prometheus metrics endpoint (no rate limiting)
app.get('/metrics', (req, res) => {
  // Implement Prometheus metrics collection
  res.set('Content-Type', 'text/plain');
  // TODO: Add Prometheus metrics
  res.send('# TODO: Add Prometheus metrics');
});

// Error handling
app.use(errorHandler);

// Enhanced error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Attempt graceful shutdown
  shutdown();
});

// Enhanced error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Attempt graceful shutdown
  shutdown();
});

// Enhanced graceful shutdown
async function shutdown() {
  logger.info('Initiating graceful shutdown...');
  
  // Close server
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Close Redis connection
  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
  }

  // Allow time for cleanup
  setTimeout(() => {
    logger.info('Exiting process...');
    process.exit(1);
  }, 5000);
}

// Graceful shutdown on SIGTERM
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  logger.info(`API documentation available at ${API_PREFIX}/docs`);
  logger.info(`WebSocket server available at ws://localhost:${PORT}${API_PREFIX}/collaboration/ws`);
});

module.exports = app; 