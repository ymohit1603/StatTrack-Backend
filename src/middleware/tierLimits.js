const Redis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD
});

const TIER_LIMITS = {
  FREE: {
    apiRequestsPerDay: 1000,
    projectsLimit: 3,
    historyDays: 14,
    teamMembers: 1,
    maxFileSize: 1024 * 1024, // 1MB
    aiRequestsPerDay: 10,
    concurrentConnections: 2,
    aiMinutesPerMonth: 10,
    storageLimit: 1024 * 1024 * 1024, // 1GB
    customReports: false,
    exportData: false,
    privateProfile: false,
    customDashboards: 1,
    codingInsights: false,
    productivityScore: false,
    languageProficiency: false,
    projectComplexity: false,
    teamAnalytics: false,
    aiCodeReview: false,
    realTimeAlerts: false,
    codeQualityMetrics: false,
    maxReportingPeriod: 30 // days
  },
  PRO: {
    apiRequestsPerDay: 10000,
    projectsLimit: -1,
    historyDays: 90,
    teamMembers: 1,
    maxFileSize: 5 * 1024 * 1024, // 5MB
    aiRequestsPerDay: 100,
    concurrentConnections: 5,
    aiMinutesPerMonth: 100,
    storageLimit: 10 * 1024 * 1024 * 1024, // 10GB
    customReports: true,
    exportData: true,
    privateProfile: true,
    customDashboards: 5,
    codingInsights: true,
    productivityScore: true,
    languageProficiency: true,
    projectComplexity: true,
    teamAnalytics: false,
    aiCodeReview: true,
    realTimeAlerts: true,
    codeQualityMetrics: true,
    maxReportingPeriod: 180 // days
  },
  TEAM: {
    apiRequestsPerDay: 50000,
    projectsLimit: -1,
    historyDays: 365,
    teamMembers: 5,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    aiRequestsPerDay: 500,
    concurrentConnections: 20,
    aiMinutesPerMonth: 500,
    storageLimit: 100 * 1024 * 1024 * 1024, // 100GB
    customReports: true,
    exportData: true,
    privateProfile: true,
    customDashboards: -1,
    codingInsights: true,
    productivityScore: true,
    languageProficiency: true,
    projectComplexity: true,
    teamAnalytics: true,
    aiCodeReview: true,
    realTimeAlerts: true,
    codeQualityMetrics: true,
    maxReportingPeriod: 365 // days
  },
  ENTERPRISE: {
    apiRequestsPerDay: -1,
    projectsLimit: -1,
    historyDays: -1,
    teamMembers: -1,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    aiRequestsPerDay: -1,
    concurrentConnections: 100,
    aiMinutesPerMonth: -1,
    storageLimit: -1,
    customReports: true,
    exportData: true,
    privateProfile: true,
    customDashboards: -1,
    codingInsights: true,
    productivityScore: true,
    languageProficiency: true,
    projectComplexity: true,
    teamAnalytics: true,
    aiCodeReview: true,
    realTimeAlerts: true,
    codeQualityMetrics: true,
    maxReportingPeriod: -1 // unlimited
  }
};

// Cache user tiers for 5 minutes
const TIER_CACHE_TTL = 300;

async function getUserTier(userId) {
  const cacheKey = `user:${userId}:tier`;
  
  // Try to get from cache first
  let tier = await redis.get(cacheKey);
  if (tier) return tier;

  // If not in cache, get from database
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true }
  });

  tier = user?.subscriptionTier || 'FREE';
  
  // Cache the result
  await redis.set(cacheKey, tier, 'EX', TIER_CACHE_TTL);
  
  return tier;
}

async function checkUsageLimit(userId, limitType) {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  
  if (!limits[limitType] || limits[limitType] === -1) return true;

  const today = new Date().toISOString().split('T')[0];
  const usageKey = `usage:${userId}:${limitType}:${today}`;
  
  const currentUsage = await redis.incr(usageKey);
  
  // Set expiry for usage key if it's new
  if (currentUsage === 1) {
    await redis.expire(usageKey, 86400); // 24 hours
  }
  
  return currentUsage <= limits[limitType];
}

// Middleware to check project limits
async function checkProjectLimit(req, res, next) {
  try {
    if (req.method !== 'POST' || !req.path.includes('/projects')) {
      return next();
    }

    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];

    if (limits.projectsLimit === -1) return next();

    const projectCount = await prisma.project.count({
      where: { userId: req.user.id }
    });

    if (projectCount >= limits.projectsLimit) {
      return res.status(403).json({
        error: 'Project limit reached',
        limit: limits.projectsLimit,
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking project limit:', error);
    next(error);
  }
}

// Middleware to check API rate limits
async function checkApiLimit(req, res, next) {
  try {
    const canProceed = await checkUsageLimit(req.user.id, 'apiRequestsPerDay');
    
    if (!canProceed) {
      return res.status(429).json({
        error: 'API rate limit exceeded',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking API limit:', error);
    next(error);
  }
}

// Middleware to check AI request limits
async function checkAiLimit(req, res, next) {
  try {
    if (!req.path.includes('/ai')) {
      return next();
    }

    const canProceed = await checkUsageLimit(req.user.id, 'aiRequestsPerDay');
    
    if (!canProceed) {
      return res.status(429).json({
        error: 'AI request limit exceeded',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking AI limit:', error);
    next(error);
  }
}

// Middleware to check file size limits
async function checkFileSizeLimit(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];

    if (req.headers['content-length']) {
      const size = parseInt(req.headers['content-length']);
      if (size > limits.maxFileSize) {
        return res.status(413).json({
          error: 'File size limit exceeded',
          limit: limits.maxFileSize,
          upgrade_url: '/api/v1/subscriptions/plans'
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Error checking file size limit:', error);
    next(error);
  }
}

// Middleware to check concurrent connections
async function checkConcurrentConnections(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];
    
    const connectionsKey = `connections:${req.user.id}`;
    const connections = await redis.incr(connectionsKey);
    
    // Set expiry if it's a new key
    if (connections === 1) {
      await redis.expire(connectionsKey, 3600); // 1 hour
    }

    if (connections > limits.concurrentConnections) {
      await redis.decr(connectionsKey);
      return res.status(429).json({
        error: 'Too many concurrent connections',
        limit: limits.concurrentConnections,
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    // Decrease connection count when request ends
    res.on('finish', async () => {
      await redis.decr(connectionsKey);
    });

    next();
  } catch (error) {
    logger.error('Error checking concurrent connections:', error);
    next(error);
  }
}

// Middleware to check history access
async function checkHistoryAccess(req, res, next) {
  try {
    if (!req.query.start) return next();

    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];
    
    if (limits.historyDays === -1) return next();

    const startDate = new Date(req.query.start);
    const daysDiff = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > limits.historyDays) {
      return res.status(403).json({
        error: 'History access limit exceeded',
        limit: `${limits.historyDays} days`,
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking history access:', error);
    next(error);
  }
}

// Add storage usage check
async function checkStorageLimit(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];
    
    if (limits.storageLimit === -1) return next();

    const storageKey = `storage:${req.user.id}`;
    const currentStorage = parseInt(await redis.get(storageKey) || '0');
    
    if (req.headers['content-length']) {
      const newSize = currentStorage + parseInt(req.headers['content-length']);
      if (newSize > limits.storageLimit) {
        return res.status(413).json({
          error: 'Storage limit exceeded',
          current: currentStorage,
          limit: limits.storageLimit,
          upgrade_url: '/api/v1/subscriptions/plans'
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Error checking storage limit:', error);
    next(error);
  }
}

// Add custom report check
async function checkCustomReportAccess(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];

    if (!limits.customReports) {
      return res.status(403).json({
        error: 'Custom reports not available in your plan',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking custom report access:', error);
    next(error);
  }
}

// Add data export check
async function checkExportAccess(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];

    if (!limits.exportData) {
      return res.status(403).json({
        error: 'Data export not available in your plan',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking export access:', error);
    next(error);
  }
}

// Add AI minutes tracking
async function trackAiMinutes(userId, minutes) {
  const today = new Date();
  const monthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
  const usageKey = `ai:minutes:${userId}:${monthKey}`;
  
  const currentUsage = parseInt(await redis.get(usageKey) || '0');
  const newUsage = currentUsage + minutes;
  
  await redis.set(usageKey, newUsage);
  
  // Set expiry for first day of next month
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const ttl = Math.floor((nextMonth - today) / 1000);
  await redis.expire(usageKey, ttl);
  
  return newUsage;
}

module.exports = {
  checkProjectLimit,
  checkApiLimit,
  checkAiLimit,
  checkFileSizeLimit,
  checkConcurrentConnections,
  checkHistoryAccess,
  checkStorageLimit,
  checkCustomReportAccess,
  checkExportAccess,
  trackAiMinutes,
  TIER_LIMITS
}; 