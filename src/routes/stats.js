const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { prisma } = require('../config/db');

router.get('/summary', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_7_days' } = req.query;
    const now = new Date();
    let start, end;

    const userId = req.user.id;

    // Get the user's createdAt date
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate range
    switch (range) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
        break;
      case 'last_7_days':
        end = now;
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        break;
      case 'last_30_days':
        end = now;
        start = new Date(now);
        start.setDate(start.getDate() - 30);
        break;
      case 'last_6_months':
        end = now;
        start = new Date(now);
        start.setMonth(start.getMonth() - 6);
        break;
      case 'last_year':
        end = now;
        start = new Date(now);
        start.setFullYear(start.getFullYear() - 1);
        break;
      case 'all_years':
        start = user.createdAt;
        end = now;
        break;
      default:
        return res.status(400).json({ error: 'Invalid range parameter' });
    }

    const summaryAgg = await prisma.dailySummary.aggregate({
      where: { userId, summaryDate: { gte: start, lte: end } },
      _sum: { totalDuration: true },
    });
    const totalSeconds = summaryAgg._sum.totalDuration
      ? parseFloat(summaryAgg._sum.totalDuration.toString())
      : 0;

    const dayCount = range === 'today'
      ? 1
      : Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const dailyAverage = dayCount > 0
      ? Math.round(totalSeconds / dayCount)
      : 0;

    const [languageStats, editorStats, projectStats] = await Promise.all([
      prisma.$queryRaw`
        SELECT language, COUNT(*) AS heartbeat_count, SUM(duration) AS total_seconds,
          ROUND(SUM(duration)*100.0/(
            SELECT SUM(duration) FROM Heartbeat
            WHERE userId=${userId} AND timestamp BETWEEN ${start} AND ${end}
          ),2) AS percentage
        FROM Heartbeat
        WHERE userId=${userId} AND timestamp BETWEEN ${start} AND ${end}
          AND language IS NOT NULL
        GROUP BY language
        ORDER BY total_seconds DESC
      `,
      prisma.$queryRaw`
        SELECT editor, COUNT(*) AS heartbeat_count, SUM(duration) AS total_seconds,
          ROUND(SUM(duration)*100.0/(
            SELECT SUM(duration) FROM Heartbeat
            WHERE userId=${userId} AND timestamp BETWEEN ${start} AND ${end}
          ),2) AS percentage
        FROM Heartbeat
        WHERE userId=${userId} AND timestamp BETWEEN ${start} AND ${end}
          AND editor IS NOT NULL
        GROUP BY editor
        ORDER BY total_seconds DESC
      `,
      prisma.$queryRaw`
        SELECT p.name AS project_name, p.repositoryUrl,
          COUNT(*) AS heartbeat_count, SUM(h.duration) AS total_seconds,
          ROUND(SUM(h.duration)*100.0/(
            SELECT SUM(duration) FROM Heartbeat
            WHERE userId=${userId} AND timestamp BETWEEN ${start} AND ${end}
          ),2) AS percentage
        FROM Heartbeat h
        LEFT JOIN Project p ON h.projectId=p.id
        WHERE h.userId=${userId} AND h.timestamp BETWEEN ${start} AND ${end}
        GROUP BY p.id,p.name,p.repositoryUrl
        ORDER BY total_seconds DESC
      `
    ]);

    const dailyRows = await prisma.dailySummary.findMany({
      where: { userId, summaryDate: { gte: start, lte: end } },
      select: { summaryDate: true, totalDuration: true },
      orderBy: { summaryDate: 'desc' }
    });
    const dailyStats = dailyRows.map(r => ({
      date: r.summaryDate.toISOString().split('T')[0],
      total_seconds: parseFloat(r.totalDuration.toString())
    }));

    let bestDays = [];
    if (range !== 'today') {
      bestDays = [...dailyStats]
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 3);

      for (let day of bestDays) {
        const coding = await prisma.codingSession.aggregate({
          where: {
            userId,
            startTime: {
              gte: new Date(`${day.date}T00:00:00.000Z`),
              lte: new Date(`${day.date}T23:59:59.999Z`)
            }
          },
          _sum: { totalLines: true }
        });
        day.total_lines = coding._sum.totalLines || 0;
      }
    }

    const codingAgg = await prisma.codingSession.aggregate({
      where: { userId, startTime: { gte: start, lte: end } },
      _sum: { duration: true, totalLines: true }
    });
    const totalCodingTime = codingAgg._sum.duration || 0;
    const totalLinesWritten = codingAgg._sum.totalLines || 0;

    const sessionDaysResult = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT DATE("startTime")) AS day_count
      FROM "CodingSession"
      WHERE "userId" = ${userId} AND "startTime" BETWEEN ${start} AND ${end}
    `;
    const codingDayCount = sessionDaysResult[0]?.day_count || 0;
    const codingDailyAverage = codingDayCount > 0
      ? Math.round(totalCodingTime / codingDayCount)
      : 0;

    const sessions = await prisma.codingSession.findMany({
      where: { userId, startTime: { gte: start, lte: end } },
      select: { languages: true }
    });
    const languagesUsed = Array.from(
      new Set(sessions.flatMap(s => s.languages || []))
    );

    return res.json({
      data: {
        range: {
          start: start.toISOString(),
          end: end.toISOString(),
          range,
          timezone: 'UTC'
        },
        total_seconds: totalSeconds,
        daily_average: dailyAverage,
        languages: languageStats,
        editors: editorStats,
        projects: projectStats,
        daily_stats: dailyStats,
        best_days: bestDays, // Included bestDays data here
        all_time: {
          total_coding_time: totalCodingTime,
          total_lines_written: totalLinesWritten,
          languages_used: languagesUsed,
          daily_average: codingDailyAverage
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;


    
// GET /heatmap?year=<year>
router.get('/heatmap', authenticateUser, async (req, res) => {
  try {
    let start, end;
    if (req.query.year) {
      const year = parseInt(req.query.year, 10);
      start = new Date(year, 0, 1);
      end = new Date(year, 11, 31, 23, 59, 59);
    } else {
      end = new Date();
      start = new Date(end);
      start.setFullYear(end.getFullYear() - 1);
    }

    const rows = await prisma.dailySummary.findMany({
      where: {
        userId: req.user.id,
        summaryDate: { gte: start, lte: end }
      },
      select: {
        summaryDate: true,
        totalDuration: true
      },
      orderBy: { summaryDate: 'asc' }
    });

    const heatmap = rows.map(r => ({
      date: r.summaryDate.toISOString().split('T')[0],
      total_seconds: parseFloat(r.totalDuration.toString())
    }));

    return res.json({ data: heatmap });
  } catch (error) {
    logger.error('Error fetching heatmap:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;