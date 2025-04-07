const request = require('supertest');
const { app } = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Heartbeats Routes', () => {
  let testUser;
  let authToken;
  let server;

  beforeAll(async () => {
    server = app.listen(3000);
  });

  beforeEach(async () => {
    // Clean up in correct order to handle foreign key constraints
    await prisma.heartbeat.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushall();

    // Create test user with API key
    testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        apiKeys: {
          create: {
            key: 'waka_test_12345',
            name: 'Test API Key'
          }
        }
      },
      include: {
        apiKeys: true
      }
    });

    authToken = jwt.sign(
      { userId: testUser.id },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Clean up server
    await new Promise((resolve) => server.close(resolve));
  });

  describe('POST /api/v1/users/current/heartbeats', () => {
    it('should create a new heartbeat with valid data', async () => {
      const heartbeatData = {
        entity: '/path/to/file.js',
        type: 'file',
        time: Date.now() / 1000,
        project: 'TestProject',
        language: 'JavaScript',
        is_write: true,
        editor_name: 'VS Code',
        platform: 'Linux'
      };

      const response = await request(app)
        .post('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${testUser.apiKeys[0].key}`)
        .send(heartbeatData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.entity).toBe(heartbeatData.entity);
      
      // Verify heartbeat was saved
      const savedHeartbeat = await prisma.heartbeat.findUnique({
        where: { id: response.body.id }
      });
      expect(savedHeartbeat).toBeTruthy();
    });

    it('should handle duplicate heartbeats within 2 minutes', async () => {
      const time = Date.now() / 1000;
      const heartbeatData = {
        entity: '/path/to/file.js',
        type: 'file',
        time: time,
        project: 'TestProject',
        language: 'JavaScript'
      };

      // Create first heartbeat
      await request(app)
        .post('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${testUser.apiKeys[0].key}`)
        .send(heartbeatData)
        .expect(201);

      // Create duplicate heartbeat within 2 minutes
      const duplicateResponse = await request(app)
        .post('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${testUser.apiKeys[0].key}`)
        .send({
          ...heartbeatData,
          time: time + 60 // 1 minute later
        })
        .expect(200);

      expect(duplicateResponse.body.id).toBeDefined();
      expect(duplicateResponse.body.is_duplicate).toBe(true);
    });

    it('should reject heartbeat with invalid API key', async () => {
      const heartbeatData = {
        entity: '/path/to/file.js',
        type: 'file',
        time: Date.now() / 1000
      };

      await request(app)
        .post('/api/v1/users/current/heartbeats')
        .set('Authorization', 'Bearer invalid_key')
        .send(heartbeatData)
        .expect(401);
    });

    it('should validate required heartbeat fields', async () => {
      const invalidHeartbeat = {
        // Missing required fields
        type: 'file'
      };

      const response = await request(app)
        .post('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${testUser.apiKeys[0].key}`)
        .send(invalidHeartbeat)
        .expect(422);

      expect(response.body.error).toBe('Validation Error');
    });
  });

  describe('GET /api/v1/users/current/heartbeats', () => {
    beforeEach(async () => {
      // Create some test heartbeats
      await prisma.heartbeat.createMany({
        data: [
          {
            userId: testUser.id,
            entity: '/test/file1.js',
            type: 'file',
            time: new Date(),
            project: 'Project1',
            language: 'JavaScript'
          },
          {
            userId: testUser.id,
            entity: '/test/file2.py',
            type: 'file',
            time: new Date(Date.now() - 3600000), // 1 hour ago
            project: 'Project2',
            language: 'Python'
          }
        ]
      });
    });

    it('should return user heartbeats with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter heartbeats by date range', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date(Date.now() - 1800000).toISOString(), // 30 mins ago
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].entity).toBe('/test/file1.js');
    });

    it('should filter heartbeats by project', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project: 'Project1' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].project).toBe('Project1');
    });
  });

  describe('DELETE /api/v1/users/current/heartbeats', () => {
    it('should delete user heartbeats by date range', async () => {
      // Create test heartbeats
      await prisma.heartbeat.createMany({
        data: [
          {
            userId: testUser.id,
            entity: '/test/file1.js',
            type: 'file',
            time: new Date(),
            project: 'Project1'
          },
          {
            userId: testUser.id,
            entity: '/test/file2.js',
            type: 'file',
            time: new Date(Date.now() - 86400000), // 1 day ago
            project: 'Project1'
          }
        ]
      });

      const response = await request(app)
        .delete('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start: new Date(Date.now() - 43200000).toISOString(), // 12 hours ago
          end: new Date().toISOString()
        })
        .expect(200);

      expect(response.body.deleted).toBe(1);

      // Verify only recent heartbeat was deleted
      const remaining = await prisma.heartbeat.findMany({
        where: { userId: testUser.id }
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].entity).toBe('/test/file2.js');
    });

    it('should require date range for deletion', async () => {
      await request(app)
        .delete('/api/v1/users/current/heartbeats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(422);
    });
  });
});
