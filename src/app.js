require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const url = require('url');
const { redis } = require('./config/db');
const { authenticateUser } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
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

const app = express();

app.set('redis', redis);

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

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400
}));

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
  15 * 60 * 1000,
  100,
  'Too many requests from this IP, please try again after 15 minutes'
);

const strictLimiter = createRateLimiter(
  60 * 60 * 1000,
  5,
  'Too many attempts, please try again after an hour'
);

app.use(compression());
app.use(express.json({ 
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
  limit: '10mb'
}));
app.use(morgan('combined', { 
  stream: { 
    write: message => logger.info(message.trim()) 
  },
  skip: (req) => req.path === '/health'
}));

const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(`${API_PREFIX}/auth`, strictLimiter, authRoutes);
app.use(`${API_PREFIX}/users`, [apiLimiter, checkApiLimit], usersRoutes);
app.use(`${API_PREFIX}/projects`, [apiLimiter, checkApiLimit, checkProjectLimit], projectsRoutes);
app.use(`${API_PREFIX}/heartbeats`, [apiLimiter, checkApiLimit], heartbeatsRoutes);
app.use(`${API_PREFIX}/goals`, [apiLimiter, checkApiLimit], goalsRoutes);
app.use(`${API_PREFIX}/leaderboards`, [apiLimiter, checkApiLimit], leaderboardsRoutes);
app.use(`${API_PREFIX}/reports`, [apiLimiter, checkApiLimit, checkCustomReportAccess], reportsRouter);
app.use(`${API_PREFIX}/insights`, [apiLimiter, checkApiLimit], insightsRouter);
app.use(`${API_PREFIX}/status`, [apiLimiter, checkApiLimit], statusRouter);
app.use(`${API_PREFIX}/preferences`, [apiLimiter, checkApiLimit], preferencesRouter);
app.use(`${API_PREFIX}/ai`, [apiLimiter, checkApiLimit, checkAiLimit], aiRouter);
app.use(`${API_PREFIX}/resources`, [apiLimiter, checkApiLimit], resourcesRouter);
app.use(`${API_PREFIX}/collaboration`, [apiLimiter, checkApiLimit], collaborationRouter);
app.use(`${API_PREFIX}/subscriptions`, [apiLimiter, checkApiLimit], subscriptionsRouter);

app.get(`${API_PREFIX}/users/:user/stats`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/stats`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/:user/stats/history`, [apiLimiter, checkApiLimit, checkHistoryAccess], statsRoutes);
app.get(`${API_PREFIX}/users/current/stats/history`, [apiLimiter, checkApiLimit, checkHistoryAccess], statsRoutes);
app.get(`${API_PREFIX}/users/:user/stats/export`, [apiLimiter, checkApiLimit, checkExportAccess], statsRoutes);
app.get(`${API_PREFIX}/users/current/stats/export`, [apiLimiter, checkApiLimit, checkExportAccess], statsRoutes);
app.get(`${API_PREFIX}/users/:user/durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/:user/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.get(`${API_PREFIX}/users/current/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/:user/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/current/external_durations`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/:user/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);
app.post(`${API_PREFIX}/users/current/external_durations.bulk`, [apiLimiter, checkApiLimit], statsRoutes);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use(errorHandler);

const server = http.createServer(app);

if (wsServer) {
  const wss = wsServer(server);
  app.set('wss', wss);
}

const shutdown = async () => {
  try {
    await redis.quit();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

module.exports = { app, server };