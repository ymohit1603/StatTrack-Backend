const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Insights Routes', () => {
  let testUser;
  let authToken;

  beforeEach(async () => {
    await prisma.insight.deleteMany();
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

    // Create test insights data
    await prisma.insight.createMany({
      data: [
        {
          userId: testUser.id,
          type: 'PRODUCTIVITY_PEAK',
          title: 'Most Productive Time',
          description: 'You are most productive between 9 AM and 11 AM',
          data: {
            hour_start: 9,
            hour_end: 11,
            average_coding_time: 3600
          },
          date: new Date()
        },
        {
          userId: testUser.id,
          type: 'LANGUAGE_TREND',
          title: 'Language Trend',
          description: 'TypeScript usage increased by 30%',
          data: {
            language: 'TypeScript',
            trend_percentage: 30,
            previous_period: '2025-03',
            current_period: '2025-04'
          },
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
        }
      ]
    });
  });

  describe('GET /api/v1/users/current/insights', () => {
    it('should return user insights with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter insights by type', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ type: 'PRODUCTIVITY_PEAK' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('PRODUCTIVITY_PEAK');
    });

    it('should filter insights by date range', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('PRODUCTIVITY_PEAK');
    });
  });

  describe('GET /api/v1/users/current/insights/productivity', () => {
    it('should return productivity insights', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights/productivity')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('peak_hours');
      expect(response.body).toHaveProperty('daily_average');
      expect(response.body).toHaveProperty('best_days');
    });

    it('should calculate productivity trends correctly', async () => {
      // Add some coding activity data
      await prisma.dailyStats.createMany({
        data: Array.from({ length: 7 }).map((_, i) => ({
          userId: testUser.id,
          date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          coding_time: 3600 + (i * 600), // Increasing time each day back
          languages: ['JavaScript'],
          projects: ['Project1']
        }))
      });

      const response = await request(app)
        .get('/api/v1/users/current/insights/productivity')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trend).toBeDefined();
      expect(response.body.trend.direction).toBe('increasing');
    });
  });

  describe('GET /api/v1/users/current/insights/languages', () => {
    it('should return language usage insights', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights/languages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('primary_language');
      expect(response.body).toHaveProperty('language_trends');
      expect(response.body).toHaveProperty('recommendations');
    });

    it('should identify language learning opportunities', async () => {
      // Add language stats
      await prisma.userStats.create({
        data: {
          userId: testUser.id,
          languages: ['JavaScript', 'Python', 'TypeScript'],
          language_seconds: {
            JavaScript: 7200,
            Python: 3600,
            TypeScript: 1800
          },
          total_coding_time: 12600
        }
      });

      const response = await request(app)
        .get('/api/v1/users/current/insights/languages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.primary_language).toBe('JavaScript');
      expect(response.body.recommendations).toContain('TypeScript');
    });
  });

  describe('GET /api/v1/users/current/insights/projects', () => {
    beforeEach(async () => {
      // Add project activity data
      await prisma.project.createMany({
        data: [
          {
            name: 'Active Project',
            userId: testUser.id,
            total_coding_time: 7200,
            last_heartbeat_at: new Date(),
            languages: ['JavaScript', 'TypeScript']
          },
          {
            name: 'Stale Project',
            userId: testUser.id,
            total_coding_time: 3600,
            last_heartbeat_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            languages: ['Python']
          }
        ]
      });
    });

    it('should return project insights', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('active_projects');
      expect(response.body).toHaveProperty('stale_projects');
      expect(response.body).toHaveProperty('project_recommendations');
    });

    it('should identify stale projects correctly', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/insights/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.stale_projects).toHaveLength(1);
      expect(response.body.stale_projects[0].name).toBe('Stale Project');
    });
  });

  describe('POST /api/v1/users/current/insights/feedback', () => {
    it('should submit insight feedback', async () => {
      const insight = await prisma.insight.findFirst({
        where: { userId: testUser.id }
      });

      const feedbackData = {
        insightId: insight.id,
        isHelpful: true,
        feedback: 'This insight was very useful'
      };

      const response = await request(app)
        .post('/api/v1/users/current/insights/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send(feedbackData)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify feedback was saved
      const updatedInsight = await prisma.insight.findUnique({
        where: { id: insight.id }
      });
      expect(updatedInsight.feedback).toContain(feedbackData.feedback);
    });

    it('should validate feedback data', async () => {
      await request(app)
        .post('/api/v1/users/current/insights/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          insightId: 'invalid-id',
          isHelpful: 'not-a-boolean'
        })
        .expect(422);
    });
  });
});
