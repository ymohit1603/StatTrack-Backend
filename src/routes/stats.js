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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    switch (range) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
        break;
      case 'last_24_hours':
        end = new Date(now);
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'last_7_days':
        end = new Date(now);
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last_30_days':
        end = new Date(now);
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last_6_months':
        end = new Date(now);
        start = new Date(end);
        start.setMonth(start.getMonth() - 6);
        break;
      case 'last_year':
        end = new Date(now);
        start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);
        break;
      case 'all_years':
        start = new Date(user.createdAt);
        end = new Date(now);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range parameter' });
    }

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date range calculated' });
    }

    const diff = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - diff);
    const prevEnd = new Date(end.getTime() - diff);

    const [currentSummary, currentDaily, currentLanguages, currentSessions] = await Promise.all([
      prisma.dailySummary.aggregate({
        where: { userId, summaryDate: { gte: start, lte: end } },
        _sum: { totalDuration: true },
      }),
      prisma.$queryRaw`
        SELECT DATE("summaryDate") as date, 
               SUM("totalDuration") as total_seconds,
               COUNT(*) as session_count
        FROM "DailySummary"
        WHERE "userId" = ${userId} 
        AND "summaryDate" BETWEEN ${start} AND ${end}
        GROUP BY DATE("summaryDate")
        ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT "language", 
               COUNT(*) as "Heartbeat_count",
               SUM("duration") as total_seconds,
               ROUND(SUM("duration") * 100.0 / (
                 SELECT SUM("duration") FROM "Heartbeat"
                 WHERE "userId" = ${userId} AND "timestamp" BETWEEN ${start} AND ${end}
               ), 2) as percentage
        FROM "Heartbeat"
        WHERE "userId" = ${userId} 
        AND "timestamp" BETWEEN ${start} AND ${end}
        AND "language" IS NOT NULL
        GROUP BY "language"
        ORDER BY total_seconds DESC
      `,
      prisma.codingSession.findMany({
        where: {
          userId,
          startTime: { gte: start, lte: end }
        },
        orderBy: { startTime: 'desc' },
        take: 10,
        select: {
          startTime: true,
          endTime: true,
          duration: true,
          totalLines: true,
          languages: true,
        }
      })
    ]);

    const prevSummary = await prisma.dailySummary.aggregate({
      where: { userId, summaryDate: { gte: prevStart, lte: prevEnd } },
      _sum: { totalDuration: true },
    });

    const linesData = await prisma.codingSession.groupBy({
      by: ['startTime'],
      where: {
        userId,
        startTime: { gte: start, lte: end }
      },
      _sum: {
        totalLines: true
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    const leaderboard = await prisma.$queryRaw`
      WITH RankedUsers AS (
        SELECT 
          u."id",
          u."username",
          u."profile_url",
          SUM(ds."totalDuration") as total_seconds,
          COUNT(DISTINCT DATE(ds."summaryDate")) as days_coded,
          RANK() OVER (ORDER BY SUM(ds."totalDuration") DESC) as rank
        FROM "User" u
        LEFT JOIN "DailySummary" ds ON u."id" = ds."userId"
        WHERE ds."summaryDate" BETWEEN ${start} AND ${end}
        GROUP BY u."id", u."username", u."profile_url"
      )
      SELECT *
      FROM RankedUsers
      WHERE "id" = ${userId}
      OR rank <= 10
    `;

    const goals = {
      daily_coding_time: {
        target: 14400,
        current: currentSummary._sum.totalDuration || 0,
        progress: ((currentSummary._sum.totalDuration || 0) / 14400) * 100
      },
      weekly_coding_days: {
        target: 5,
        current: currentDaily.length,
        progress: (currentDaily.length / 5) * 100
      }
    };

    return res.json({
      data: {
        range: {
          start: start.toISOString(),
          end: end.toISOString(),
          range,
          timezone: 'UTC'
        },
        summary: {
          total_seconds: currentSummary._sum.totalDuration || 0,
          prev_period_seconds: prevSummary._sum.totalDuration || 0,
          change_percentage: prevSummary._sum.totalDuration 
            ? ((currentSummary._sum.totalDuration - prevSummary._sum.totalDuration) / prevSummary._sum.totalDuration) * 100 
            : 0
        },
        daily_stats: currentDaily.map(day => ({
          date: day.date?.toISOString().split('T')[0] || '',
          total_seconds: Number(day.total_seconds),
          session_count: Number(day.session_count)
        })),
        languages: currentLanguages.map(lang => ({
          language: lang.language,
          Heartbeat_count: Number(lang.Heartbeat_count),
          total_seconds: Number(lang.total_seconds),
          percentage: Number(lang.percentage)
        })),
        lines_per_day: linesData.map(data => ({
          date: data.startTime.toISOString().split('T')[0],
          total_lines: data._sum.totalLines || 0
        })),
        recent_sessions: currentSessions.map(session => ({
          start_time: session.startTime,
          end_time: session.endTime,
          duration: session.duration,
          total_lines: session.totalLines,
          languages: session.languages
        })),
        goals,
        leaderboard: leaderboard.map(user => ({
          id: user.id,
          username: user.username,
          profile_url: user.profile_url,
          total_seconds: Number(user.total_seconds),
          days_coded: Number(user.days_coded),
          rank: Number(user.rank)
        }))
      }
    });

  } catch (error) {
    logger.error('Error fetching summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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
      total_seconds: Number(r.totalDuration)
    }));

    return res.json({ data: heatmap });
  } catch (error) {
    logger.error('Error fetching heatmap:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
