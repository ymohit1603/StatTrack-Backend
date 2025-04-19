const { prisma } = require('../config/db');
const jwt = require('jsonwebtoken');

async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    const apiKey = await prisma.apiKey.findUnique({
      where: { key: token },
      include: { user: true }
    });

    if (apiKey) {
      req.user = apiKey.user;
      return next();
    }

    try {
      console.log(token);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("decoded id", decoded.userId);
      console.log('Decoded JWT Payload:', decoded);
      console.log(process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = { authenticateUser };
