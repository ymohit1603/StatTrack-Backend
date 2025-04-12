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

router.get('/:userId/summaries', async (req, res) => {
  try {
    const { start, end, project, branches, timeout, writes_only, timezone } = req.query;
    const userId = parseInt(req.params.userId);

    const summaries = await prisma.dailySummary.findMany({
      where: {
        userId,
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

    // Initialize aggregation structures
    let cumulativeSeconds = 0;
    const dailyData = [];

    for (const summary of summaries) {
      const dayTotalSeconds = summary.totalSeconds || 0;
      cumulativeSeconds += dayTotalSeconds;

      dailyData.push({
        grand_total: {
          total_seconds: dayTotalSeconds,
          hours: Math.floor(dayTotalSeconds / 3600),
          minutes: Math.floor((dayTotalSeconds % 3600) / 60),
          digital: `${String(Math.floor(dayTotalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((dayTotalSeconds % 3600) / 60)).padStart(2, '0')}`,
          text: `${Math.floor(dayTotalSeconds / 3600)} hrs ${Math.floor((dayTotalSeconds % 3600) / 60)} mins`
        },
        projects: summary.project ? [{
          name: summary.project.name,
          total_seconds: dayTotalSeconds,
          percent: 100,
          digital: `${String(Math.floor(dayTotalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((dayTotalSeconds % 3600) / 60)).padStart(2, '0')}`,
          text: `${Math.floor(dayTotalSeconds / 3600)} hrs ${Math.floor((dayTotalSeconds % 3600) / 60)} mins`,
          hours: Math.floor(dayTotalSeconds / 3600),
          minutes: Math.floor((dayTotalSeconds % 3600) / 60)
        }] : [],
        range: {
          date: summary.summaryDate.toISOString().split('T')[0],
          start: new Date(summary.summaryDate.setHours(0, 0, 0)).toISOString(),
          end: new Date(summary.summaryDate.setHours(23, 59, 59)).toISOString(),
          text: 'Some day', // Optionally add humanized day text like "Yesterday", "Today"
          timezone: timezone || 'UTC'
        }
      });
    }

    const totalDays = new Set(summaries.map(s => s.summaryDate.toISOString().split('T')[0])).size;

    const response = {
      data: dailyData,
      cumulative_total: {
        seconds: cumulativeSeconds,
        text: `${Math.floor(cumulativeSeconds / 3600)} hrs ${Math.floor((cumulativeSeconds % 3600) / 60)} mins`,
        decimal: (cumulativeSeconds / 3600).toFixed(2),
        digital: `${String(Math.floor(cumulativeSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((cumulativeSeconds % 3600) / 60)).padStart(2, '0')}`
      },
      daily_average: {
        holidays: 0, // You can implement holiday detection if needed
        days_including_holidays: totalDays,
        days_minus_holidays: totalDays,
        seconds: cumulativeSeconds / totalDays,
        text: `${Math.floor((cumulativeSeconds / totalDays) / 3600)} hrs ${Math.floor(((cumulativeSeconds / totalDays) % 3600) / 60)} mins`,
        seconds_including_other_language: cumulativeSeconds / totalDays,
        text_including_other_language: `${Math.floor((cumulativeSeconds / totalDays) / 3600)} hrs ${Math.floor(((cumulativeSeconds / totalDays) % 3600) / 60)} mins`
      },
      start: start ? new Date(start).toISOString() : null,
      end: end ? new Date(end).toISOString() : null
    };

    res.json(response);
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