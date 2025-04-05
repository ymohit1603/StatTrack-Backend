const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const WebSocket = require('ws');

const prisma = new PrismaClient();

// Get active team members and their status
router.get('/team/active', authenticateUser, async (req, res) => {
  try {
    const activeUsers = await prisma.$queryRaw`
      WITH recent_activity AS (
        SELECT 
          userId,
          MAX(timestamp) as last_active,
          STRING_AGG(DISTINCT entity, ', ' ORDER BY entity) as current_files,
          STRING_AGG(DISTINCT language, ', ' ORDER BY language) as languages
        FROM Heartbeat
        WHERE timestamp >= NOW() - INTERVAL '15 minutes'
        GROUP BY userId
      )
      SELECT 
        u.id,
        u.username,
        u.avatar_url,
        ra.last_active,
        ra.current_files,
        ra.languages,
        CASE 
          WHEN ra.last_active >= NOW() - INTERVAL '5 minutes' THEN 'active'
          WHEN ra.last_active >= NOW() - INTERVAL '15 minutes' THEN 'idle'
          ELSE 'offline'
        END as status
      FROM "User" u
      LEFT JOIN recent_activity ra ON ra.userId = u.id
      WHERE u.teamId = (SELECT teamId FROM "User" WHERE id = ${req.user.id})
      ORDER BY ra.last_active DESC NULLS LAST
    `;

    res.json({ data: activeUsers });
  } catch (error) {
    logger.error('Error fetching active team members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get real-time collaboration opportunities
router.get('/opportunities', authenticateUser, async (req, res) => {
  try {
    const collaborationOpportunities = await prisma.$queryRaw`
      WITH recent_edits AS (
        SELECT 
          h.entity,
          h.language,
          COUNT(DISTINCT h.userId) as contributors,
          COUNT(*) as edit_count,
          MAX(h.timestamp) as last_edit
        FROM Heartbeat h
        WHERE h.timestamp >= NOW() - INTERVAL '24 hours'
          AND h.projectId IN (
            SELECT projectId 
            FROM ProjectMember 
            WHERE userId = ${req.user.id}
          )
        GROUP BY h.entity, h.language
        HAVING COUNT(DISTINCT h.userId) > 1
      )
      SELECT 
        re.entity,
        re.language,
        re.contributors,
        re.edit_count,
        re.last_edit,
        ARRAY_AGG(DISTINCT u.username) as team_members,
        COUNT(DISTINCT pr.id) as related_prs,
        COUNT(DISTINCT i.id) as related_issues
      FROM recent_edits re
      JOIN Heartbeat h ON h.entity = re.entity
      JOIN "User" u ON h.userId = u.id
      LEFT JOIN PullRequest pr ON pr.file_path LIKE '%' || re.entity || '%'
      LEFT JOIN Issue i ON i.title LIKE '%' || re.entity || '%'
      GROUP BY re.entity, re.language, re.contributors, re.edit_count, re.last_edit
      ORDER BY re.last_edit DESC
    `;

    res.json({ 
      data: collaborationOpportunities.map(opp => ({
        ...opp,
        collaboration_score: calculateCollaborationScore(opp),
        suggested_actions: generateCollaborationSuggestions(opp)
      }))
    });
  } catch (error) {
    logger.error('Error fetching collaboration opportunities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get team pair programming suggestions
router.get('/pair-programming', authenticateUser, async (req, res) => {
  try {
    const teamMetrics = await prisma.$queryRaw`
      WITH user_expertise AS (
        SELECT 
          userId,
          language,
          COUNT(*) as activity_count,
          SUM(duration) as total_time
        FROM Heartbeat
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY userId, language
      )
      SELECT 
        u1.id as mentor_id,
        u1.username as mentor_name,
        u2.id as mentee_id,
        u2.username as mentee_name,
        ue1.language,
        ue1.total_time as mentor_time,
        ue2.total_time as mentee_time
      FROM user_expertise ue1
      JOIN user_expertise ue2 ON ue1.language = ue2.language
      JOIN "User" u1 ON ue1.userId = u1.id
      JOIN "User" u2 ON ue2.userId = u2.id
      WHERE ue1.total_time > ue2.total_time * 2
        AND u1.teamId = (SELECT teamId FROM "User" WHERE id = ${req.user.id})
        AND u2.teamId = u1.teamId
        AND u1.id != u2.id
      ORDER BY ue1.total_time DESC
    `;

    res.json({
      data: teamMetrics.map(pair => ({
        ...pair,
        match_score: calculatePairMatchScore(pair),
        suggested_projects: suggestPairProjects(pair),
        learning_objectives: generateLearningObjectives(pair)
      }))
    });
  } catch (error) {
    logger.error('Error generating pair programming suggestions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket endpoint for real-time collaboration
const wsServer = new WebSocket.Server({ noServer: true });

wsServer.on('connection', (ws, req) => {
  const userId = req.user.id; // Set by WebSocket upgrade handler
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'presence':
          broadcastPresence(userId, data.status);
          break;
        case 'activity':
          await trackActivity(userId, data.entity, data.action);
          broadcastActivity(userId, data);
          break;
        case 'collaboration':
          await handleCollaboration(userId, data);
          break;
      }
    } catch (error) {
      logger.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    broadcastPresence(userId, 'offline');
  });
});

// Helper functions
function calculateCollaborationScore(opportunity) {
  const recency = Date.now() - new Date(opportunity.last_edit);
  const recencyScore = Math.exp(-recency / (24 * 60 * 60 * 1000));
  
  return {
    total_score: (
      (opportunity.contributors * 0.3) +
      (opportunity.edit_count * 0.2) +
      (opportunity.related_prs * 0.25) +
      (opportunity.related_issues * 0.25)
    ) * recencyScore,
    factors: {
      contributor_diversity: opportunity.contributors * 0.3,
      activity_level: opportunity.edit_count * 0.2,
      pr_involvement: opportunity.related_prs * 0.25,
      issue_relevance: opportunity.related_issues * 0.25,
      recency_multiplier: recencyScore
    }
  };
}

function generateCollaborationSuggestions(opportunity) {
  const suggestions = [];
  
  if (opportunity.contributors < 3) {
    suggestions.push({
      type: 'review_request',
      message: 'Consider requesting code review from additional team members',
      priority: 'high'
    });
  }
  
  if (opportunity.related_prs === 0) {
    suggestions.push({
      type: 'create_pr',
      message: 'Create a pull request to formalize the collaboration',
      priority: 'medium'
    });
  }
  
  return suggestions;
}

function calculatePairMatchScore(pair) {
  const experienceGap = pair.mentor_time / pair.mentee_time;
  const optimalGap = 3; // Ideal experience gap for mentoring
  
  return {
    total_score: Math.min(100, (
      (1 - Math.abs(experienceGap - optimalGap) / optimalGap) * 100
    )),
    factors: {
      experience_gap: experienceGap,
      optimal_gap: optimalGap,
      language_relevance: 1.0 // Can be adjusted based on project needs
    }
  };
}

async function broadcastPresence(userId, status) {
  const message = JSON.stringify({
    type: 'presence_update',
    userId,
    status,
    timestamp: new Date().toISOString()
  });
  
  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

async function trackActivity(userId, entity, action) {
  await prisma.collaboration.create({
    data: {
      userId,
      entity,
      action,
      timestamp: new Date()
    }
  });
}

async function broadcastActivity(userId, data) {
  const message = JSON.stringify({
    type: 'activity_update',
    userId,
    ...data,
    timestamp: new Date().toISOString()
  });
  
  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

async function handleCollaboration(userId, data) {
  // Handle real-time collaboration events
  // This could include:
  // - Live cursor positions
  // - File editing notifications
  // - Code review comments
  // - Pair programming sessions
}

module.exports = { router, wsServer }; 