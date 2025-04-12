const { prisma } = require('../config/db');
const logger = require('../utils/logger');

const BATCH_SIZE = 1000;

function groupHeartbeats(heartbeats) {
  return heartbeats.reduce((acc, hb) => {
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
  const timestamps = session.map(hb => new Date(hb.time * 1000));
  const startTime = new Date(Math.min(...timestamps));
  const endTime = new Date(Math.max(...timestamps));
  const duration = Math.ceil((endTime - startTime) / (1000 * 60)); 

  await prisma.codingSession.create({
    data: {
      userId: parseInt(userId),
      projectId: projectId === 'unknown' ? null : parseInt(projectId),
      startTime,
      endTime,
      duration
    }
  });
}

async function updateCodingSessions(heartbeats) {
  const sessionGroups = {};
  for (const hb of heartbeats) {
    const key = `${hb.userId}-${hb.projectId || 'unknown'}`;
    if (!sessionGroups[key]) {
      sessionGroups[key] = [];
    }
    sessionGroups[key].push(hb);
  }

  const TIMEOUT = 15 * 60;

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

    if (session.length > 0) {
      await storeSession(userId, projectId, session);
    }
  }
}

async function processBatch(heartbeats) {
  try {
    
    await prisma.heartbeat.createMany({
      data: heartbeats,
      skipDuplicates: true
    });



    await updateCodingSessions(heartbeats);

    logger.info(`Processed ${heartbeats.length} heartbeats`);
  } catch (error) {
    logger.error('Batch processing error:', error);
  }
}

async function processHeartbeats(heartbeats) {
  try {
    for (let i = 0; i < heartbeats.length; i += BATCH_SIZE) {
      const batch = heartbeats.slice(i, i + BATCH_SIZE);
      await processBatch(batch);
      logger.info(`Processed batch of ${batch.length}`);
    }
    return heartbeats.length;
  } catch (error) {
    logger.error('Error processing heartbeats:', error);
    throw error;
  }
}

module.exports = {
  processHeartbeats,
  processBatch,
  groupHeartbeats
};
