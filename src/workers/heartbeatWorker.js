const { prisma } = require('../config/db');
const logger = require('../utils/logger');
const { validateSessionKey } = require('../utils/session');
const NodeCache = require('node-cache');

const BATCH_SIZE = 1000;


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

async function storeSession(userId, projectId, session, existingSessionId = null) {
  console.log('Starting storeSession for userId:', userId, 'projectId:', projectId, 'existingSessionId:', existingSessionId);
  
  const timestamps = session.map(hb => new Date(Number(hb.time) * 1000));
  const startTime = new Date(Math.min(...timestamps));
  const endTime = new Date(Math.max(...timestamps));
  const duration = Math.ceil((endTime - startTime) / 1000); // duration in seconds

  // Get unique languages from the session
  const languages = [...new Set(session.map(hb => hb.language).filter(Boolean))];
  console.log('Extracted unique languages:', languages);
  
  // Get most recent branch
  const latest = session[session.length - 1];
  const branch = latest.branch || null;
  console.log('Latest branch:', branch);

  if (existingSessionId) {
    // Update existing session
    const updatedSession = await prisma.codingSession.update({
      where: { id: existingSessionId },
      data: {
        endTime,
        duration: {
          increment: duration
        },
        languages: {
          set: languages.length > 0 ? languages : ['unknown']
        },
        branch
      }
    });
    console.log('Updated existing coding session:', updatedSession.id);
  } else {
    // Create new coding session
    const codingSession = await prisma.codingSession.create({
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
    console.log('Created new coding session:', codingSession.id);
  }

  // Update daily summary
  const summaryDate = new Date(startTime);
  summaryDate.setHours(0, 0, 0, 0); // Set to start of day
  console.log('Processing summary for date:', summaryDate);

  // Get existing summary or create new one
  const existingSummary = await prisma.dailySummary.findFirst({
    where: {
      userId: parseInt(userId),
      summaryDate
    }
  });
  console.log('Existing summary found:', existingSummary ? 'yes' : 'no');

  if (existingSummary) {
    // Update existing summary
    const updatedSummary = await prisma.dailySummary.update({
      where: { id: existingSummary.id },
      data: {
        totalDuration: {
          increment: duration
        }
      }
    });
    console.log('Updated existing summary:', updatedSummary.id);
  } else {
    // Create new summary
    const newSummary = await prisma.dailySummary.create({
      data: {
        userId: parseInt(userId),
        summaryDate,
        totalDuration: duration
      }
    });
    console.log('Created new summary:', newSummary.id);
  }
}

async function updateCodingSessions(Heartbeats) {
  console.log('Starting updateCodingSessions with', Heartbeats.length, 'heartbeats');
  
  const sessionGroups = {};
  const TIMEOUT = 15 * 60; // 15 minutes in seconds
  
  // Group Heartbeats by userId + projectId
  for (const hb of Heartbeats) {
    const key = `${hb.userId}-${hb.projectId || 'unknown'}`;
    if (!sessionGroups[key]) sessionGroups[key] = [];
    sessionGroups[key].push(hb);
  }
  console.log('Grouped heartbeats into', Object.keys(sessionGroups).length, 'sessions');

  // Process each group
  for (const [key, groupHeartbeats] of Object.entries(sessionGroups)) {
    console.log('Processing group:', key, 'with', groupHeartbeats.length, 'heartbeats');
    
    const [userId, projectId] = key.split('-');
    const sortedHeartbeats = groupHeartbeats.sort((a, b) => a.time - b.time);
    console.log('Sorted heartbeats for group:', key);

    // Get the last coding session for this user and project
    const lastSession = await prisma.codingSession.findFirst({
      where: {
        userId: parseInt(userId),
        projectId: projectId === 'unknown' ? null : parseInt(projectId)
      },
      orderBy: {
        endTime: 'desc'
      }
    });

    if (lastSession) {
      console.log('Found last session:', lastSession.id);
      let currentSession = [];
      let currentSessionId = null;
      let lastHeartbeatTime = null;

      for (let i = 0; i < sortedHeartbeats.length; i++) {
        const currentHeartbeat = sortedHeartbeats[i];
        const currentTime = new Date(Number(currentHeartbeat.time) * 1000);

        if (i === 0) {
          // Check first heartbeat against last session
          const gap = (currentTime - lastSession.endTime) / 1000;
          if (gap <= TIMEOUT) {
            console.log('First heartbeat within timeout of last session, continuing session');
            currentSessionId = lastSession.id;
            currentSession.push(currentHeartbeat);
          } else {
            console.log('First heartbeat beyond timeout, starting new session');
            currentSession = [currentHeartbeat];
            currentSessionId = null;
          }
        } else {
          // Check against previous heartbeat
          const gap = (currentTime - lastHeartbeatTime) / 1000;
          if (gap <= TIMEOUT) {
            console.log('Heartbeat within timeout, adding to current session');
            currentSession.push(currentHeartbeat);
          } else {
            console.log('Gap detected, storing current session and starting new one');
            // Store current session
            if (currentSession.length > 0) {
              await storeSession(userId, projectId, currentSession, currentSessionId);
            }
            // Start new session
            currentSession = [currentHeartbeat];
            currentSessionId = null;
          }
        }
        lastHeartbeatTime = currentTime;
      }

      // Store final session if exists
      if (currentSession.length > 0) {
        console.log('Storing final session');
        await storeSession(userId, projectId, currentSession, currentSessionId);
      }
    } else {
      console.log('No previous session found, processing as new sessions');
      let currentSession = [];
      let lastHeartbeatTime = null;

      for (let i = 0; i < sortedHeartbeats.length; i++) {
        const currentHeartbeat = sortedHeartbeats[i];
        const currentTime = new Date(Number(currentHeartbeat.time) * 1000);

        if (i === 0) {
          currentSession = [currentHeartbeat];
        } else {
          const gap = (currentTime - lastHeartbeatTime) / 1000;
          if (gap <= TIMEOUT) {
            console.log('Heartbeat within timeout, adding to current session');
            currentSession.push(currentHeartbeat);
          } else {
            console.log('Gap detected, storing current session and starting new one');
            // Store current session
            if (currentSession.length > 0) {
              await storeSession(userId, projectId, currentSession, null);
            }
            // Start new session
            currentSession = [currentHeartbeat];
          }
        }
        lastHeartbeatTime = currentTime;
      }

      // Store final session if exists
      if (currentSession.length > 0) {
        console.log('Storing final session');
        await storeSession(userId, projectId, currentSession, null);
      }
    }
  }
  console.log('Completed processing all sessions');
}

async function processBatch(Heartbeats) {
  console.log("Starting processBatch");
  try {
    const userIdd = Heartbeats[0]?.userId;
    console.log("Processing heartbeats for userId:", userIdd);

    const heartbeatsWithUserId = Heartbeats.map(hb => {
      const { user_agent, userId, ...rest } = hb;
      return {
        ...rest,
        userId: parseInt(userIdd),
        dependencies: Array.isArray(hb.dependencies)
          ? hb.dependencies.join(',')
          : hb.dependencies
      };
    });

    // Process heartbeats and update sessions
    const [heartbeatResult] = await Promise.all([
      prisma.heartbeat.createMany({
        data: heartbeatsWithUserId,
        skipDuplicates: true
      }),
      updateCodingSessions(heartbeatsWithUserId)
    ]);

    // Format response according to specified structure
    const responses = heartbeatsWithUserId.map(hb => [
      {
        data: {
          heartbeat: hb
        }
      },
      {
        status: 201
      }
    ]);

    console.log(`Processed ${Heartbeats.length} Heartbeats for user ${userIdd}`);
    return { responses };
  } catch (error) {
    console.log("Error in processBatch:", error);
    logger.error('Batch processing error:', error);
    throw error;
  }
}

async function processHeartbeats(Heartbeats) {
  console.log("HeartbeatsSize", Heartbeats.length);
  try {
    let allResponses = [];
    for (let i = 0; i < Heartbeats.length; i += BATCH_SIZE) {
      const batch = Heartbeats.slice(i, i + BATCH_SIZE);
      const result = await processBatch(batch);
      allResponses = allResponses.concat(result.responses);
      console.log(`Processed batch of ${batch.length}`);
      logger.info(`Processed batch of ${batch.length}`);
    }
    return { responses: allResponses };
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
