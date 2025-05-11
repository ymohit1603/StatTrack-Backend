const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const { checkHistoryAccess } = require('../middleware/tierLimits');
const logger = require('../utils/logger');

// Get dashboard data including line counts
router.get('/', [authenticateUser, checkHistoryAccess], async (req, res) => {
  try {
    const { range = 'last_7_days' } = req.query;
    const end = new Date();
    let start = new Date();

    // Calculate date range
    switch (range) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        break;
      case 'this_week':
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        break;
      case 'this_month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
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
        start.setDate(start.getDate() - 7); // Default to last 7 days
    }

    console.log("getting from heartbeat");
    // Get data directly from database
    const data = await prisma.heartbeat.groupBy({
      by: ['date'],
      where: {
        userId: req.user.id,
        timestamp: {
          gte: start,
          lte: end
        }
      },
      _count: true,
      _sum: {
        lines: true
      }
    });

    res.json({ data });
  } catch (error) {
    logger.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get streak information
router.get('/streaks', authenticateUser, async (req, res) => {
  try {
    // Get all active days
    const activeDays = await prisma.$queryRaw`
      SELECT DISTINCT DATE(timestamp) as date
      FROM Heartbeat
      WHERE userId = ${req.user.id}
        AND timestamp >= NOW() - INTERVAL '365 days'
      ORDER BY date ASC
    `;

    // Calculate streaks
    const streaks = calculateStreaks(activeDays);
    const data = {
      current_streak: streaks.current_streak,
      longest_streak: streaks.longest_streak,
      total_active_days: activeDays.length,
      streaks: streaks.all_streaks
    };

    res.json({ data });
  } catch (error) {
    logger.error('Error fetching streak data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 