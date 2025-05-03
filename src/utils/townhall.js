const { PrismaClient } = require('@prisma/client');
const NodeCache = require('node-cache');

const prisma = new PrismaClient();
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

const TOWNHALL_LEVELS = [
  { level: 1, minHours: 0 },
  { level: 2, minHours: 600 },
  { level: 3, minHours: 1800 },
  { level: 4, minHours: 3200 },
  { level: 5, minHours: 4800 },
  { level: 6, minHours: 6600 },
  { level: 7, minHours: 8600 },
  { level: 8, minHours: 12000 },
  { level: 9, minHours: 15000 },
  { level: 10, minHours: 19000 },
  {level:10,minHours:24000}
];

/**
 * Calculate townhall level and progress for a user
 * @param {number} userId - The user's ID
 * @returns {Promise<{level: number, hoursCoded: number, nextLevelMinHours: number, hoursToNext: number}>}
 */
async function getTownhallForUser(userId) {
  const cacheKey = `townhall:${userId}`;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Get total coding duration in seconds
    const result = await prisma.dailySummary.aggregate({
      where: { userId },
      _sum: {
        totalDuration: true
      }
    });

    // Convert seconds to hours
    const totalSeconds = result._sum.totalDuration || 0;
    const hoursCoded = totalSeconds / 3600;

    // Find current level and next level
    let currentLevel = TOWNHALL_LEVELS[0];
    let nextLevel = TOWNHALL_LEVELS[1];

    for (let i = 0; i < TOWNHALL_LEVELS.length; i++) {
      if (hoursCoded >= TOWNHALL_LEVELS[i].minHours) {
        currentLevel = TOWNHALL_LEVELS[i];
        nextLevel = TOWNHALL_LEVELS[i + 1] || currentLevel;
      } else {
        break;
      }
    }

    const response = {
      level: currentLevel.level,
      hoursCoded: Number(hoursCoded.toFixed(1)),
      nextLevelMinHours: nextLevel.minHours,
      hoursToNext: Number((nextLevel.minHours - hoursCoded).toFixed(1))
    };

    // Cache the result
    cache.set(cacheKey, response);
    
    return response;
  } catch (error) {
    // If there's an error, return level 1 with zero hours
    return {
      level: 1,
      hoursCoded: 0,
      nextLevelMinHours: TOWNHALL_LEVELS[1].minHours,
      hoursToNext: TOWNHALL_LEVELS[1].minHours
    };
  }
}

module.exports = {
  getTownhallForUser,
  TOWNHALL_LEVELS
}; 