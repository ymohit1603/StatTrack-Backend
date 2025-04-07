const { checkTierLimits } = require('../../middleware/tierLimits');
const { prisma, redis } = require('../setup');

describe('Tier Limits Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let testUser;

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushall();

    testUser = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        twitterId: '123'
      }
    });

    mockReq = {
      user: testUser,
      path: '/api/v1/test'
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  it('should allow free tier within limits', async () => {
    // Free tier user with no subscription
    await checkTierLimits(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should allow PRO tier within limits', async () => {
    await prisma.subscription.create({
      data: {
        userId: testUser.id,
        plan: 'PRO',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    await checkTierLimits(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should block when rate limit exceeded', async () => {
    // Simulate rate limit exceeded
    const key = `ratelimit:${testUser.id}:${mockReq.path}`;
    await redis.set(key, '1000'); // Set high request count
    await redis.expire(key, 3600); // Expire in 1 hour

    await checkTierLimits(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Rate limit exceeded'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle expired subscriptions', async () => {
    await prisma.subscription.create({
      data: {
        userId: testUser.id,
        plan: 'PRO',
        status: 'EXPIRED',
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1000) // Expired
      }
    });

    await checkTierLimits(mockReq, mockRes, mockNext);

    // Should be treated as free tier
    expect(mockNext).toHaveBeenCalled();
  });

  it('should increment request counter', async () => {
    await checkTierLimits(mockReq, mockRes, mockNext);

    const key = `ratelimit:${testUser.id}:${mockReq.path}`;
    const count = await redis.get(key);
    
    expect(parseInt(count)).toBe(1);
  });

  it('should respect different tier limits', async () => {
    // Create premium subscription
    await prisma.subscription.create({
      data: {
        userId: testUser.id,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    // Make multiple requests
    for (let i = 0; i < 100; i++) {
      await checkTierLimits(mockReq, mockRes, mockNext);
    }

    // Premium tier should allow more requests
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalledWith(429);
  });
});
