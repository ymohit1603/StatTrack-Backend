const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Projects Routes', () => {
  let testUser;
  let authToken;
  let testProject;

  beforeEach(async () => {
    await prisma.project.deleteMany();
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

    testProject = await prisma.project.create({
      data: {
        name: 'Test Project',
        userId: testUser.id,
        repository_url: 'https://github.com/test/project',
        languages: ['JavaScript', 'TypeScript'],
        total_coding_time: 3600,
        last_heartbeat_at: new Date()
      }
    });
  });

  describe('GET /api/v1/users/current/projects', () => {
    it('should return user projects with pagination', async () => {
      // Create additional test project
      await prisma.project.create({
        data: {
          name: 'Another Project',
          userId: testUser.id,
          languages: ['Python'],
          total_coding_time: 1800,
          last_heartbeat_at: new Date()
        }
      });

      const response = await request(app)
        .get('/api/v1/users/current/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter projects by name', async () => {
      const response = await request(app)
        .get('/api/v1/users/current/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ search: 'Test' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Test Project');
    });

    it('should sort projects by coding time', async () => {
      await prisma.project.create({
        data: {
          name: 'Most Active Project',
          userId: testUser.id,
          languages: ['Python'],
          total_coding_time: 7200,
          last_heartbeat_at: new Date()
        }
      });

      const response = await request(app)
        .get('/api/v1/users/current/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sort: 'total_coding_time', order: 'desc' })
        .expect(200);

      expect(response.body.data[0].name).toBe('Most Active Project');
    });
  });

  describe('GET /api/v1/users/current/projects/:id', () => {
    it('should return project details', async () => {
      const response = await request(app)
        .get(`/api/v1/users/current/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.name).toBe('Test Project');
      expect(response.body.repository_url).toBe('https://github.com/test/project');
      expect(response.body.languages).toContain('JavaScript');
    });

    it('should return 404 for non-existent project', async () => {
      await request(app)
        .get('/api/v1/users/current/projects/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should not return other users projects', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: 'otheruser',
          email: 'other@example.com'
        }
      });

      const otherProject = await prisma.project.create({
        data: {
          name: 'Other Project',
          userId: otherUser.id,
          languages: ['Java']
        }
      });

      await request(app)
        .get(`/api/v1/users/current/projects/${otherProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/users/current/projects/:id', () => {
    it('should update project details', async () => {
      const updateData = {
        name: 'Updated Project Name',
        repository_url: 'https://github.com/test/updated',
        is_private: true
      };

      const response = await request(app)
        .put(`/api/v1/users/current/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.name).toBe(updateData.name);
      expect(response.body.repository_url).toBe(updateData.repository_url);
      expect(response.body.is_private).toBe(true);
    });

    it('should validate update data', async () => {
      const invalidData = {
        name: '' // Empty name should not be allowed
      };

      await request(app)
        .put(`/api/v1/users/current/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(422);
    });
  });

  describe('DELETE /api/v1/users/current/projects/:id', () => {
    it('should delete a project', async () => {
      await request(app)
        .delete(`/api/v1/users/current/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify project was deleted
      const deleted = await prisma.project.findUnique({
        where: { id: testProject.id }
      });
      expect(deleted).toBeNull();
    });

    it('should not delete other users projects', async () => {
      const otherUser = await prisma.user.create({
        data: {
          username: 'otheruser',
          email: 'other@example.com'
        }
      });

      const otherProject = await prisma.project.create({
        data: {
          name: 'Other Project',
          userId: otherUser.id,
          languages: ['Java']
        }
      });

      await request(app)
        .delete(`/api/v1/users/current/projects/${otherProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      // Verify project was not deleted
      const stillExists = await prisma.project.findUnique({
        where: { id: otherProject.id }
      });
      expect(stillExists).toBeTruthy();
    });
  });
});
