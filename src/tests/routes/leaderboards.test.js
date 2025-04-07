const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Leaderboards Routes', () => {
  let testUser;
  let authToken;

  beforeEach(async () => {
    await prisma.leaderboard.deleteMany();
    await prisma.leaderboardEntry.deleteMany();
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

    // Create test users for leaderboard
    const users = await prisma.user.createMany({
      data: Array.from({ length: 5 }).map((_, i) => ({
        username: `user${i}`,
        email: `user${i}@example.com`
      }))
    });

    // Create test leaderboard
    const leaderboard = await prisma.leaderboard.create({
      data: {
        type: 'WEEKLY',
        start_date: new Date(),
        end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE'
      }
    });

    // Create leaderboard entries
    await prisma.leaderboardEntry.createMany({
      data: [
        {
          leaderboardId: leaderboard.id,
          userId: testUser.id,
          rank: 1,
          score: 3600,
          languages: ['JavaScript', 'TypeScript'],
          projects: ['Project1']
        },
        ...Array.from({ length: 5 }).map((_, i) => ({
          leaderboardId: leaderboard.id,
          userId: users[i],
          rank: i + 2,
          score: 3600 - ((i + 1) * 600),
          languages: ['JavaScript'],
          projects: ['Project2']
        }))
      ]
    });
  });

  describe('GET /api/v1/leaderboards/current', () => {
    it('should return current leaderboard', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/current')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.type).toBe('WEEKLY');
      expect(response.body.entries).toHaveLength(6);
      expect(response.body.entries[0].rank).toBe(1);
      expect(response.body.entries[0].username).toBe('testuser');
    });

    it('should include user stats in leaderboard entries', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/current')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.entries[0]).toHaveProperty('languages');
      expect(response.body.entries[0]).toHaveProperty('projects');
      expect(response.body.entries[0]).toHaveProperty('score');
    });
  });

  describe('GET /api/v1/leaderboards/history', () => {
    beforeEach(async () => {
      // Create historical leaderboard
      const historicalLeaderboard = await prisma.leaderboard.create({
        data: {
          type: 'WEEKLY',
          start_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          end_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          status: 'COMPLETED'
        }
      });

      await prisma.leaderboardEntry.create({
        data: {
          leaderboardId: historicalLeaderboard.id,
          userId: testUser.id,
          rank: 2,
          score: 2400,
          languages: ['Python'],
          projects: ['OldProject']
        }
      });
    });

    it('should return leaderboard history', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter history by date range', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('ACTIVE');
    });
  });

  describe('GET /api/v1/leaderboards/:id', () => {
    it('should return specific leaderboard details', async () => {
      const leaderboard = await prisma.leaderboard.findFirst();

      const response = await request(app)
        .get(`/api/v1/leaderboards/${leaderboard.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(leaderboard.id);
      expect(response.body.type).toBe(leaderboard.type);
      expect(response.body.entries).toBeDefined();
    });

    it('should return 404 for non-existent leaderboard', async () => {
      await request(app)
        .get('/api/v1/leaderboards/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/leaderboards/user/:userId', () => {
    it('should return user leaderboard history', async () => {
      const response = await request(app)
        .get(`/api/v1/leaderboards/user/${testUser.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].rank).toBe(1);
      expect(response.body.stats).toBeDefined();
    });

    it('should include user performance stats', async () => {
      const response = await request(app)
        .get(`/api/v1/leaderboards/user/${testUser.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.stats).toHaveProperty('best_rank');
      expect(response.body.stats).toHaveProperty('average_rank');
      expect(response.body.stats).toHaveProperty('total_entries');
    });
  });

  describe('GET /api/v1/leaderboards/rankings', () => {
    it('should return current user rankings', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/rankings')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('global_rank');
      expect(response.body).toHaveProperty('language_ranks');
      expect(response.body).toHaveProperty('percentile');
    });

    it('should calculate language-specific rankings', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboards/rankings')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ language: 'JavaScript' })
        .expect(200);

      expect(response.body.language_ranks).toHaveProperty('JavaScript');
      expect(response.body.language_ranks.JavaScript).toHaveProperty('rank');
      expect(response.body.language_ranks.JavaScript).toHaveProperty('total_users');
    });
  });
});
