const request = require('supertest');
const app = require('../app');
const { prisma, redis } = require('./setup');

describe('App', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('Basic Routes', () => {
    it('should return 200 on health check', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.status).toBe('ok');
    });

    it('should return 404 for non-existent routes', async () => {
      await request(app)
        .get('/non-existent-route')
        .expect(404);
    });
  });

  describe('API Security', () => {
    it('should have security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    it('should handle CORS', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://example.com')
        .expect(204);
      
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle JSON parsing errors', async () => {
      await request(app)
        .post('/api/v1/any-endpoint')
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(400);
    });

    it('should handle validation errors', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({})
        .expect(422);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting', async () => {
      // Make multiple requests in quick succession
      const requests = Array(150).fill().map(() => 
        request(app).get('/health')
      );
      
      const responses = await Promise.all(requests);
      
      // At least some requests should be rate limited
      expect(responses.some(r => r.status === 429)).toBe(true);
    });
  });

  describe('Compression', () => {
    it('should compress responses', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept-Encoding', 'gzip')
        .expect(200);
      
      expect(response.headers['content-encoding']).toBe('gzip');
    });
  });
});
