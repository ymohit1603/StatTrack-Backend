const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const {getSummaries} = require('../workers/summaryWorker')
const { getTownhallForUser } = require('../utils/townhall');

const prisma = new PrismaClient();

// Get current user
router.get('/current', authenticateUser, async (req, res) => {
  try {
    const [user, townhall] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
      }),
      getTownhallForUser(req.user.id)
    ]);

    res.json({ 
      data: {
        ...user,
        townhall
      }
    });
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update current user profile
router.patch('/current', authenticateUser, async (req, res) => {
  try {
    const {
      username,
      profile_url,
      website,
      github_username,
      twitter_username,
      linkedin_username,
      address,
      timezone,
      isPrivate,
      editors_used_public,
      categories_used_public,
      os_used_public,
      logged_time_public,
      app_name
    } = req.body;

    // Validate app_name if provided
    if (app_name && !['X', 'LinkedIn'].includes(app_name)) {
      return res.status(400).json({ error: 'Invalid app_name value' });
    }

    // Create update data object with only provided fields
    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (profile_url !== undefined) updateData.profile_url = profile_url;
    if (website !== undefined) updateData.website = website;
    if (github_username !== undefined) updateData.github_username = github_username;
    if (twitter_username !== undefined) updateData.twitter_username = twitter_username;
    if (linkedin_username !== undefined) updateData.linkedin_username = linkedin_username;
    if (address !== undefined) updateData.address = address;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate;
    if (editors_used_public !== undefined) updateData.editors_used_public = editors_used_public;
    if (categories_used_public !== undefined) updateData.categories_used_public = categories_used_public;
    if (os_used_public !== undefined) updateData.os_used_public = os_used_public;
    if (logged_time_public !== undefined) updateData.logged_time_public = logged_time_public;
    if (app_name !== undefined) updateData.app_name = app_name;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        profile_url: true,
        website: true,
        github_username: true,
        twitter_username: true,
        linkedin_username: true,
        address: true,
        timezone: true,
        isPrivate: true,
        editors_used_public: true,
        categories_used_public: true,
        os_used_public: true,
        logged_time_public: true,
        app_name: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ data: user });
  } catch (error) {
    logger.error('Error updating user profile:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Username already taken' });
    }
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
  const userId = req.params.userId === 'current' ? req.user.id : req.params.userId; 
  const { start, end, project, branches, timeout, writes_only, timezone, range } = req.query;
  
  try {
    const summaries = await getSummaries(userId, start, end, project, branches, timeout, writes_only, timezone);
    
    res.status(200).json(summaries);
  } catch (error) {
    console.error("Error fetching summaries:", error);
    res.status(500).json({ error: "Failed to fetch summaries" });
  }
});




// // Get user stats
// router.get('/:userId/stats/:range', async (req, res) => {
//   try {
//     const { userId, range } = req.params;
//     const end = new Date();
//     let start = new Date();

//     switch (range) {
//       case 'last_7_days':
//         start.setDate(start.getDate() - 7);
//         break;
//       case 'last_30_days':
//         start.setDate(start.getDate() - 30);
//         break;
//       case 'last_6_months':
//         start.setMonth(start.getMonth() - 6);
//         break;
//       case 'last_year':
//         start.setFullYear(start.getFullYear() - 1);
//         break;
//       default:
//         return res.status(400).json({ error: 'Invalid range' });
//     }

//     const stats = await prisma.$queryRaw`
//       SELECT 
//         SUM(totalDuration) as total_seconds,
//         COUNT(DISTINCT DATE(summaryDate)) as days_coded,
//         AVG(totalDuration) as daily_average,
//         MAX(totalDuration) as best_day
//       FROM DailySummary
//       WHERE userId = ${parseInt(userId)}
//         AND summaryDate BETWEEN ${start} AND ${end}
//     `;

//     res.json({ data: stats[0] });
//   } catch (error) {
//     logger.error('Error fetching user stats:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

module.exports = router; 