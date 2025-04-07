const request = require('supertest');
const app = require('../../app');
const { prisma, redis } = require('../setup');
const jwt = require('jsonwebtoken');

describe('Collaboration Routes', () => {
  let testUser;
  let testTeam;
  let authToken;
  let collaborator;

  beforeEach(async () => {
    await prisma.team.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushall();

    testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        apiKey: 'waka_test_12345'
      }
    });

    collaborator = await prisma.user.create({
      data: {
        username: 'collaborator',
        email: 'collaborator@example.com',
        apiKey: 'waka_test_67890'
      }
    });

    authToken = jwt.sign(
      { userId: testUser.id },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    testTeam = await prisma.team.create({
      data: {
        name: 'Test Team',
        description: 'A team for testing',
        ownerId: testUser.id,
        visibility: 'PRIVATE'
      }
    });

    await prisma.teamMember.create({
      data: {
        teamId: testTeam.id,
        userId: testUser.id,
        role: 'OWNER'
      }
    });
  });

  describe('POST /api/v1/teams', () => {
    it('should create a new team', async () => {
      const teamData = {
        name: 'New Team',
        description: 'Another test team',
        visibility: 'PUBLIC'
      };

      const response = await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${authToken}`)
        .send(teamData)
        .expect(201);

      expect(response.body.name).toBe(teamData.name);
      expect(response.body.ownerId).toBe(testUser.id);
      
      // Verify team member entry was created
      const membership = await prisma.teamMember.findFirst({
        where: {
          teamId: response.body.id,
          userId: testUser.id
        }
      });
      expect(membership.role).toBe('OWNER');
    });

    it('should validate team data', async () => {
      const invalidData = {
        name: '', // Empty name
        visibility: 'INVALID'
      };

      await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(422);
    });
  });

  describe('GET /api/v1/teams', () => {
    it('should return user teams', async () => {
      const response = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Test Team');
    });

    it('should include team statistics', async () => {
      const response = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('member_count');
      expect(response.body.data[0]).toHaveProperty('total_coding_time');
    });
  });

  describe('GET /api/v1/teams/:id', () => {
    it('should return team details', async () => {
      const response = await request(app)
        .get(`/api/v1/teams/${testTeam.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.name).toBe(testTeam.name);
      expect(response.body.members).toBeDefined();
    });

    it('should not allow access to private teams for non-members', async () => {
      const nonMemberToken = jwt.sign(
        { userId: collaborator.id },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .get(`/api/v1/teams/${testTeam.id}`)
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .expect(403);
    });
  });

  describe('PUT /api/v1/teams/:id', () => {
    it('should update team details', async () => {
      const updateData = {
        name: 'Updated Team Name',
        description: 'Updated description',
        visibility: 'PUBLIC'
      };

      const response = await request(app)
        .put(`/api/v1/teams/${testTeam.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.name).toBe(updateData.name);
      expect(response.body.visibility).toBe(updateData.visibility);
    });

    it('should only allow team owner to update', async () => {
      await prisma.teamMember.create({
        data: {
          teamId: testTeam.id,
          userId: collaborator.id,
          role: 'MEMBER'
        }
      });

      const memberToken = jwt.sign(
        { userId: collaborator.id },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .put(`/api/v1/teams/${testTeam.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Try to update' })
        .expect(403);
    });
  });

  describe('POST /api/v1/teams/:id/members', () => {
    it('should add a new team member', async () => {
      const memberData = {
        userId: collaborator.id,
        role: 'MEMBER'
      };

      const response = await request(app)
        .post(`/api/v1/teams/${testTeam.id}/members`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(memberData)
        .expect(201);

      expect(response.body.userId).toBe(collaborator.id);
      expect(response.body.role).toBe('MEMBER');
    });

    it('should prevent duplicate memberships', async () => {
      await prisma.teamMember.create({
        data: {
          teamId: testTeam.id,
          userId: collaborator.id,
          role: 'MEMBER'
        }
      });

      await request(app)
        .post(`/api/v1/teams/${testTeam.id}/members`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userId: collaborator.id, role: 'MEMBER' })
        .expect(400);
    });
  });

  describe('DELETE /api/v1/teams/:id/members/:userId', () => {
    it('should remove a team member', async () => {
      await prisma.teamMember.create({
        data: {
          teamId: testTeam.id,
          userId: collaborator.id,
          role: 'MEMBER'
        }
      });

      await request(app)
        .delete(`/api/v1/teams/${testTeam.id}/members/${collaborator.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify member was removed
      const membership = await prisma.teamMember.findFirst({
        where: {
          teamId: testTeam.id,
          userId: collaborator.id
        }
      });
      expect(membership).toBeNull();
    });

    it('should not allow removing the team owner', async () => {
      await request(app)
        .delete(`/api/v1/teams/${testTeam.id}/members/${testUser.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/teams/:id/activity', () => {
    beforeEach(async () => {
      // Add some team activity
      await prisma.teamActivity.createMany({
        data: [
          {
            teamId: testTeam.id,
            userId: testUser.id,
            type: 'CODE',
            data: {
              project: 'Project1',
              language: 'JavaScript',
              duration: 3600
            },
            timestamp: new Date()
          },
          {
            teamId: testTeam.id,
            userId: testUser.id,
            type: 'COMMIT',
            data: {
              repository: 'repo1',
              message: 'Test commit'
            },
            timestamp: new Date(Date.now() - 3600000)
          }
        ]
      });
    });

    it('should return team activity feed', async () => {
      const response = await request(app)
        .get(`/api/v1/teams/${testTeam.id}/activity`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty('type');
      expect(response.body.data[0]).toHaveProperty('data');
    });

    it('should filter activity by type', async () => {
      const response = await request(app)
        .get(`/api/v1/teams/${testTeam.id}/activity`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ type: 'CODE' })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('CODE');
    });
  });
});
