const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get all goals
router.get('/', authenticateUser, async (req, res) => {
  try {
    const goals = await prisma.$queryRaw`
      WITH daily_coding AS (
        SELECT 
          DATE(timestamp) as date,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
        GROUP BY DATE(timestamp)
      )
      SELECT
        'daily' as type,
        'coding' as category,
        '7200' as target_seconds, -- 2 hours daily target
        COALESCE(AVG(total_seconds), 0) as average_seconds,
        COUNT(*) as days_coded,
        (SELECT COUNT(*) 
         FROM daily_coding 
         WHERE total_seconds >= 7200) as days_met_goal
      FROM daily_coding
    `;

    res.json({
      data: goals.map(goal => ({
        ...goal,
        status: goal.average_seconds >= goal.target_seconds ? 'success' : 'pending',
        progress: Math.min((goal.average_seconds / goal.target_seconds) * 100, 100),
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString()
      }))
    });
  } catch (error) {
    logger.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get goal by ID
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const [goal] = await prisma.$queryRaw`
      WITH daily_coding AS (
        SELECT 
          DATE(timestamp) as date,
          SUM(duration) as total_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(timestamp)
      )
      SELECT
        ${req.params.id} as id,
        'daily' as type,
        'coding' as category,
        '7200' as target_seconds,
        COALESCE(AVG(total_seconds), 0) as average_seconds,
        COUNT(*) as days_coded,
        (SELECT COUNT(*) 
         FROM daily_coding 
         WHERE total_seconds >= 7200) as days_met_goal
      FROM daily_coding
    `;

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.json({
      data: {
        ...goal,
        status: goal.average_seconds >= goal.target_seconds ? 'success' : 'pending',
        progress: Math.min((goal.average_seconds / goal.target_seconds) * 100, 100),
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new goal
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { type, category, target_seconds } = req.body;

    // Validate input
    if (!type || !category || !target_seconds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // For now, we'll just return a success response since goals are calculated dynamically
    res.status(201).json({
      data: {
        id: Date.now().toString(),
        type,
        category,
        target_seconds: parseInt(target_seconds),
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error creating goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a goal
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const { type, category, target_seconds } = req.body;

    // Validate input
    if (!type || !category || !target_seconds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // For now, we'll just return a success response since goals are calculated dynamically
    res.json({
      data: {
        id: req.params.id,
        type,
        category,
        target_seconds: parseInt(target_seconds),
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error updating goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a goal
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    // Since goals are calculated dynamically, we'll just return a success response
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 