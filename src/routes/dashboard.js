const express = require('express');
const router = express.Router();
const { prisma, redis } = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const { checkHistoryAccess } = require('../middleware/tierLimits');
const logger = require('../utils/logger');

const CACHE_TTL = 3600; // 1 hour cache

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

    // Try to get cached data
    const cacheKey = `dashboard:${req.user.id}:${range}:${start.toISOString()}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json({ data: JSON.parse(cachedData) });
    }

    // Fetch all required metrics in parallel
    const [
      codingStats,
      lineStats,
      hourlyBreakdown,
      languageBreakdown,
      projectStats,
      dailyActivity,
      comparisonStats
    ] = await Promise.all([
      // Overall coding statistics
      prisma.heartbeat.aggregate({
        where: {
          userId: req.user.id,
          timestamp: { gte: start, lte: end }
        },
        _count: true,
        _sum: { duration: true }
      }),

      // Line count statistics
      prisma.$queryRaw`
        SELECT 
          SUM(CASE WHEN is_write THEN lines ELSE 0 END) as total_lines_written,
          COUNT(DISTINCT CASE WHEN is_write THEN entity END) as files_modified,
          MAX(lines) as max_lines_per_file,
          AVG(CASE WHEN is_write THEN lines ELSE 0 END) as avg_lines_per_write
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND lines IS NOT NULL
      `,

      // Hourly breakdown with line counts
      prisma.$queryRaw`
        SELECT 
          EXTRACT(HOUR FROM timestamp) as hour,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds,
          SUM(CASE WHEN is_write THEN lines ELSE 0 END) as lines_written,
          COUNT(DISTINCT entity) as files_touched
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY EXTRACT(HOUR FROM timestamp)
        ORDER BY hour ASC
      `,

      // Language breakdown with line counts
      prisma.$queryRaw`
        SELECT 
          language,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds,
          SUM(CASE WHEN is_write THEN lines ELSE 0 END) as lines_written,
          COUNT(DISTINCT entity) as files_touched,
          AVG(CASE WHEN is_write THEN lines ELSE 0 END) as avg_lines_per_write
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND language IS NOT NULL
        GROUP BY language
        ORDER BY total_seconds DESC
      `,

      // Project statistics with line counts
      prisma.$queryRaw`
        SELECT 
          p.name as project_name,
          COUNT(*) as heartbeat_count,
          SUM(h.duration) as total_seconds,
          SUM(CASE WHEN h.is_write THEN h.lines ELSE 0 END) as lines_written,
          COUNT(DISTINCT h.entity) as files_touched,
          AVG(CASE WHEN h.is_write THEN h.lines ELSE 0 END) as avg_lines_per_write
        FROM Heartbeat h
        LEFT JOIN Project p ON h.projectId = p.id
        WHERE h.userId = ${req.user.id}
          AND h.timestamp BETWEEN ${start} AND ${end}
        GROUP BY p.id, p.name
        ORDER BY total_seconds DESC
      `,

      // Daily activity with line counts
      prisma.$queryRaw`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as heartbeat_count,
          SUM(duration) as total_seconds,
          SUM(CASE WHEN is_write THEN lines ELSE 0 END) as lines_written,
          COUNT(DISTINCT entity) as files_touched,
          MAX(CASE WHEN is_write THEN lines ELSE 0 END) as max_lines_written
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `,

      // Comparison with previous period
      getPreviousPeriodStats(req.user.id, start, end)
    ]);

    // Calculate summary statistics
    const summary = {
      total_coding_time: codingStats._sum.duration || 0,
      total_heartbeats: codingStats._count || 0,
      total_lines_written: lineStats[0]?.total_lines_written || 0,
      files_modified: lineStats[0]?.files_modified || 0,
      max_lines_per_file: lineStats[0]?.max_lines_per_file || 0,
      avg_lines_per_write: Math.round(lineStats[0]?.avg_lines_per_write || 0),
      daily_average_lines: Math.round((lineStats[0]?.total_lines_written || 0) / 
        Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))),
      languages_used: languageBreakdown.length,
      projects_worked_on: projectStats.length
    };

    // Calculate trends and comparisons
    const trends = calculateTrends(dailyActivity);
    const comparisons = calculateComparisons(summary, comparisonStats);

    const dashboardData = {
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        range
      },
      summary,
      trends,
      comparisons,
      hourly_breakdown: hourlyBreakdown,
      languages: languageBreakdown,
      projects: projectStats,
      daily_activity: dailyActivity
    };

    // Cache the dashboard data
    await redis.set(cacheKey, JSON.stringify(dashboardData), 'EX', CACHE_TTL);

    res.json({ data: dashboardData });
  } catch (error) {
    logger.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contribution graph data (similar to GitHub's activity graph)
router.get('/contributions', authenticateUser, async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const start = new Date(year, 0, 1); // January 1st of the year
    const end = new Date(year, 11, 31, 23, 59, 59); // December 31st of the year

    // Try to get cached data
    const cacheKey = `contributions:${req.user.id}:${year}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json({ data: JSON.parse(cachedData) });
    }

    // Get daily contribution data
    const contributions = await prisma.$queryRaw`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as total_contributions,
        SUM(duration) as total_seconds,
        SUM(CASE WHEN is_write THEN lines ELSE 0 END) as lines_written,
        COUNT(DISTINCT entity) as files_touched
      FROM Heartbeat
      WHERE userId = ${req.user.id}
        AND timestamp BETWEEN ${start} AND ${end}
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `;

    // Calculate contribution levels (0-4) similar to GitHub
    const contributionLevels = contributions.map(day => {
      const score = calculateContributionScore(day);
      return {
        date: day.date,
        count: day.total_contributions,
        level: getContributionLevel(score),
        details: {
          coding_time: day.total_seconds,
          lines_written: day.lines_written,
          files_touched: day.files_touched
        }
      };
    });

    // Fill in missing dates with level 0
    const allDates = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const existing = contributionLevels.find(c => c.date.toISOString().split('T')[0] === dateStr);
      if (!existing) {
        allDates.push({
          date: dateStr,
          count: 0,
          level: 0,
          details: {
            coding_time: 0,
            lines_written: 0,
            files_touched: 0
          }
        });
      } else {
        allDates.push({
          ...existing,
          date: dateStr
        });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const data = {
      year,
      total_contributions: contributions.reduce((sum, day) => sum + day.total_contributions, 0),
      contributions: allDates
    };

    // Cache the contribution data
    await redis.set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL);

    res.json({ data });
  } catch (error) {
    logger.error('Error fetching contribution data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get streak information
router.get('/streaks', authenticateUser, async (req, res) => {
  try {
    const cacheKey = `streaks:${req.user.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json({ data: JSON.parse(cachedData) });
    }

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

    // Cache the streak data
    await redis.set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL);

    res.json({ data });
  } catch (error) {
    logger.error('Error fetching streak data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get previous period stats
async function getPreviousPeriodStats(userId, start, end) {
  const duration = end - start;
  const previousStart = new Date(start.getTime() - duration);
  const previousEnd = new Date(end.getTime() - duration);

  return prisma.$queryRaw`
    SELECT 
      SUM(duration) as total_seconds,
      SUM(CASE WHEN is_write THEN lines ELSE 0 END) as total_lines_written,
      COUNT(DISTINCT entity) as files_modified
    FROM Heartbeat
    WHERE userId = ${userId}
      AND timestamp BETWEEN ${previousStart} AND ${previousEnd}
  `;
}

// Helper function to calculate trends
function calculateTrends(dailyActivity) {
  if (!dailyActivity.length) {
    return {
      coding_time: 0,
      lines_written: 0,
      files_modified: 0
    };
  }

  const midPoint = Math.floor(dailyActivity.length / 2);
  const firstHalf = dailyActivity.slice(0, midPoint);
  const secondHalf = dailyActivity.slice(midPoint);

  const avgFirstHalf = {
    coding_time: average(firstHalf.map(d => d.total_seconds)),
    lines_written: average(firstHalf.map(d => d.lines_written)),
    files_modified: average(firstHalf.map(d => d.files_touched))
  };

  const avgSecondHalf = {
    coding_time: average(secondHalf.map(d => d.total_seconds)),
    lines_written: average(secondHalf.map(d => d.lines_written)),
    files_modified: average(secondHalf.map(d => d.files_touched))
  };

  return {
    coding_time: calculateTrendPercentage(avgFirstHalf.coding_time, avgSecondHalf.coding_time),
    lines_written: calculateTrendPercentage(avgFirstHalf.lines_written, avgSecondHalf.lines_written),
    files_modified: calculateTrendPercentage(avgFirstHalf.files_modified, avgSecondHalf.files_modified)
  };
}

// Helper function to calculate comparisons with previous period
function calculateComparisons(current, previous) {
  const prev = previous[0] || {};
  return {
    coding_time: calculateTrendPercentage(prev.total_seconds || 0, current.total_coding_time),
    lines_written: calculateTrendPercentage(prev.total_lines_written || 0, current.total_lines_written),
    files_modified: calculateTrendPercentage(prev.files_modified || 0, current.files_modified)
  };
}

function average(numbers) {
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
}

function calculateTrendPercentage(first, second) {
  if (!first) return 0;
  return ((second - first) / first) * 100;
}

// Helper function to calculate contribution score
function calculateContributionScore(day) {
  // Normalize each metric and combine them
  const timeScore = Math.min(day.total_seconds / 3600, 8) / 8; // Cap at 8 hours
  const linesScore = Math.min(day.lines_written / 500, 1); // Cap at 500 lines
  const filesScore = Math.min(day.files_touched / 10, 1); // Cap at 10 files

  // Weighted average of the scores
  return (timeScore * 0.4) + (linesScore * 0.4) + (filesScore * 0.2);
}

// Helper function to determine contribution level (0-4)
function getContributionLevel(score) {
  if (score === 0) return 0;
  if (score <= 0.25) return 1;
  if (score <= 0.5) return 2;
  if (score <= 0.75) return 3;
  return 4;
}

// Helper function to calculate streaks
function calculateStreaks(activeDays) {
  if (!activeDays.length) {
    return {
      current_streak: 0,
      longest_streak: 0,
      all_streaks: []
    };
  }

  const streaks = [];
  let currentStreak = {
    start: activeDays[0].date,
    end: activeDays[0].date,
    length: 1
  };

  let longestStreak = 1;
  let today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i < activeDays.length; i++) {
    const currentDate = new Date(activeDays[i].date);
    const previousDate = new Date(activeDays[i - 1].date);
    const dayDiff = (currentDate - previousDate) / (1000 * 60 * 60 * 24);

    if (dayDiff === 1) {
      // Continue streak
      currentStreak.end = currentDate;
      currentStreak.length++;
      longestStreak = Math.max(longestStreak, currentStreak.length);
    } else {
      // Break in streak
      streaks.push({ ...currentStreak });
      currentStreak = {
        start: currentDate,
        end: currentDate,
        length: 1
      };
    }
  }

  // Add the last streak
  streaks.push({ ...currentStreak });

  // Calculate if the current streak is still active
  const lastActiveDay = new Date(activeDays[activeDays.length - 1].date);
  const daysSinceLastActive = (today - lastActiveDay) / (1000 * 60 * 60 * 24);
  const currentStreakLength = daysSinceLastActive <= 1 ? streaks[streaks.length - 1].length : 0;

  return {
    current_streak: currentStreakLength,
    longest_streak: longestStreak,
    all_streaks: streaks
  };
}

module.exports = router; 