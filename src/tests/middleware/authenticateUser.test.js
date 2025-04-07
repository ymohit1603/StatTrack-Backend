const jwt = require('jsonwebtoken');
const { authenticateUser } = require('../../middleware/authenticateUser');
const { prisma } = require('../setup');

describe('Authentication Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      headers: {},
      get: jest.fn()
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  it('should authenticate valid JWT token', async () => {
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

    mockReq.headers.authorization = `Bearer ${token}`;

    await authenticateUser(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.user).toBeDefined();
    expect(mockReq.user.id).toBe(user.id);
  });

  it('should reject request without token', async () => {
    await authenticateUser(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication token required'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject invalid token format', async () => {
    mockReq.headers.authorization = 'InvalidToken';

    await authenticateUser(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Invalid token format'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject expired token', async () => {
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
      { expiresIn: '0s' }
    );

    mockReq.headers.authorization = `Bearer ${token}`;

    await authenticateUser(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Token expired'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject token with invalid user', async () => {
    const token = jwt.sign(
      { userId: 'nonexistent-id' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    mockReq.headers.authorization = `Bearer ${token}`;

    await authenticateUser(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'User not found'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });
});
