const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

prisma.$on('error', (err) => {
  console.error('Prisma client error:', err);
});

module.exports = {
  prisma,
  redis
};
