const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { transformHeartbeat } = require('../workers/heartbeatWorker');
const { checkApiLimit, checkStorageLimit } = require('../middleware/tierLimits');
const os = require('os');

const prisma = new PrismaClient();

// Create heartbeat(s)
router.post('/', authenticateUser, [checkApiLimit, checkStorageLimit], async (req, res) => {
  try {
    let heartbeats = Array.isArray(req.body) ? req.body : [req.body];
    
    // Validate wakatime-cli specific fields
    heartbeats = heartbeats.filter(hb => {
      const requiredFields = ['time', 'entity', 'type'];
      return requiredFields.every(field => hb[field] !== undefined);
    });

    if (heartbeats.length === 0) {
      return res.status(400).json({ error: 'Invalid heartbeat data' });
    }

    // Transform and validate heartbeats
    const transformedHeartbeats = heartbeats.map(heartbeat => ({
      ...transformHeartbeat(heartbeat),
      userId: req.user.id,
      // Handle wakatime-cli specific fields
      entity: heartbeat.entity,
      type: heartbeat.type || 'file',
      category: heartbeat.category || 'coding',
      time: heartbeat.time,
      project_name: heartbeat.project || 'Unknown',
      language: heartbeat.language,
      lines: heartbeat.lines,
      lineno: heartbeat.lineno,
      cursorpos: heartbeat.cursorpos,
      is_write: heartbeat.is_write || false,
      dependencies: heartbeat.dependencies || [],
      machine_name: heartbeat.machine_name || os.hostname()
    }));

    // Track premium features usage
    const redis = req.app.get('redis');
    const today = new Date().toISOString().split('T')[0];
    await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'api_requests', 1);
    
    // Check for premium features in heartbeats
    const hasPremiumFeatures = transformedHeartbeats.some(hb => 
      hb.dependencies?.length > 0 || 
      hb.lines > 1000 ||
      hb.category === 'debugging'
    );

    if (hasPremiumFeatures) {
      await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'premium_features', 1);
    }

    // Bulk create heartbeats
    await prisma.heartbeat.createMany({
      data: transformedHeartbeats,
      skipDuplicates: true
    });

    res.status(201).json({ 
      data: transformedHeartbeats,
      premium_features_used: hasPremiumFeatures
    });
  } catch (error) {
    logger.error('Error creating heartbeats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get heartbeats for current user
router.get('/', authenticateUser, async (req, res) => {
  try {
    const {
      start,
      end,
      project,
      branch,
      language,
      editor,
      page = 1,
      limit = 100
    } = req.query;

    const where = {
      userId: req.user.id,
      ...(start && end && {
        timestamp: {
          gte: new Date(start),
          lte: new Date(end)
        }
      }),
      ...(project && { project: { name: project } }),
      ...(branch && { branch }),
      ...(language && { language }),
      ...(editor && { editor })
    };

    const [heartbeats, total] = await Promise.all([
      prisma.heartbeat.findMany({
        where,
        include: {
          project: {
            select: {
              name: true,
              repositoryUrl: true
            }
          }
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit)
      }),
      prisma.heartbeat.count({ where })
    ]);

    res.json({
      data: heartbeats,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    logger.error('Error fetching heartbeats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get heartbeat durations
router.get('/durations', authenticateUser, async (req, res) => {
  try {
    const { date, project } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const startDate = new Date(date);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    const where = {
      userId: req.user.id,
      timestamp: {
        gte: startDate,
        lt: endDate
      },
      ...(project && { project: { name: project } })
    };

    const durations = await prisma.heartbeat.findMany({
      where,
      select: {
        timestamp: true,
        duration: true,
        project: {
          select: {
            name: true
          }
        },
        language: true,
        editor: true,
        file: true
      },
      orderBy: { timestamp: 'asc' }
    });

    // Group durations by time and project
    const groupedDurations = durations.reduce((acc, curr) => {
      const time = Math.floor(curr.timestamp.getTime() / 1000) * 1000;
      if (!acc[time]) {
        acc[time] = {};
      }
      const projectName = curr.project?.name || 'Unknown';
      if (!acc[time][projectName]) {
        acc[time][projectName] = 0;
      }
      acc[time][projectName] += curr.duration || 0;
      return acc;
    }, {});

    res.json({ data: groupedDurations });
  } catch (error) {
    logger.error('Error fetching durations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get summaries
router.get('/summaries', authenticateUser, async (req, res) => {
  try {
    const { start, end, project } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    const where = {
      userId: req.user.id,
      timestamp: {
        gte: new Date(start),
        lte: new Date(end)
      },
      ...(project && { project: { name: project } })
    };

    const summaries = await prisma.$queryRaw`
      SELECT 
        DATE(h.timestamp) as date,
        h.language,
        h.editor,
        p.name as project_name,
        COUNT(*) as heartbeat_count,
        SUM(h.duration) as total_seconds
      FROM Heartbeat h
      LEFT JOIN Project p ON h.projectId = p.id
      WHERE h.userId = ${req.user.id}
        AND h.timestamp BETWEEN ${new Date(start)} AND ${new Date(end)}
        ${project ? prisma.sql`AND p.name = ${project}` : prisma.sql``}
      GROUP BY DATE(h.timestamp), h.language, h.editor, p.name
      ORDER BY date DESC, total_seconds DESC
    `;

    res.json({ data: summaries });
  } catch (error) {
    logger.error('Error fetching summaries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 