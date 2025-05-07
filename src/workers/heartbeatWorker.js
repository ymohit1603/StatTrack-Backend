const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { validateSessionKey } = require('../utils/session');
const NodeCache = require('node-cache');

const BATCH_SIZE = 1000;
const sessionKeyCache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

function groupHeartbeats(Heartbeats) {
  return Heartbeats.reduce((acc, hb) => {
    acc.languages.add(hb.language || 'unknown');
    acc.projects.add({
      name: hb.project || 'unknown',
      branch: hb.branch
    });
    return acc;
  }, {
    languages: new Set(),
    projects: new Set()
  });
}

async function storeSession(userId, projectId, session) {
  const timestamps = session.map(hb => new Date(Number(hb.time) * 1000));
  const startTime = new Date(Math.min(...timestamps));
  const endTime = new Date(Math.max(...timestamps));
  const duration = Math.ceil((endTime - startTime) / 1000); // duration in seconds

  // Get unique languages from the session
  const languages = [...new Set(session.map(hb => hb.language).filter(Boolean))];
  
  // Get most recent branch
  const latest = session[session.length - 1];
  const branch = latest.branch || null;

  if (duration >= 60) { // Skip sessions shorter than 1 minute
    // Create coding session
    await prisma.codingSession.create({
      data: {
        userId: parseInt(userId),
        projectId: projectId === 'unknown' ? null : parseInt(projectId),
        startTime,
        endTime,
        duration,
        branch,
        languages: languages.length > 0 ? languages : ['unknown']
      }
    });

    // Update daily summary
    const summaryDate = new Date(startTime);
    summaryDate.setHours(0, 0, 0, 0); // Set to start of day

    // Get existing summary or create new one
    const existingSummary = await prisma.dailySummary.findFirst({
      where: {
        userId: parseInt(userId),
        summaryDate
      }
    });

    if (existingSummary) {
      // Update existing summary
      await prisma.dailySummary.update({
        where: { id: existingSummary.id },
        data: {
          totalDuration: {
            increment: duration
          }
        }
      });
    } else {
      // Create new summary
      await prisma.dailySummary.create({
        data: {
          userId: parseInt(userId),
          summaryDate,
          totalDuration: duration
        }
      });
    }
  }
}

async function updateCodingSessions(Heartbeats) {
  const sessionGroups = {};
  const TIMEOUT = 15 * 60; // 15 minutes in seconds

  // Group Heartbeats by userId + projectId
  for (const hb of Heartbeats) {
    const key = `${hb.userId}-${hb.projectId || 'unknown'}`;
    if (!sessionGroups[key]) sessionGroups[key] = [];
    sessionGroups[key].push(hb);
  }

  // Process each group
  for (const [key, groupHeartbeats] of Object.entries(sessionGroups)) {
    const [userId, projectId] = key.split('-');
    const sortedHeartbeats = groupHeartbeats.sort((a, b) => a.time - b.time);

    let session = [sortedHeartbeats[0]];

    for (let i = 1; i < sortedHeartbeats.length; i++) {
      const prev = sortedHeartbeats[i - 1];
      const curr = sortedHeartbeats[i];
      const gap = curr.time - prev.time;

      if (gap <= TIMEOUT) {
        session.push(curr);
      } else {
        await storeSession(userId, projectId, session);
        session = [curr];
      }
    }

    // Store last session
    if (session.length > 0) {
      await storeSession(userId, projectId, session);
    }
  }
}

async function processBatch(Heartbeats) {
  try {
    // Extract session key from the first heartbeat (assuming all heartbeats in batch are from same user)
    const sessionKey = Heartbeats[0]?.sessionKey;
    if (!sessionKey) {
      throw new Error('No session key provided');
    }

    // Check session key cache first
    let userId = sessionKeyCache.get(sessionKey);
    
    if (!userId) {
      // Validate session key and get userId
      userId = validateSessionKey(sessionKey);
      if (!userId) {
        throw new Error('Invalid session key');
      }
      // Cache the validated session key
      sessionKeyCache.set(sessionKey, userId);
    }

    // Add userId to each heartbeat
    const heartbeatsWithUserId = Heartbeats.map(hb => ({
      ...hb,
      userId: parseInt(userId)
    }));

    // Process heartbeats and update sessions in parallel
    await Promise.all([
      prisma.heartbeat.createMany({
        data: heartbeatsWithUserId,
        skipDuplicates: true
      }),
      updateCodingSessions(heartbeatsWithUserId)
    ]);

    logger.info(`Processed ${Heartbeats.length} Heartbeats for user ${userId}`);
  } catch (error) {
    logger.error('Batch processing error:', error);
    throw error;
  }
}

async function processHeartbeats(Heartbeats) {
  try {
    for (let i = 0; i < Heartbeats.length; i += BATCH_SIZE) {
      const batch = Heartbeats.slice(i, i + BATCH_SIZE);
      await processBatch(batch);
      logger.info(`Processed batch of ${batch.length}`);
    }
    return Heartbeats.length;
  } catch (error) {
    logger.error('Error processing Heartbeats:', error);
    throw error;
  }
}

module.exports = {
  processHeartbeats,
  processBatch,
  groupHeartbeats
};
