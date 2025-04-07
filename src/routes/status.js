const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { prisma, redis } = require('../config/db');

// Get system status
router.get('/', authenticateUser, async (req, res) => {
  try {
    const redisStatus = await checkRedisStatus();
    const dbStatus = await checkDatabaseStatus();

    res.json({
      status: 'ok',
      timestamp: new Date(),
      services: {
        api: {
          status: 'healthy',
          version: process.env.npm_package_version || '1.0.0'
        },
        database: {
          status: dbStatus ? 'healthy' : 'error',
          type: 'PostgreSQL'
        },
        cache: {
          status: redisStatus ? 'healthy' : 'error',
          type: 'Redis'
        }
      }
    });
  } catch (error) {
    logger.error('Error checking system status:', error);
    res.status(500).json({ error: 'Error checking system status' });
  }
});

// Check Redis connection
async function checkRedisStatus() {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
}

// Check database connection
async function checkDatabaseStatus() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

module.exports = router;