const { prisma } = require('../config/db');
const logger = require('../utils/logger');

const TIER_LIMITS = {
  FREE: {
    apiRequestsPerDay: 1000,
    projectsLimit: 3,
    historyDays: 14,
    teamMembers: 1,
    maxFileSize: 1024 * 1024,
    aiRequestsPerDay: 10,
    concurrentConnections: 2,
    aiMinutesPerMonth: 10,
    storageLimit: 1024 * 1024 * 1024,
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
    maxReportingPeriod: 30
  },
  PRO: {
    apiRequestsPerDay: 10000,
    projectsLimit: -1,
    historyDays: 90,
    teamMembers: 1,
    maxFileSize: 5 * 1024 * 1024,
    aiRequestsPerDay: 100,
    concurrentConnections: 5,
    aiMinutesPerMonth: 100,
    storageLimit: 10 * 1024 * 1024 * 1024,
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
    maxReportingPeriod: 180
  },
  TEAM: {
    apiRequestsPerDay: 50000,
    projectsLimit: -1,
    historyDays: 365,
    teamMembers: 5,
    maxFileSize: 10 * 1024 * 1024,
    aiRequestsPerDay: 500,
    concurrentConnections: 20,
    aiMinutesPerMonth: 500,
    storageLimit: 100 * 1024 * 1024 * 1024,
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
    maxReportingPeriod: 365
  },
  ENTERPRISE: {
    apiRequestsPerDay: -1,
    projectsLimit: -1,
    historyDays: -1,
    teamMembers: -1,
    maxFileSize: 100 * 1024 * 1024,
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
    maxReportingPeriod: -1
  }
};

async function getUserTier(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true }
  });

  return user?.subscriptionTier || 'FREE';
}

async function checkUsageLimit(userId, limitType) {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  
  if (!limits[limitType] || limits[limitType] === -1) return true;

  const today = new Date().toISOString().split('T')[0];
  
  // Get usage from database
  const usage = await prisma.usageTracking.findFirst({
    where: {
      userId,
      limitType,
      date: today
    }
  });

  if (!usage) {
    // Create new usage record
    await prisma.usageTracking.create({
      data: {
        userId,
        limitType,
        date: today,
        count: 1
      }
    });
    return true;
  }

  if (usage.count >= limits[limitType]) {
    return false;
  }

  // Increment usage
  await prisma.usageTracking.update({
    where: { id: usage.id },
    data: { count: usage.count + 1 }
  });

  return true;
}

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

async function checkConcurrentConnections(req, res, next) {
  try {
    const tier = await getUserTier(req.user.id);
    const limits = TIER_LIMITS[tier];
    
    const connections = await prisma.connectionTracking.findFirst({
      where: {
        userId: req.user.id,
        date: new Date().toISOString().split('T')[0]
      }
    });

    if (!connections) {
      await prisma.connectionTracking.create({
        data: {
          userId: req.user.id,
          date: new Date().toISOString().split('T')[0],
          count: 1
        }
      });
    } else if (connections.count >= limits.concurrentConnections) {
      return res.status(429).json({
        error: 'Too many concurrent connections',
        limit: limits.concurrentConnections,
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    } else {
      await prisma.connectionTracking.update({
        where: { id: connections.id },
        data: { count: connections.count + 1 }
      });
    }

    res.on('finish', async () => {
      const conn = await prisma.connectionTracking.findFirst({
        where: {
          userId: req.user.id,
          date: new Date().toISOString().split('T')[0]
        }
      });
      if (conn) {
        await prisma.connectionTracking.update({
          where: { id: conn.id },
          data: { count: Math.max(0, conn.count - 1) }
        });
      }
    });

    next();
  } catch (error) {
    logger.error('Error checking concurrent connections:', error);
    next(error);
  }
}

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

async function trackAiMinutes(userId, minutes) {
  const today = new Date();
  const monthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
  
  const usage = await prisma.aiUsageTracking.findFirst({
    where: {
      userId,
      month: monthKey
    }
  });

  if (!usage) {
    await prisma.aiUsageTracking.create({
      data: {
        userId,
        month: monthKey,
        minutes
      }
    });
    return minutes;
  }

  const newUsage = usage.minutes + minutes;
  await prisma.aiUsageTracking.update({
    where: { id: usage.id },
    data: { minutes: newUsage }
  });

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