const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { prisma } = require('../config/db');
const NodeCache = require('node-cache');
const compression = require('compression');

// Initialize cache with 5 minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Cache keys
const CACHE_KEYS = {
  SUMMARY: (userId, range) => `summary:${userId}:${range}`,
  HEATMAP: (userId, year) => `heatmap:${userId}:${year}`,
  LEADERBOARD: (range) => `leaderboard:${range}`,
  USER_PROFILE: (userId) => `user:${userId}`,
};

// Cache invalidation helper
const invalidateCache = (userId) => {
  const keys = cache.keys();
  const userKeys = keys.filter(key => key.includes(`:${userId}:`));
  if (userKeys.length) {
    cache.del(userKeys);
  }
};

// Helper function to calculate date ranges
const getDateRange = (range, userCreatedAt) => {
  const now = new Date();
  let start, end;

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
      start = new Date(userCreatedAt);
      end = new Date(now);
      break;
    default:
      throw new Error('Invalid range parameter');
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date range calculated');
  }

  return { start, end };
};

// Helper function to calculate previous period
const getPreviousPeriod = (start, end) => {
  const diff = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - diff),
    end: new Date(end.getTime() - diff),
  };
};

// Helper function to format response data
const formatResponseData = (data) => {
  // default arrays
  const currentDaily = data.currentDaily || [];
  const prevDaily = data.prevDaily || [];

  // convert BigInt sums to Number
  const totalDuration = Number(data.currentSummary?._sum?.totalDuration || 0);
  const prevTotalDuration = Number(data.prevSummary?._sum?.totalDuration || 0);

  // normalize daily entries
  const normalizedCurrentDaily = currentDaily.map(day => ({
    date: typeof day.date === 'string' ? day.date : day.date.toISOString().split('T')[0],
    total_seconds: Number(day.total_seconds || 0),
    session_count: Number(day.session_count || 0),
  }));
  const normalizedPrevDaily = prevDaily.map(day => ({
    date: typeof day.date === 'string' ? day.date : day.date.toISOString().split('T')[0],
    total_seconds: Number(day.total_seconds || 0),
    session_count: Number(day.session_count || 0),
  }));

  const today = new Date().toISOString().split('T')[0];
  const todayStats = normalizedCurrentDaily.find(day => day.date === today) || { total_seconds: 0, session_count: 0 };
  const yesterdayStats = normalizedPrevDaily.find(day => day.date === today) || { total_seconds: 0, session_count: 0 };

  const avgDailySeconds = normalizedCurrentDaily.length
    ? totalDuration / normalizedCurrentDaily.length
    : 0;
  const prevAvgDailySeconds = normalizedPrevDaily.length
    ? prevTotalDuration / normalizedPrevDaily.length
    : 0;

  const totalSessions = normalizedCurrentDaily.reduce((sum, day) => sum + day.session_count, 0);
  const prevTotalSessions = normalizedPrevDaily.reduce((sum, day) => sum + day.session_count, 0);

  return {
    range: {
      start: data.start.toISOString(),
      end: data.end.toISOString(),
      range: data.range,
      timezone: 'UTC',
    },
    summary: {
      total_seconds: totalDuration,
      prev_period_seconds: prevTotalDuration,
      change_percentage: prevTotalDuration
        ? ((totalDuration - prevTotalDuration) / prevTotalDuration) * 100
        : 0,
      today_seconds: todayStats.total_seconds,
      today_change_percentage: yesterdayStats.total_seconds
        ? ((todayStats.total_seconds - yesterdayStats.total_seconds) / yesterdayStats.total_seconds) * 100
        : 0,
      avg_daily_seconds: avgDailySeconds,
      avg_daily_change_percentage: prevAvgDailySeconds
        ? ((avgDailySeconds - prevAvgDailySeconds) / prevAvgDailySeconds) * 100
        : 0,
      total_sessions: totalSessions,
      sessions_change_percentage: prevTotalSessions
        ? ((totalSessions - prevTotalSessions) / prevTotalSessions) * 100
        : 0,
    },
    daily_stats: normalizedCurrentDaily,
    languages: (data.currentLanguages || []).map(lang => ({
      language: lang.language,
      session_count: Number(lang.session_count),
      total_seconds: Number(lang.total_seconds),
      percentage: Number(lang.percentage),
    })),
    lines_per_day: (data.linesData || []).map(d => ({
      date: d.startTime.toISOString().split('T')[0],
      total_lines: Number(d._sum?.totalLines || 0),
    })),
    recent_sessions: (data.currentSessions || []).map(s => ({
      start_time: s.startTime,
      end_time: s.endTime,
      duration: Number(s.duration),
      total_lines: Number(s.totalLines),
      languages: s.languages,
    })),
    goals: data.goals || {
      daily_coding_time: { target: 14400, current: 0, progress: 0 },
      weekly_coding_days: { target: 5, current: 0, progress: 0 },
    },
    leaderboard: (data.leaderboard || []).map(u => ({
      id: u.id,
      username: u.username,
      profile_url: u.profile_url,
      total_seconds: Number(u.total_seconds),
      days_coded: Number(u.days_coded),
      rank: Number(u.rank),
    })),
  };
};

// Optimized query to fetch user data with caching
const getUserData = async (userId) => {
  const cacheKey = CACHE_KEYS.USER_PROFILE(userId);
  
  try {
    // Check cache first
    const cachedUser = cache.get(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true,
        username: true,
        email: true,
        createdAt: true,
        profile_url: true,
        preferences: true
      }
    });
    
    if (user) {
      cache.set(cacheKey, user, 3600); // Cache for 1 hour
    }
    
    return user;
  } catch (error) {
    logger.error('Error fetching user data:', error);
    throw error;
  }
};

// Optimized query to fetch leaderboard data with caching
const getLeaderboardData = async (start, end, userId, page = 1, limit = 10) => {
  const rangeKey = `${start.toISOString()}:${end.toISOString()}`;
  const cacheKey = `${CACHE_KEYS.LEADERBOARD(rangeKey)}:${page}:${limit}`;
  
  try {
    // Check cache first
    const cachedLeaderboard = cache.get(cacheKey);
    if (cachedLeaderboard) {
      return cachedLeaderboard;
    }
    
    const offset = (page - 1) * limit;
    
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
      OR rank BETWEEN ${offset + 1} AND ${offset + limit}
      ORDER BY rank ASC
    `;
    
    cache.set(cacheKey, leaderboard, 300); // Cache for 5 minutes
    return leaderboard;
  } catch (error) {
    logger.error('Error fetching leaderboard data:', error);
    throw error;
  }
};

// Optimized query to fetch language stats using CodingSession instead of Heartbeat
const getLanguageStats = async (userId, start, end) => {
  // Use CodingSession instead of Heartbeat for better performance
  return prisma.$queryRaw`
    WITH TotalDuration AS (
      SELECT COALESCE(SUM("duration"), 0) as total
      FROM "CodingSession"
      WHERE "userId" = ${userId} AND "startTime" BETWEEN ${start} AND ${end}
    )
    SELECT 
      unnest("languages") as language, 
      COUNT(*) as session_count,
      SUM("duration") as total_seconds,
      CASE 
        WHEN (SELECT total FROM TotalDuration) = 0 THEN 0
        ELSE ROUND(SUM("duration") * 100.0 / (SELECT total FROM TotalDuration), 2)
      END as percentage
    FROM "CodingSession"
    WHERE "userId" = ${userId} 
    AND "startTime" BETWEEN ${start} AND ${end}
    AND "languages" IS NOT NULL
    GROUP BY language
    ORDER BY total_seconds DESC
  `;
};

// Add compression middleware
router.use(compression());

// Optimized stats endpoint
router.get('/summary', authenticateUser, async (req, res) => {
  const cacheKey = CACHE_KEYS.SUMMARY(req.user.id, req.query.range);
  
  try {
    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cachedData);
    }

    // Get date range
    const { start, end } = getDateRange(req.query.range, req.user.createdAt);
    
    // Fetch data in parallel
    const [userData, leaderboardData, languageStats] = await Promise.all([
      getUserData(req.user.id),
      getLeaderboardData(start, end, req.user.id),
      getLanguageStats(req.user.id, start, end)
    ]);

    // Format response data
    const responseData = formatResponseData({
      userData,
      leaderboardData,
      languageStats,
      start,
      end,
      range: req.query.range
    });

    // Cache the result
    cache.set(cacheKey, responseData, 300);
    
    // Set cache headers
    res.set('Cache-Control', 'public, max-age=300');
    res.json(responseData);
  } catch (error) {
    logger.error('Stats fetch error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /heatmap?year=<year>
router.get('/heatmap', authenticateUser, async (req, res) => {
  try {
    let start, end;
    const userId = req.user.id;
    
    if (req.query.year) {
      const year = parseInt(req.query.year, 10);
      if (isNaN(year)) {
        return res.status(400).json({ error: 'Invalid year parameter' });
      }
      
      start = new Date(year, 0, 1);
      end = new Date(year, 11, 31, 23, 59, 59);
    } else {
      // Default to showing the last year of data
      end = new Date();
      start = new Date(end);
      start.setFullYear(end.getFullYear() - 1);
    }
    
    // Check cache first
    const cacheKey = CACHE_KEYS.HEATMAP(userId, start.getFullYear());
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      logger.info(`Cache hit for heatmap: ${cacheKey}`);
      return res.json(cachedData);
    }
    
    logger.info(`Cache miss for heatmap: ${cacheKey}`);

    // Optimized query with proper indexing - using DailySummary instead of Heartbeat
    const rows = await prisma.dailySummary.findMany({
      where: {
        userId,
        summaryDate: { gte: start, lte: end }
      },
      select: {
        summaryDate: true,
        totalDuration: true
      },
      orderBy: { summaryDate: 'asc' }
    });

    // Format data for GitHub-style heatmap
    const heatmap = rows.map(r => ({
      date: r.summaryDate.toISOString().split('T')[0],
      total_seconds: Number(r.totalDuration)
    }));
    
    // Add empty days to ensure continuous data
    const allDays = [];
    const currentDate = new Date(start);
    
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const existingDay = heatmap.find(day => day.date === dateStr);
      
      if (existingDay) {
        allDays.push(existingDay);
      } else {
        allDays.push({
          date: dateStr,
          total_seconds: 0
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const responseData = allDays;
    
    // Cache the response
    cache.set(cacheKey, responseData, 3600); // Cache for 1 hour
    
    return res.json(responseData);
  } catch (error) {
    logger.error('Error fetching heatmap:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear cache endpoint for admin use
router.post('/clear-cache', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin (implement your admin check logic)
    const isAdmin = req.user.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { type, userId, range } = req.body;
    
    if (type === 'summary' && userId && range) {
      const cacheKey = CACHE_KEYS.SUMMARY(userId, range);
      cache.del(cacheKey);
      logger.info(`Cleared cache for summary: ${cacheKey}`);
    } else if (type === 'heatmap' && userId && req.body.year) {
      const cacheKey = CACHE_KEYS.HEATMAP(userId, req.body.year);
      cache.del(cacheKey);
      logger.info(`Cleared cache for heatmap: ${cacheKey}`);
    } else if (type === 'leaderboard' && range) {
      const cacheKey = CACHE_KEYS.LEADERBOARD(range);
      cache.del(cacheKey);
      logger.info(`Cleared cache for leaderboard: ${cacheKey}`);
    } else if (type === 'all') {
      cache.flushAll();
      logger.info('Cleared all cache');
    } else {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    return res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
