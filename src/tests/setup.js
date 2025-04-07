const { prisma, redis } = require('../config/db');

beforeAll(async () => {
  // Clean up database before tests
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

module.exports = {
  prisma,
  redis
};
