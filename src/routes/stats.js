const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get current user's stats
router.get('/current/summary', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_7_days' } = req.query;
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

    const [
      totalTime,
      languageStats,
      editorStats,
      projectStats,
      dailyStats
    ] = await Promise.all([
      // Total coding time
      prisma.heartbeat.aggregate({
        where: {
          userId: req.user.id,
          timestamp: { gte: start, lte: end }
        },
        _sum: { duration: true }
      }),

      // Language statistics
      prisma.$queryRaw`
        SELECT 
          language,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds,
          ROUND(SUM(duration) * 100.0 / (
            SELECT SUM(duration) 
            FROM Heartbeat 
            WHERE userId = ${req.user.id}
              AND timestamp BETWEEN ${start} AND ${end}
          ), 2) as percentage
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND language IS NOT NULL
        GROUP BY language
        ORDER BY total_seconds DESC
      `,

      // Editor statistics
      prisma.$queryRaw`
        SELECT 
          editor,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds,
          ROUND(SUM(duration) * 100.0 / (
            SELECT SUM(duration) 
            FROM Heartbeat 
            WHERE userId = ${req.user.id}
              AND timestamp BETWEEN ${start} AND ${end}
          ), 2) as percentage
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND editor IS NOT NULL
        GROUP BY editor
        ORDER BY total_seconds DESC
      `,

      // Project statistics
      prisma.$queryRaw`
        SELECT 
          p.name as project_name,
          p.repositoryUrl,
          COUNT(*) as heartbeat_count,
          SUM(h.duration) as total_seconds,
          ROUND(SUM(h.duration) * 100.0 / (
            SELECT SUM(duration) 
            FROM Heartbeat 
            WHERE userId = ${req.user.id}
              AND timestamp BETWEEN ${start} AND ${end}
          ), 2) as percentage
        FROM Heartbeat h
        LEFT JOIN Project p ON h.projectId = p.id
        WHERE h.userId = ${req.user.id}
          AND h.timestamp BETWEEN ${start} AND ${end}
        GROUP BY p.id, p.name, p.repositoryUrl
        ORDER BY total_seconds DESC
      `,

      // Daily statistics
      prisma.$queryRaw`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
      `
    ]);

    res.json({
      data: {
        range: {
          start: start.toISOString(),
          end: end.toISOString(),
          range,
          timezone: 'UTC'
        },
        total_seconds: totalTime._sum.duration || 0,
        daily_average: totalTime._sum.duration 
          ? Math.round(totalTime._sum.duration / Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
          : 0,
        languages: languageStats,
        editors: editorStats,
        projects: projectStats,
        daily_stats: dailyStats
      }
    });
  } catch (error) {
    logger.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's coding activity heatmap
router.get('/current/heatmap', authenticateUser, async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);

    const heatmap = await prisma.$queryRaw`
      SELECT 
        DATE(timestamp) as date,
        SUM(duration) as total_seconds
      FROM Heartbeat
      WHERE userId = ${req.user.id}
        AND timestamp BETWEEN ${start} AND ${end}
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `;

    res.json({ data: heatmap });
  } catch (error) {
    logger.error('Error fetching heatmap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's best day stats
router.get('/current/best_day', authenticateUser, async (req, res) => {
  try {
    const bestDay = await prisma.$queryRaw`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as heartbeat_count,
        SUM(duration) as total_seconds
      FROM Heartbeat
      WHERE userId = ${req.user.id}
      GROUP BY DATE(timestamp)
      ORDER BY total_seconds DESC
      LIMIT 1
    `;

    if (bestDay.length === 0) {
      return res.json({ data: null });
    }

    // Get detailed stats for the best day
    const [languages, editors, projects] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          language,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND DATE(timestamp) = ${bestDay[0].date}
        GROUP BY language
        ORDER BY total_seconds DESC
      `,
      prisma.$queryRaw`
        SELECT 
          editor,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND DATE(timestamp) = ${bestDay[0].date}
        GROUP BY editor
        ORDER BY total_seconds DESC
      `,
      prisma.$queryRaw`
        SELECT 
          p.name as project_name,
          COUNT(*) as heartbeat_count,
          SUM(h.duration) as total_seconds
        FROM Heartbeat h
        LEFT JOIN Project p ON h.projectId = p.id
        WHERE h.userId = ${req.user.id}
          AND DATE(h.timestamp) = ${bestDay[0].date}
        GROUP BY p.id, p.name
        ORDER BY total_seconds DESC
      `
    ]);

    res.json({
      data: {
        date: bestDay[0].date,
        total_seconds: bestDay[0].total_seconds,
        languages,
        editors,
        projects
      }
    });
  } catch (error) {
    logger.error('Error fetching best day stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 