const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Goals Routes', () => {
  let testUser;
  let authToken;
  let testGoal;

  beforeEach(async () => {
    await prisma.goal.deleteMany();
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

    testGoal = await prisma.goal.create({
      data: {
        userId: testUser.id,
        title: 'Code 4 hours daily',
        type: 'DAILY',
        target_hours: 4,
        days_of_week: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        status: 'ACTIVE',
        progress: 0
      }
    });
  });

  describe('POST /api/v1/users/current/goals', () => {
    it('should create a new goal', async () => {
      const goalData = {
        title: 'Learn TypeScript',
        type: 'WEEKLY',
        target_hours: 10,
        days_of_week: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      };

      const response = await request(app)
        .post('/api/v1/users/current/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.title).toBe(goalData.title);
      expect(response.body.type).toBe(goalData.type);
      expect(response.body.target_hours).toBe(goalData.target_hours);
      expect(response.body.status).toBe('ACTIVE');
    });

    it('should validate goal data', async () => {
      const invalidGoal = {
        title: 'Invalid Goal',
        type: 'INVALID_TYPE',
        target_hours: -1
      };

      const response = await request(app)
        .post('/api/v1/users/current/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidGoal)
        .expect(422);

      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('GET /api/v1/users/current/goals', () => {
    it('should return user goals with pagination', async () => {
      // Create additional test goal
      await prisma.goal.create({
        data: {
          userId: testUser.id,
          title: 'Weekly Python Practice',
          type: 'WEEKLY',
          target_hours: 5,
          days_of_week: ['SATURDAY', 'SUNDAY'],
          start_date: new Date(),
          end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'ACTIVE',
          progress: 2
        }
      });

      const response = await request(app)
        .get('/api/v1/users/current/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter goals by status', async () => {
      await prisma.goal.create({
        data: {
          userId: testUser.id,
          title: 'Completed Goal',
          type: 'WEEKLY',
          target_hours: 5,
          days_of_week: ['MONDAY'],
          start_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          end_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          status: 'COMPLETED',
          progress: 5
        }
      });

      const response = await request(app)
        .get('/api/v1/users/current/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'COMPLETED' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('COMPLETED');
    });
  });

  describe('GET /api/v1/users/current/goals/:id', () => {
    it('should return goal details', async () => {
      const response = await request(app)
        .get(`/api/v1/users/current/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.title).toBe(testGoal.title);
      expect(response.body.type).toBe(testGoal.type);
      expect(response.body.target_hours).toBe(testGoal.target_hours);
    });

    it('should return 404 for non-existent goal', async () => {
      await request(app)
        .get('/api/v1/users/current/goals/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/users/current/goals/:id', () => {
    it('should update goal details', async () => {
      const updateData = {
        title: 'Updated Goal Title',
        target_hours: 6,
        days_of_week: ['MONDAY', 'WEDNESDAY', 'FRIDAY']
      };

      const response = await request(app)
        .put(`/api/v1/users/current/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.title).toBe(updateData.title);
      expect(response.body.target_hours).toBe(updateData.target_hours);
      expect(response.body.days_of_week).toEqual(updateData.days_of_week);
    });

    it('should not update completed goals', async () => {
      await prisma.goal.update({
        where: { id: testGoal.id },
        data: { status: 'COMPLETED' }
      });

      await request(app)
        .put(`/api/v1/users/current/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Try to update completed goal' })
        .expect(400);
    });
  });

  describe('DELETE /api/v1/users/current/goals/:id', () => {
    it('should delete a goal', async () => {
      await request(app)
        .delete(`/api/v1/users/current/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify goal was deleted
      const deleted = await prisma.goal.findUnique({
        where: { id: testGoal.id }
      });
      expect(deleted).toBeNull();
    });

    it('should not delete completed goals', async () => {
      await prisma.goal.update({
        where: { id: testGoal.id },
        data: { status: 'COMPLETED' }
      });

      await request(app)
        .delete(`/api/v1/users/current/goals/${testGoal.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      // Verify goal still exists
      const stillExists = await prisma.goal.findUnique({
        where: { id: testGoal.id }
      });
      expect(stillExists).toBeTruthy();
    });
  });

  describe('PUT /api/v1/users/current/goals/:id/progress', () => {
    it('should update goal progress', async () => {
      const progressData = {
        hours_completed: 2
      };

      const response = await request(app)
        .put(`/api/v1/users/current/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(progressData)
        .expect(200);

      expect(response.body.progress).toBe(2);
      
      // Check if goal is marked as completed when target is reached
      await request(app)
        .put(`/api/v1/users/current/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ hours_completed: 4 })
        .expect(200);

      const completedGoal = await prisma.goal.findUnique({
        where: { id: testGoal.id }
      });
      expect(completedGoal.status).toBe('COMPLETED');
    });

    it('should validate progress data', async () => {
      await request(app)
        .put(`/api/v1/users/current/goals/${testGoal.id}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ hours_completed: -1 })
        .expect(422);
    });
  });
});
