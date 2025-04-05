const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get leaderboards
router.get('/', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_7_days', language = null } = req.query;
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

    // Get user rankings based on coding time
    const rankings = await prisma.$queryRaw`
      WITH user_stats AS (
        SELECT 
          u.id,
          u.username,
          u.profile_url,
          SUM(h.duration) as total_seconds,
          COUNT(DISTINCT DATE(h.timestamp)) as days_coded,
          RANK() OVER (ORDER BY SUM(h.duration) DESC) as rank
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.timestamp BETWEEN ${start} AND ${end}
          ${language ? prisma.sql`AND h.language = ${language}` : prisma.sql``}
          AND u.isPrivate = false
        GROUP BY u.id, u.username, u.profile_url
      )
      SELECT 
        id,
        username,
        profile_url,
        total_seconds,
        days_coded,
        rank,
        CASE 
          WHEN rank = 1 THEN 'gold'
          WHEN rank = 2 THEN 'silver'
          WHEN rank = 3 THEN 'bronze'
          ELSE null
        END as badge
      FROM user_stats
      ORDER BY rank ASC
      LIMIT 100
    `;

    // Get current user's position
    const [currentUser] = await prisma.$queryRaw`
      WITH user_rankings AS (
        SELECT 
          u.id,
          RANK() OVER (ORDER BY SUM(h.duration) DESC) as rank,
          SUM(h.duration) as total_seconds,
          COUNT(DISTINCT DATE(h.timestamp)) as days_coded
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.timestamp BETWEEN ${start} AND ${end}
          ${language ? prisma.sql`AND h.language = ${language}` : prisma.sql``}
        GROUP BY u.id
      )
      SELECT * FROM user_rankings
      WHERE id = ${req.user.id}
    `;

    res.json({
      data: {
        range: {
          start: start.toISOString(),
          end: end.toISOString(),
          range,
          timezone: 'UTC'
        },
        current_user: currentUser ? {
          rank: currentUser.rank,
          total_seconds: currentUser.total_seconds,
          days_coded: currentUser.days_coded,
          running_total: currentUser.total_seconds
        } : null,
        language: language,
        page: 1,
        total_pages: 1,
        ranks: rankings.map(rank => ({
          user: {
            id: rank.id,
            username: rank.username,
            profile_url: rank.profile_url
          },
          rank: rank.rank,
          running_total: rank.total_seconds,
          total_seconds: rank.total_seconds,
          days_coded: rank.days_coded,
          badge: rank.badge
        }))
      }
    });
  } catch (error) {
    logger.error('Error fetching leaderboards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get available leaderboard options
router.get('/available', authenticateUser, async (req, res) => {
  try {
    const languages = await prisma.$queryRaw`
      SELECT DISTINCT language
      FROM Heartbeat
      WHERE language IS NOT NULL
      ORDER BY language ASC
    `;

    res.json({
      data: {
        ranges: ['last_7_days', 'last_30_days', 'last_6_months', 'last_year'],
        languages: languages.map(l => l.language)
      }
    });
  } catch (error) {
    logger.error('Error fetching leaderboard options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's leaderboard history
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_7_days', language = null } = req.query;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case 'last_7_days':
        start.setDate(start.getDate() - 7);
        break;
      case 'last_30_days':
        start.setDate(start.getDate() - 30);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range' });
    }

    const history = await prisma.$queryRaw`
      WITH daily_ranks AS (
        SELECT 
          DATE(h.timestamp) as date,
          u.id as user_id,
          SUM(h.duration) as daily_total,
          RANK() OVER (PARTITION BY DATE(h.timestamp) ORDER BY SUM(h.duration) DESC) as rank
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.timestamp BETWEEN ${start} AND ${end}
          ${language ? prisma.sql`AND h.language = ${language}` : prisma.sql``}
        GROUP BY DATE(h.timestamp), u.id
      )
      SELECT 
        date,
        rank,
        daily_total as total_seconds
      FROM daily_ranks
      WHERE user_id = ${req.user.id}
      ORDER BY date ASC
    `;

    res.json({
      data: history.map(day => ({
        date: day.date.toISOString().split('T')[0],
        rank: day.rank,
        total_seconds: day.total_seconds
      }))
    });
  } catch (error) {
    logger.error('Error fetching leaderboard history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 