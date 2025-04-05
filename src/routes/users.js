const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get current user
router.get('/current', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        profile_url: true,
        isPrivate: true,
        createdAt: true
      }
    });
    res.json({ data: user });
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user settings
router.get('/current/settings', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isPrivate: true,
        app_name: true
      }
    });
    res.json({ data: user });
  } catch (error) {
    logger.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user settings
router.put('/current/settings', authenticateUser, async (req, res) => {
  try {
    const { isPrivate, app_name } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { isPrivate, app_name },
      select: {
        isPrivate: true,
        app_name: true
      }
    });
    res.json({ data: user });
  } catch (error) {
    logger.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user summaries
router.get('/:userId/summaries', async (req, res) => {
  try {
    const { start, end, project } = req.query;
    const summaries = await prisma.dailySummary.findMany({
      where: {
        userId: parseInt(req.params.userId),
        projectId: project ? parseInt(project) : undefined,
        summaryDate: {
          gte: start ? new Date(start) : undefined,
          lte: end ? new Date(end) : undefined
        }
      },
      include: {
        project: {
          select: {
            name: true,
            branch: true
          }
        }
      }
    });
    res.json({ data: summaries });
  } catch (error) {
    logger.error('Error fetching user summaries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user stats
router.get('/:userId/stats/:range', async (req, res) => {
  try {
    const { userId, range } = req.params;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case 'last_7_days':
        start.setDate(start.getDate() - 7);
        break;
      case 'last_30_days':
        start.setDate(start.getDate() - 30);
        break;
      case 'last_6_months':
        start.setMonth(start.getMonth() - 6);
        break;
      case 'last_year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range' });
    }

    const stats = await prisma.$queryRaw`
      SELECT 
        SUM(totalDuration) as total_seconds,
        COUNT(DISTINCT DATE(summaryDate)) as days_coded,
        AVG(totalDuration) as daily_average,
        MAX(totalDuration) as best_day
      FROM DailySummary
      WHERE userId = ${parseInt(userId)}
        AND summaryDate BETWEEN ${start} AND ${end}
    `;

    res.json({ data: stats[0] });
  } catch (error) {
    logger.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 