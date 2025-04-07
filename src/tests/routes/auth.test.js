const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Auth Routes', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
    await redis.flushall();
  });

  describe('Twitter Authentication', () => {
    it('should redirect to Twitter for authentication', async () => {
      const response = await request(app)
        .get('/api/v1/auth/twitter')
        .expect(302);
      
      expect(response.header.location).toContain('twitter.com');
    });

    it('should handle Twitter callback and create new user', async () => {
      const mockProfile = {
        id: '123456',
        username: 'testuser',
        emails: [{ value: 'test@example.com' }],
        photos: [{ value: 'http://example.com/photo.jpg' }]
      };

      // Mock passport Twitter strategy
      jest.mock('passport-twitter', () => ({
        Strategy: jest.fn((config, cb) => {
          cb(null, 'mock-token', 'mock-secret', mockProfile, jest.fn());
        })
      }));

      const response = await request(app)
        .get('/api/v1/auth/twitter/callback')
        .expect(200);

      const user = await prisma.user.findFirst({
        where: { twitterId: mockProfile.id }
      });

      expect(user).toBeTruthy();
      expect(user.username).toBe(mockProfile.username);
      expect(response.body).toHaveProperty('token');
    });
  });

  describe('LinkedIn Authentication', () => {
    it('should redirect to LinkedIn for authentication', async () => {
      const response = await request(app)
        .get('/api/v1/auth/linkedin')
        .expect(302);
      
      expect(response.header.location).toContain('linkedin.com');
    });

    it('should handle LinkedIn callback and create new user', async () => {
      const mockProfile = {
        id: '789012',
        displayName: 'Test User',
        emails: [{ value: 'test@example.com' }],
        photos: [{ value: 'http://example.com/photo.jpg' }]
      };

      // Mock passport LinkedIn strategy
      jest.mock('passport-linkedin-oauth2', () => ({
        Strategy: jest.fn((config, cb) => {
          cb(null, 'mock-token', 'mock-refresh-token', mockProfile, jest.fn());
        })
      }));

      const response = await request(app)
        .get('/api/v1/auth/linkedin/callback')
        .expect(200);

      const user = await prisma.user.findFirst({
        where: { linkedinId: mockProfile.id }
      });

      expect(user).toBeTruthy();
      expect(user.username).toBe(mockProfile.displayName);
      expect(response.body).toHaveProperty('token');
    });
  });

  describe('Token Validation', () => {
    it('should validate a valid JWT token', async () => {
      const user = await prisma.user.create({
        data: {
          username: 'testuser',
          email: 'test@example.com',
          twitterId: '123'
        }
      });

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/v1/auth/validate')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.user.id).toBe(user.id);
    });

    it('should reject an invalid JWT token', async () => {
      await request(app)
        .get('/api/v1/auth/validate')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
