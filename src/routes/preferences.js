const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

// Get user preferences
router.get('/', authenticateUser, async (req, res) => {
  try {
    const preferences = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isPrivate: true,
        app_name: true,
        profile_url: true,
        // Add more preference fields as needed
      }
    });

    // Extend with default preferences if needed
    const extendedPreferences = {
      ...preferences,
      dashboard: {
        default_range: 'last_7_days',
        charts_timeline: '7_days',
        weekday_start: 1, // Monday
        working_hours: {
          start: 9,
          end: 17
        }
      },
      goals: {
        daily_target: 7200, // 2 hours
        weekly_target: 36000, // 10 hours
        languages: [],
        categories: []
      },
      notifications: {
        email: true,
        slack: false,
        goals: true,
        weekly_report: true,
        team_insights: true
      },
      integrations: {
        github: false,
        gitlab: false,
        bitbucket: false,
        slack: false,
        jira: false
      },
      privacy: {
        share_data_with_team: true,
        share_languages: true,
        share_editor_info: true,
        share_os_info: true
      }
    };

    res.json({ data: extendedPreferences });
  } catch (error) {
    logger.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user preferences
router.put('/', authenticateUser, async (req, res) => {
  try {
    const {
      isPrivate,
      app_name,
      profile_url,
      dashboard,
      goals,
      notifications,
      integrations,
      privacy
    } = req.body;

    // Update core user preferences
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        isPrivate,
        app_name,
        profile_url
      }
    });

    // Store extended preferences in database
    await prisma.userPreferences.upsert({
      where: { userId: req.user.id },
      update: {
        dashboard,
        goals,
        notifications,
        integrations,
        privacy
      },
      create: {
        userId: req.user.id,
        dashboard,
        goals,
        notifications,
        integrations,
        privacy
      }
    });

    res.json({
      data: {
        ...user,
        dashboard,
        goals,
        notifications,
        integrations,
        privacy
      }
    });
  } catch (error) {
    logger.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get color schemes
router.get('/colors', async (req, res) => {
  const colorSchemes = {
    themes: [
      {
        name: 'default',
        colors: {
          primary: '#38b2ac',
          secondary: '#4a5568',
          accent: '#ed8936',
          background: '#ffffff',
          text: '#1a202c'
        }
      },
      {
        name: 'dark',
        colors: {
          primary: '#38b2ac',
          secondary: '#a0aec0',
          accent: '#ed8936',
          background: '#1a202c',
          text: '#ffffff'
        }
      },
      {
        name: 'light',
        colors: {
          primary: '#319795',
          secondary: '#718096',
          accent: '#dd6b20',
          background: '#f7fafc',
          text: '#2d3748'
        }
      }
    ],
    editor_themes: [
      'monokai',
      'github',
      'tomorrow',
      'kuroir',
      'twilight',
      'xcode',
      'textmate',
      'solarized_dark',
      'solarized_light',
      'terminal'
    ]
  };

  res.json({ data: colorSchemes });
});

// Get available integrations
router.get('/integrations', authenticateUser, async (req, res) => {
  const integrations = {
    available: [
      {
        id: 'github',
        name: 'GitHub',
        description: 'Connect your GitHub account to track repository activity',
        icon: 'github',
        auth_url: '/api/v1/auth/github',
        features: [
          'Repository synchronization',
          'Commit tracking',
          'PR reviews',
          'Issue management'
        ]
      },
      {
        id: 'gitlab',
        name: 'GitLab',
        description: 'Connect your GitLab account for comprehensive Git analytics',
        icon: 'gitlab',
        auth_url: '/api/v1/auth/gitlab',
        features: [
          'Repository synchronization',
          'Merge request tracking',
          'CI/CD metrics',
          'Issue tracking'
        ]
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Get notifications and reports directly in Slack',
        icon: 'slack',
        auth_url: '/api/v1/auth/slack',
        features: [
          'Daily summaries',
          'Goal notifications',
          'Team reports',
          'Command integration'
        ]
      },
      {
        id: 'jira',
        name: 'Jira',
        description: 'Link coding activity with Jira issues and projects',
        icon: 'jira',
        auth_url: '/api/v1/auth/jira',
        features: [
          'Issue time tracking',
          'Project synchronization',
          'Sprint metrics',
          'Worklog integration'
        ]
      }
    ],
    connected: [] // Will be populated with user's connected integrations
  };

  res.json({ data: integrations });
});

module.exports = router; 