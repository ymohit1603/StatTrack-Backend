const { processHeartbeats } = require('../../workers/heartbeatWorker');
const { prisma, redis } = require('../setup');

describe('Heartbeat Worker', () => {
  beforeEach(async () => {
    await prisma.heartbeat.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushall();
  });

  it('should process heartbeats correctly', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        twitterId: '123'
      }
    });

    // Create test heartbeats
    const heartbeats = await Promise.all([
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: new Date(),
          project: 'test-project',
          language: 'JavaScript',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.js',
          is_write: true
        }
      }),
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: new Date(Date.now() - 5000), // 5 seconds ago
          project: 'test-project',
          language: 'JavaScript',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.js',
          is_write: false
        }
      })
    ]);

    await processHeartbeats();

    // Check that stats were updated
    const stats = await prisma.userStats.findFirst({
      where: {
        userId: user.id
      }
    });

    expect(stats).toBeDefined();
    expect(stats.total_coding_time).toBeGreaterThan(0);
    expect(stats.languages).toContain('JavaScript');
    expect(stats.projects).toContain('test-project');

    // Check that old heartbeats were cleaned up
    const remainingHeartbeats = await prisma.heartbeat.count();
    expect(remainingHeartbeats).toBe(0);
  });

  it('should handle inactive periods correctly', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        twitterId: '123'
      }
    });

    // Create heartbeats with large time gap
    await Promise.all([
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: new Date(),
          project: 'test-project',
          language: 'JavaScript',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.js',
          is_write: true
        }
      }),
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
          project: 'test-project',
          language: 'JavaScript',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.js',
          is_write: true
        }
      })
    ]);

    await processHeartbeats();

    const stats = await prisma.userStats.findFirst({
      where: {
        userId: user.id
      }
    });

    // Should not count time between heartbeats as coding time
    expect(stats.total_coding_time).toBeLessThan(15 * 60);
  });

  it('should update daily stats correctly', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        twitterId: '123'
      }
    });

    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Create heartbeats for different days
    await Promise.all([
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: today,
          project: 'test-project',
          language: 'JavaScript',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.js',
          is_write: true
        }
      }),
      prisma.heartbeat.create({
        data: {
          userId: user.id,
          timestamp: yesterday,
          project: 'test-project',
          language: 'Python',
          editor: 'VS Code',
          platform: 'Linux',
          file_path: '/test/file.py',
          is_write: true
        }
      })
    ]);

    await processHeartbeats();

    const dailyStats = await prisma.dailyStats.findMany({
      where: {
        userId: user.id
      }
    });

    expect(dailyStats.length).toBe(2);
    expect(dailyStats.some(stat => stat.date.toDateString() === today.toDateString())).toBe(true);
    expect(dailyStats.some(stat => stat.date.toDateString() === yesterday.toDateString())).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    const invalidHeartbeat = prisma.heartbeat.create({
      data: {
        userId: 'invalid-user-id',
        timestamp: new Date(),
        project: 'test-project',
        language: 'JavaScript',
        editor: 'VS Code',
        platform: 'Linux',
        file_path: '/test/file.js',
        is_write: true
      }
    });

    await expect(processHeartbeats()).resolves.not.toThrow();
  });
});
