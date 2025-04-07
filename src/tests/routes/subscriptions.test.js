const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Subscription Routes', () => {
  let testUser;
  let authToken;

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    
    // Create test user
    testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        twitterId: '123'
      }
    });

    authToken = jwt.sign(
      { userId: testUser.id },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  describe('GET /api/v1/subscriptions', () => {
    it('should return user subscription details', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          userId: testUser.id,
          plan: 'PRO',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.plan).toBe('PRO');
      expect(response.body.status).toBe('ACTIVE');
    });

    it('should return 404 if user has no subscription', async () => {
      await request(app)
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/subscriptions', () => {
    it('should create a new subscription', async () => {
      const subscriptionData = {
        plan: 'PRO',
        paymentMethod: 'STRIPE',
        billingPeriod: 'MONTHLY'
      };

      const response = await request(app)
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(201);

      expect(response.body.plan).toBe('PRO');
      expect(response.body.status).toBe('ACTIVE');

      const dbSubscription = await prisma.subscription.findFirst({
        where: { userId: testUser.id }
      });
      expect(dbSubscription).toBeTruthy();
      expect(dbSubscription.plan).toBe('PRO');
    });

    it('should not allow duplicate active subscriptions', async () => {
      await prisma.subscription.create({
        data: {
          userId: testUser.id,
          plan: 'PRO',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      const subscriptionData = {
        plan: 'PREMIUM',
        paymentMethod: 'STRIPE',
        billingPeriod: 'MONTHLY'
      };

      await request(app)
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(subscriptionData)
        .expect(400);
    });
  });

  describe('PUT /api/v1/subscriptions/:id', () => {
    it('should update subscription plan', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          userId: testUser.id,
          plan: 'PRO',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      const response = await request(app)
        .put(`/api/v1/subscriptions/${subscription.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ plan: 'PREMIUM' })
        .expect(200);

      expect(response.body.plan).toBe('PREMIUM');

      const updatedSubscription = await prisma.subscription.findUnique({
        where: { id: subscription.id }
      });
      expect(updatedSubscription.plan).toBe('PREMIUM');
    });
  });

  describe('DELETE /api/v1/subscriptions/:id', () => {
    it('should cancel subscription', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          userId: testUser.id,
          plan: 'PRO',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      await request(app)
        .delete(`/api/v1/subscriptions/${subscription.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const cancelledSubscription = await prisma.subscription.findUnique({
        where: { id: subscription.id }
      });
      expect(cancelledSubscription.status).toBe('CANCELLED');
    });
  });
});
