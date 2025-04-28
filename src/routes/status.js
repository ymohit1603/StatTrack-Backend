const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { prisma } = require('../config/db');

// Get system status
router.get('/', authenticateUser, async (req, res) => {
  try {
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
        }
      }
    });
  } catch (error) {
    logger.error('Error checking system status:', error);
    res.status(500).json({ error: 'Error checking system status' });
  }
});

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