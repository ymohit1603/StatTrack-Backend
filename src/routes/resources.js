const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get all machine learning resources
router.get('/machine-learning', authenticateUser, async (req, res) => {
  try {
    // Using simple statistical analysis instead of ML
    const insights = await prisma.$queryRaw`
      WITH user_stats AS (
        SELECT 
          DATE(timestamp) as coding_date,
          EXTRACT(HOUR FROM timestamp) as hour,
          COUNT(*) as Heartbeat_count,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(timestamp), EXTRACT(HOUR FROM timestamp)
      )
      SELECT 
        hour,
        AVG(total_seconds) as avg_seconds,
        COUNT(DISTINCT coding_date) as active_days
      FROM user_stats
      GROUP BY hour
      ORDER BY avg_seconds DESC
    `;

    res.json({
      data: {
        best_coding_hours: insights.slice(0, 3).map(i => ({
          hour: i.hour,
          productivity_score: i.avg_seconds / (i.active_days * 3600), // Normalize to 0-1
          confidence: Math.min(i.active_days / 30, 1)
        })),
        recommendations: generateSimpleRecommendations(insights)
      }
    });
  } catch (error) {
    logger.error('Error fetching ML resources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get editor plugins
router.get('/editors', async (req, res) => {
  const editors = [
    {
      id: 'vscode',
      name: 'Visual Studio Code',
      website: 'https://code.visualstudio.com',
      install_guide: 'https://wakatime.com/vs-code',
      is_free: true
    },
    {
      id: 'sublime',
      name: 'Sublime Text',
      website: 'https://www.sublimetext.com',
      install_guide: 'https://wakatime.com/sublime-text',
      is_free: true
    },
    {
      id: 'vim',
      name: 'Vim',
      website: 'https://www.vim.org',
      install_guide: 'https://wakatime.com/vim',
      is_free: true
    }
  ];

  res.json({ data: editors });
});

// Get IDE integrations
router.get('/integrations', async (req, res) => {
  const integrations = [
    {
      id: 'github',
      name: 'GitHub',
      type: 'version_control',
      setup_url: 'https://github.com/apps/wakatime',
      is_free: true
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      type: 'version_control',
      setup_url: 'https://gitlab.com/users/sign_in',
      is_free: true
    }
  ];

  res.json({ data: integrations });
});

// Get available dashboard widgets
router.get('/widgets', authenticateUser, async (req, res) => {
  const widgets = [
    {
      id: 'coding_activity',
      name: 'Coding Activity',
      description: 'Shows your coding activity over time',
      preview_url: '/images/widgets/coding_activity.png',
      is_free: true
    },
    {
      id: 'languages',
      name: 'Languages',
      description: 'Shows your most used programming languages',
      preview_url: '/images/widgets/languages.png',
      is_free: true
    },
    {
      id: 'editors',
      name: 'Editors',
      description: 'Shows your most used editors',
      preview_url: '/images/widgets/editors.png',
      is_free: true
    }
  ];

  res.json({ data: widgets });
});

// Helper function for simple recommendations
function generateSimpleRecommendations(insights) {
  const recommendations = [];
  const totalHours = insights.reduce((sum, i) => sum + i.active_days, 0);
  const avgHoursPerDay = totalHours / 30;

  if (avgHoursPerDay < 2) {
    recommendations.push({
      type: 'consistency',
      message: 'Try to code at least 2 hours every day to build momentum',
      priority: 'high'
    });
  }

  const mostProductiveHour = insights[0];
  if (mostProductiveHour) {
    recommendations.push({
      type: 'timing',
      message: `You're most productive at ${mostProductiveHour.hour}:00. Try to schedule important coding tasks during this time.`,
      priority: 'medium'
    });
  }

  return recommendations;
}

module.exports = router; 