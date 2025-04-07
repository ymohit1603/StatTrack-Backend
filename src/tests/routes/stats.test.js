const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Stats Routes', () => {
  let testUser;
  let authToken;

  beforeEach(async () => {
    await prisma.userStats.deleteMany();
    await prisma.dailyStats.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushall();

    testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        apiKey: 'waka_test_12345'
      }
    });

    authToken = jwt.sign(
      { userId: testUser.id },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    // Create sample user stats
    await prisma.userStats.create({
      data: {
        userId: testUser.id,
        total_coding_time: 3600, // 1 hour
        languages: ['JavaScript', 'Python'],
        editors: ['VS Code'],
        operating_systems: ['Linux'],
        projects: ['Project1', 'Project2']
      }
    });

    // Create sample daily stats
    await prisma.dailyStats.createMany({
      data: [
        {
          userId: testUser.id,
          date: new Date(),
          coding_time: 1800, // 30 minutes
          languages: ['JavaScript'],
          projects: ['Project1']
        },
        {
          userId: testUser.id,
          date: new Date(Date.now() - 86400000), // Yesterday
          coding_time: 3600, // 1 hour
          languages: ['Python'],
          projects: ['Project2']
        }
      ]
    });
  });

  describe('GET /api/v1/users/current/stats', () => {
    it('should return user overall stats', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.total_coding_time).toBe(3600);
      expect(response.body.languages).toContain('JavaScript');
      expect(response.body.languages).toContain('Python');
      expect(response.body.editors).toContain('VS Code');
      expect(response.body.projects).toHaveLength(2);
    });

    it('should return 404 if no stats exist', async () => {
      await prisma.userStats.deleteMany();

      await request(app)
        .get('/api/v1/users/current/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/users/current/stats/daily', () => {
    it('should return daily stats with date range', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats/daily')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].coding_time).toBeDefined();
      expect(response.body.data[0].languages).toBeDefined();
    });

    it('should validate date range parameters', async () => {
      await request(app)
        .get('/api/v1/users/current/stats/daily')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: 'invalid-date'
        })
        .expect(422);
    });
  });

  describe('GET /api/v1/users/current/stats/languages', () => {
    it('should return language statistics', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats/languages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2); // JavaScript and Python
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('total_seconds');
      expect(response.body[0]).toHaveProperty('percent');
    });

    it('should filter languages by date range', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats/languages')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date().toISOString(),
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body).toHaveLength(1); // Only JavaScript today
      expect(response.body[0].name).toBe('JavaScript');
    });
  });

  describe('GET /api/v1/users/current/stats/editors', () => {
    it('should return editor statistics', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats/editors')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('VS Code');
      expect(response.body[0].total_seconds).toBeDefined();
      expect(response.body[0].percent).toBe(100);
    });
  });

  describe('GET /api/v1/users/current/stats/projects', () => {
    it('should return project statistics', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/stats/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.map(p => p.name)).toContain('Project1');
      expect(response.body.map(p => p.name)).toContain('Project2');
    });

    it('should handle projects with no activity', async () => {
      await prisma.userStats.updateMany({
        where: { userId: testUser.id },
        data: { projects: [] }
      });

      const response = await request(app)
        .get('/api/v1/users/current/stats/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });
});
