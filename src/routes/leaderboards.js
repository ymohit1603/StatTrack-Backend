const express = require('express');
const router = express.Router();
const { PrismaClient, Prisma } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

// Initialize cache with 5 minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Initialize rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

const prisma = new PrismaClient();

// Cache keys
const CACHE_KEYS = {
  LEADERBOARD: (range, language) => `leaderboard:${range}:${language || 'all'}`,
  AVAILABLE: 'available_options',
  HISTORY: (userId, range, language) => `history:${userId}:${range}:${language || 'all'}`
};

// Helper function to calculate date range
const getDateRange = (range) => {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
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
      throw new Error('Invalid range parameter');
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date range calculated');
  }

  return { start, end };
};

// Helper: format leaderboard response
function formatLeaderboardResponse(rankings, currentUser, range, language, start, end) {
  return {
    data: {
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        range,
        timezone: 'UTC'
      },
      current_user: currentUser
        ? {
            rank: Number(currentUser.rank),
            total_seconds: Number(currentUser.total_seconds),
            days_coded: Number(currentUser.days_coded),
            running_total: Number(currentUser.total_seconds),
          }
        : null,
      language,
      page: 1,
      total_pages: 1,
      ranks: rankings.map((r) => ({
        user: {
          id: Number(r.id),
          username: r.username,
          profile_url: r.profile_url,
          app_name:r.app_name
        },
        rank: Number(r.rank),
        running_total: Number(r.total_seconds),
        total_seconds: Number(r.total_seconds),
        days_coded: Number(r.days_coded),
        badge: r.badge,
        languages_breakdown: (r.languages_breakdown || []).map(l => ({
          language: l.language,
          total_seconds: Number(l.total_seconds)
        }))
      }))
    }
  };
}

// Optimized query to fetch leaderboard data with per-language breakdown
const getLeaderboardData = async (start, end, language = null) => {
  const langFilterOverall = language
    ? Prisma.sql`AND cs.languages @> ARRAY[${language}]::text[]`
    : Prisma.empty;
  const langFilterBreakdown = language
    ? Prisma.sql`AND lang = ${language}`
    : Prisma.empty;

  return prisma.$queryRaw`
    WITH RankedUsers AS (
      SELECT 
        u.id,
        u.username,
        u.profile_url,
        u.app_name,
        SUM(ds."totalDuration") as total_seconds,
        COUNT(DISTINCT DATE(ds."summaryDate")) as days_coded,
        RANK() OVER (ORDER BY SUM(ds."totalDuration") DESC) as rank
      FROM "User" u
      JOIN "DailySummary" ds ON u.id = ds."userId"
      JOIN "CodingSession" cs ON u.id = cs."userId" AND DATE(cs."startTime") = DATE(ds."summaryDate")
      WHERE ds."summaryDate" BETWEEN ${start} AND ${end}
        AND u."isPrivate" = false
        ${langFilterOverall}
      GROUP BY u.id, u.username, u.profile_url
      HAVING SUM(ds."totalDuration") > 0
    ),
    LangTotals AS (
      SELECT
        u.id AS user_id,
        lang AS language,
        SUM(ds."totalDuration") AS total_seconds
      FROM "User" u
      JOIN "DailySummary" ds ON u.id = ds."userId"
      JOIN "CodingSession" cs ON u.id = cs."userId" AND DATE(cs."startTime") = DATE(ds."summaryDate")
      CROSS JOIN UNNEST(cs.languages) AS lang
      WHERE ds."summaryDate" BETWEEN ${start} AND ${end}
        AND u."isPrivate" = false
        ${langFilterBreakdown}
      GROUP BY u.id, lang
    )
    SELECT 
      ru.id,
      ru.username,
      ru.profile_url,
      ru.app_name,
      ru.total_seconds,
      ru.days_coded,
      ru.rank,
      CASE 
        WHEN ru.rank = 1 THEN 'gold'
        WHEN ru.rank = 2 THEN 'silver'
        WHEN ru.rank = 3 THEN 'bronze'
        ELSE NULL
      END AS badge,
      (
        SELECT json_agg(json_build_object('language', lt.language, 'total_seconds', lt.total_seconds))
        FROM LangTotals lt
        WHERE lt.user_id = ru.id
      ) AS languages_breakdown
    FROM RankedUsers ru
    ORDER BY ru.rank
    LIMIT 100;
  `;
};

// Optimized query to fetch current user's ranking
const getCurrentUserRanking = async (userId, start, end, language = null) => {
  const langFilter = language ? Prisma.sql`AND cs.languages @> ARRAY[${language}]::text[]` : Prisma.empty;

  const [ranking] = await prisma.$queryRaw`
    WITH RankedUsers AS (
      SELECT 
        u.id,
        RANK() OVER (ORDER BY SUM(ds."totalDuration") DESC) as rank,
        SUM(ds."totalDuration") as total_seconds,
        COUNT(DISTINCT DATE(ds."summaryDate")) as days_coded
      FROM "User" u
      JOIN "DailySummary" ds ON u.id = ds."userId"
      JOIN "CodingSession" cs ON u.id = cs."userId" AND DATE(cs."startTime") = DATE(ds."summaryDate")
      WHERE ds."summaryDate" BETWEEN ${start} AND ${end}
        ${langFilter}
      GROUP BY u.id
      HAVING SUM(ds."totalDuration") > 0
    )
    SELECT id, rank, total_seconds, days_coded
    FROM RankedUsers
    WHERE id = ${userId};
  `;

  return ranking;
};

/** GET /leaderboards */
router.get('/', authenticateUser, limiter, async (req, res) => {
  try {
    const range = req.query.range || 'last_7_days';

    // Normalize the language param so that "null"/""/"all" mean no filter
    let { language: rawLang } = req.query;
    if (rawLang === 'null' || rawLang === '' || rawLang === 'all') {
      rawLang = null;
    }
    const language = rawLang;

    const cacheKey = CACHE_KEYS.LEADERBOARD(range, language);

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit ${cacheKey}`);
      return res.json(cached);
    }
    logger.info(`Cache miss ${cacheKey}`);

    // Calculate date range
    const { start, end } = getDateRange(range);

    // Fetch leaderboard data and current user ranking in parallel
    const [rankings, currentUser] = await Promise.all([
      getLeaderboardData(start, end, language),
      getCurrentUserRanking(req.user.id, start, end, language)
    ]);

    const response = formatLeaderboardResponse(rankings, currentUser, range, language, start, end);

    // Cache the response
    cache.set(cacheKey, response, 300); // Cache for 5 minutes

    res.json(response);
  } catch (err) {
    logger.error('Error fetching leaderboards:', err);
    if (err.message.includes('Invalid range parameter') || err.message.includes('Invalid date range calculated')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /leaderboards/available */
router.get('/available', authenticateUser, limiter, async (req, res) => {
  try {
    const cacheKey = CACHE_KEYS.AVAILABLE;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit ${cacheKey}`);
      return res.json(cached);
    }

    // Get unique languages from coding sessions
    const sessions = await prisma.codingSession.findMany({
      select: { languages: true },
      distinct: ['languages']
    });

    // Flatten and get unique languages
    const uniqueLanguages = [...new Set(sessions.flatMap(s => s.languages))].sort();

    const response = {
      data: {
        ranges: ['today', 'last_7_days', 'last_30_days', 'last_6_months', 'last_year'],
        languages: uniqueLanguages
      }
    };

    // Cache for 1 hour since this data changes less frequently
    cache.set(cacheKey, response, 3600);
    res.json(response);
  } catch (err) {
    logger.error('Error fetching available options:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /leaderboards/history */
router.get('/history', authenticateUser, limiter, async (req, res) => {
  try {
    const range = req.query.range || 'last_7_days';

    let { language: rawLang } = req.query;
    if (rawLang === 'null' || rawLang === '' || rawLang === 'all') {
      rawLang = null;
    }
    const language = rawLang;

    const cacheKey = CACHE_KEYS.HISTORY(req.user.id, range, language);
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit ${cacheKey}`);
      return res.json(cached);
    }

    const { start, end } = getDateRange(range);
    const langFilter = language ? Prisma.sql`AND ds."language" = ${language}` : Prisma.empty;

    const history = await prisma.$queryRaw`
      WITH daily_ranks AS (
        SELECT 
          DATE(ds."summaryDate") AS date,
          u.id AS user_id,
          SUM(ds."totalDuration") as total_seconds,
          RANK() OVER (PARTITION BY DATE(ds."summaryDate") ORDER BY SUM(ds."totalDuration") DESC) AS rank
        FROM "User" u
        JOIN "DailySummary" ds ON u.id = ds."userId"
        WHERE ds."summaryDate" BETWEEN ${start} AND ${end}
          ${langFilter}
        GROUP BY DATE(ds."summaryDate"), u.id
        HAVING SUM(ds."totalDuration") > 0
      )
      SELECT date, rank, total_seconds
      FROM daily_ranks
      WHERE user_id = ${req.user.id}
      ORDER BY date ASC;
    `;

    const response = {
      data: history.map((d) => ({
        date: d.date.toISOString().split('T')[0],
        rank: Number(d.rank),
        total_seconds: Number(d.total_seconds)
      }))
    };

    // Cache for 5 minutes
    cache.set(cacheKey, response, 300);
    res.json(response);
  } catch (err) {
    logger.error('Error fetching history:', err);
    if (err.message.includes('Invalid range parameter') || err.message.includes('Invalid date range calculated')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /leaderboards/clear-cache */
router.post('/clear-cache', authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { type, range, language } = req.body;
    switch (type) {
      case 'leaderboard':
        cache.del(CACHE_KEYS.LEADERBOARD(range, language));
        break;
      case 'available':
        cache.del(CACHE_KEYS.AVAILABLE);
        break;
      case 'history':
        cache.del(CACHE_KEYS.HISTORY(req.user.id, range, language));
        break;
      case 'all':
        cache.flushAll();
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Error clearing cache:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
