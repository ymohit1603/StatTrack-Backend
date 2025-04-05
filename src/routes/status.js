const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD
});

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID,
  brokers: process.env.KAFKA_BROKERS.split(',')
});

// Get API status and system health
router.get('/', async (req, res) => {
  try {
    const [dbStatus, cacheStatus, queueStatus] = await Promise.all([
      checkDatabase(),
      checkCache(),
      checkQueue()
    ]);

    const systemStatus = {
      status: (dbStatus && cacheStatus && queueStatus) ? 'ok' : 'degraded',
      api_version: process.env.API_VERSION || 'v1',
      timestamp: new Date().toISOString(),
      components: {
        database: {
          status: dbStatus ? 'ok' : 'error',
          type: 'PostgreSQL/TimescaleDB',
          version: await getDatabaseVersion()
        },
        cache: {
          status: cacheStatus ? 'ok' : 'error',
          type: 'Redis',
          version: await getCacheVersion()
        },
        queue: {
          status: queueStatus ? 'ok' : 'error',
          type: 'Apache Kafka',
          version: '3.x'
        }
      },
      metrics: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };

    res.json({ data: systemStatus });
  } catch (error) {
    logger.error('Error checking system status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error checking system status'
    });
  }
});

// Get detailed system metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await Promise.all([
      getSystemMetrics(),
      getDatabaseMetrics(),
      getCacheMetrics(),
      getQueueMetrics()
    ]);

    res.json({
      data: {
        timestamp: new Date().toISOString(),
        system: metrics[0],
        database: metrics[1],
        cache: metrics[2],
        queue: metrics[3]
      }
    });
  } catch (error) {
    logger.error('Error fetching system metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkCache() {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

async function checkQueue() {
  try {
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}

async function getDatabaseVersion() {
  try {
    const [result] = await prisma.$queryRaw`SELECT version()`;
    return result.version;
  } catch {
    return 'unknown';
  }
}

async function getCacheVersion() {
  try {
    const info = await redis.info();
    const version = info.match(/redis_version:(.*?)\\r\\n/)?.[1];
    return version || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getSystemMetrics() {
  return {
    load_average: os.loadavg(),
    total_memory: os.totalmem(),
    free_memory: os.freemem(),
    cpu_count: os.cpus().length,
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime()
  };
}

async function getDatabaseMetrics() {
  try {
    const metrics = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_users,
        (SELECT COUNT(*) FROM Heartbeat) as total_heartbeats,
        (SELECT COUNT(*) FROM Project) as total_projects,
        pg_database_size(current_database()) as database_size
      FROM "User"
    `;
    return metrics[0];
  } catch {
    return null;
  }
}

async function getCacheMetrics() {
  try {
    const info = await redis.info();
    return {
      connected_clients: parseInt(info.match(/connected_clients:(.*?)\\r\\n/)?.[1] || '0'),
      used_memory: parseInt(info.match(/used_memory:(.*?)\\r\\n/)?.[1] || '0'),
      total_commands_processed: parseInt(info.match(/total_commands_processed:(.*?)\\r\\n/)?.[1] || '0')
    };
  } catch {
    return null;
  }
}

async function getQueueMetrics() {
  try {
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    const offsets = await admin.fetchTopicOffsets('heartbeats');
    await admin.disconnect();
    return {
      topics: topics.length,
      total_partitions: offsets.length,
      total_messages: offsets.reduce((sum, o) => sum + parseInt(o.high) - parseInt(o.low), 0)
    };
  } catch {
    return null;
  }
}

module.exports = router; 