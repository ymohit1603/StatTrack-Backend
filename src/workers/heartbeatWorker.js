const { Kafka } = require('kafkajs');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const BATCH_SIZE = 1000;
const BATCH_WAIT_MS = 1000;

const kafka = new Kafka({
  clientId: 'heartbeat-worker',
  brokers: process.env.KAFKA_BROKERS.split(',')
});

const consumer = kafka.consumer({ groupId: 'heartbeat-processor' });
let batch = [];

function groupHeartbeats(heartbeats) {
  return heartbeats.reduce((acc, hb) => {
    acc.editors.add(hb.editor_name || 'unknown');
    acc.languages.add(hb.language || 'unknown');
    acc.projects.add({
      name: hb.project_name || 'unknown',
      userId: hb.userId,
      branch: hb.branch
    });
    return acc;
  }, {
    editors: new Set(),
    languages: new Set(),
    projects: new Set()
  });
}

async function bulkUpsertEditors(tx, editors) {
  const editorMap = {};
  for (const name of editors) {
    const editor = await tx.editor.upsert({
      where: { name },
      create: { 
        name,
        version: null,
        otherDetails: {}
      },
      update: {}
    });
    editorMap[name] = editor.id;
  }
  return editorMap;
}

async function bulkUpsertLanguages(tx, languages) {
  const languageMap = {};
  for (const name of languages) {
    const language = await tx.language.upsert({
      where: { name },
      create: { 
        name,
        version: null,
        otherDetails: {}
      },
      update: {}
    });
    languageMap[name] = language.id;
  }
  return languageMap;
}

async function bulkUpsertProjects(tx, projects) {
  const projectMap = {};
  for (const project of projects) {
    const projectKey = `${project.userId}-${project.name}`;
    const existingProject = await tx.project.upsert({
      where: {
        userId_name: {
          userId: project.userId,
          name: project.name
        }
      },
      create: {
        name: project.name,
        userId: project.userId,
        branch: project.branch,
        description: null,
        repositoryUrl: null,
        created_at: new Date(),
        updated_at: new Date()
      },
      update: {
        branch: project.branch,
        updated_at: new Date()
      }
    });
    projectMap[projectKey] = existingProject.id;
  }
  return projectMap;
}

function transformHeartbeat(heartbeat, editors, languages, projects) {
  const projectKey = `${heartbeat.userId}-${heartbeat.project_name || 'unknown'}`;
  return {
    userId: heartbeat.userId,
    projectId: projects[projectKey],
    editorId: editors[heartbeat.editor_name || 'unknown'],
    languageId: languages[heartbeat.language || 'unknown'],
    timestamp: new Date(heartbeat.time * 1000),
    duration: heartbeat.duration,
    entity: heartbeat.entity,
    type: heartbeat.type || 'file',
    category: heartbeat.category || 'coding',
    is_write: heartbeat.is_write || false,
    branch: heartbeat.branch,
    lines: heartbeat.lines,
    lineno: heartbeat.lineno,
    cursorpos: heartbeat.cursorpos,
    machine_name: heartbeat.machine_name,
    created_at: new Date(),
    updated_at: new Date()
  };
}

async function processBatch(heartbeats) {
  try {
    await prisma.$transaction(async (tx) => {
      // First verify all users exist
      const userIds = new Set(heartbeats.map(hb => hb.userId));
      const existingUsers = await tx.user.findMany({
        where: {
          id: {
            in: Array.from(userIds)
          }
        },
        select: { id: true }
      });

      const validUserIds = new Set(existingUsers.map(u => u.id));
      const validHeartbeats = heartbeats.filter(hb => validUserIds.has(hb.userId));

      if (validHeartbeats.length < heartbeats.length) {
        logger.warn(`Filtered out ${heartbeats.length - validHeartbeats.length} heartbeats with invalid user IDs`);
      }

      // Group heartbeats by project, editor, and language
      const grouped = groupHeartbeats(validHeartbeats);
      
      // Bulk upsert related records
      const editors = await bulkUpsertEditors(tx, grouped.editors);
      const languages = await bulkUpsertLanguages(tx, grouped.languages);
      const projects = await bulkUpsertProjects(tx, grouped.projects);
      
      // Bulk insert heartbeats
      await tx.heartbeat.createMany({
        data: validHeartbeats.map(hb => transformHeartbeat(hb, editors, languages, projects)),
        skipDuplicates: true
      });

      // Update coding sessions
      await updateCodingSessions(tx, validHeartbeats);
    });

    logger.info(`Processed ${heartbeats.length} heartbeats`);
  } catch (error) {
    logger.error('Batch processing error:', error);
  }
}

async function updateCodingSessions(tx, heartbeats) {
  // Group heartbeats by user and project
  const sessionGroups = {};
  for (const hb of heartbeats) {
    const key = `${hb.userId}-${hb.projectId || 'unknown'}`;
    if (!sessionGroups[key]) {
      sessionGroups[key] = [];
    }
    sessionGroups[key].push(hb);
  }

  // Update or create sessions for each group
  for (const [key, groupHeartbeats] of Object.entries(sessionGroups)) {
    const [userId, projectId] = key.split('-');
    const timestamps = groupHeartbeats.map(hb => new Date(hb.time * 1000));
    const startTime = new Date(Math.min(...timestamps));
    const endTime = new Date(Math.max(...timestamps));
    const duration = Math.ceil((endTime - startTime) / (1000 * 60)); // Duration in minutes

    await tx.codingSession.create({
      data: {
        userId: parseInt(userId),
        projectId: projectId === 'unknown' ? null : parseInt(projectId),
        startTime,
        endTime,
        duration
      }
    });
  }
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'heartbeats', fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const heartbeat = JSON.parse(message.value.toString());
      batch.push(heartbeat);

      if (batch.length >= BATCH_SIZE) {
        const currentBatch = [...batch];
        batch = [];
        await processBatch(currentBatch);
      }
    },
  });

  // Process partial batches periodically
  setInterval(async () => {
    if (batch.length > 0) {
      const currentBatch = [...batch];
      batch = [];
      await processBatch(currentBatch);
    }
  }, BATCH_WAIT_MS);
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  try {
    await consumer.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Error during worker shutdown:', error);
    process.exit(1);
  }
});

if (require.main === module) {
  run().catch(error => {
    logger.error('Worker error:', error);
    process.exit(1);
  });
}

module.exports = {
  processBatch,
  groupHeartbeats,
  transformHeartbeat
}; 