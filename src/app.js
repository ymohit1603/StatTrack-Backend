require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const passport = require('passport');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const url = require('url');
const { redis } = require('./config/db');
// const { authenticateUser } = require('./middleware/auth');
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
const HeartbeatsRoutes = require('./routes/heartbeats');
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
// const handleRoute=require('./routes/handleRoute');

const app = express();  

// app.use((req, res, next) => {
//   console.log("here");
//   console.log(`→ ${req.method} ${req.originalUrl}`);
//   logger.info(`→ ${req.method} ${req.originalUrl}`);
//   next(); // pass control to the next handler
// });
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



app.use(
  session({
    secret: process.env.SESSION_SECRET || 'yoursecretkey',
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // change this to true if using HTTPS in production
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());


app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'],
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

const API_PREFIX = `/api/v1`;

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// app.use('{API_PREFIX}',handleRoute);


// Authentication and basic user endpoints remain at the top level.
app.use(`${API_PREFIX}/auth`,  authRoutes);
app.use(`${API_PREFIX}/users`, /*[apiLimiter, checkApiLimit]*/ usersRoutes);
// New endpoint for fetching current user details (mirrors GET /users/current)
// app.get(`${API_PREFIX}/users/current`, [apiLimiter, checkApiLimit], currentUserRoutes);

// WakaTime-style endpoints for the current user:

// Projects endpoint: /users/current/projects
app.use(
  `${API_PREFIX}/users/current/projects`,
  /*[apiLimiter, checkApiLimit, checkProjectLimit]*/
  projectsRoutes
);

// Heartbeats endpoint: /users/current/Heartbeats
app.use(
  `${API_PREFIX}/users/current/heartbeats.bulk`,
  HeartbeatsRoutes
);

// Summaries endpoint: /users/current/summaries
// app.use(
//   `${API_PREFIX}/users/current/summaries`,
//   [apiLimiter, checkApiLimit],
//   summariesRoutes  
// );

// Stats endpoint: /users/current/stats
app.use(
  `${API_PREFIX}/users/current/stats`,
  // [apiLimiter, checkApiLimit],
  statsRoutes
);

// Durations endpoints for current user.
app.use(
  `${API_PREFIX}/users/current/durations`,
  // [apiLimiter, checkApiLimit],
  statsRoutes
);
// app.use(
//   `${API_PREFIX}/users/current/external_durations`,
//   [apiLimiter, checkApiLimit],
//   statsRoutes
// );
// app.post(
//   `${API_PREFIX}/users/current/external_durations`,
//   [apiLimiter, checkApiLimit],
//   statsRoutes
// );
// app.post(
//   `${API_PREFIX}/users/current/external_durations.bulk`,
//   [apiLimiter, checkApiLimit],
//   statsRoutes
// );

// Goals endpoint: /users/current/goals
app.use(
  `${API_PREFIX}/users/current/goals`,
  // [apiLimiter, checkApiLimit],
  goalsRoutes
);

// Leaderboards endpoint: /users/current/leaderboards
app.use(
  `${API_PREFIX}/users/current/leaderboards`,
  // [apiLimiter, checkApiLimit],
  leaderboardsRoutes
);

// Reports endpoint: /users/current/reports (custom report access check)
app.use(
  `${API_PREFIX}/users/current/reports`,
  // [apiLimiter, checkApiLimit, checkCustomReportAccess],
  reportsRouter
);

// Insights endpoint: /users/current/insights
app.use(
  `${API_PREFIX}/users/current/insights`,
  // [apiLimiter, checkApiLimit],
  insightsRouter
);

// Status endpoint: /users/current/status
app.use(
  `${API_PREFIX}/users/current/status`,
  // [apiLimiter, checkApiLimit],
  statusRouter
);

// Preferences endpoint: /users/current/preferences
app.use(
  `${API_PREFIX}/users/current/preferences`,
  // [apiLimiter, checkApiLimit],
  preferencesRouter
);

// AI endpoint: /users/current/ai (with an AI limits check)
app.use(
  `${API_PREFIX}/users/current/ai`,
  // [apiLimiter, checkApiLimit, checkAiLimit],
  aiRouter
);

// Resources endpoint: /users/current/resources
app.use(
  `${API_PREFIX}/users/current/resources`,
  // [apiLimiter, checkApiLimit],
  resourcesRouter
);

// Collaboration endpoint: /users/current/collaboration
app.use(
  `${API_PREFIX}/users/current/collaboration`,
  // [apiLimiter, checkApiLimit],
  collaborationRouter
);

// Subscriptions endpoint: /users/current/subscriptions
app.use(
  `${API_PREFIX}/users/current/subscriptions`,
  // [apiLimiter, checkApiLimit],
  subscriptionsRouter
);
// app.use(
//   `${API_PREFIX}/users/current/editors`,
//   [apiLimiter, checkApiLimit],
//   editorsRoutes
// );

// Languages endpoint: Retrieve language statistics or details.
// app.use(
//   `${API_PREFIX}/users/current/languages`,
//   [apiLimiter, checkApiLimit],
//   languagesRoutes
// );

// Machines endpoint: List machines (computers) from which the user coded.
// app.use(
//   `${API_PREFIX}/users/current/machines`,
//   [apiLimiter, checkApiLimit],
//   machinesRoutes
// );

// Lines of Code endpoint: Return coding metrics such as lines-of-code.
// app.use(
//   `${API_PREFIX}/users/current/lines-of-code`,
//   [apiLimiter, checkApiLimit],
//   locRoutes
// );

// app.use(
//   `${API_PREFIX}/users/current/current/all_time_since_today`,
//   [apiLimiter, checkApiLimit],
  
// );

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use(errorHandler);

const server = http.createServer(app);

// if (wsServer) {
//   const wss = wsServer(server);
//   app.set('wss', wss);
// }

const shutdown = async () => {
  try {
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

