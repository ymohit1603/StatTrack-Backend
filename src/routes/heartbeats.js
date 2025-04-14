const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { processHeartbeats } = require('../workers/heartbeatWorker');
const { checkApiLimit, checkStorageLimit } = require('../middleware/tierLimits');
const os = require('os');

// Create heartbeat(s)
router.post('/', async (req, res) => {
  console.log("req",req.body);
  console.log(req.user);
  try {
    let heartbeats = Array.isArray(req.body) ? req.body : [req.body];
    
    

    if (heartbeats.length === 0) {
      return res.status(400).json({ error: 'Invalid heartbeat data' });
    }


    // Track premium features usage
    // const redis = req.app.get('redis');
    // const today = new Date().toISOString().split('T')[0];
    // await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'api_requests', 1);
    
    // Check for premium features in heartbeats
    // const hasPremiumFeatures = transformedHeartbeats.some(hb => 
    //   hb.dependencies?.length > 0 || 
    //   hb.lines > 1000 ||
    //   hb.category === 'debugging'
    // );

    // if (hasPremiumFeatures) {
    //   await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'premium_features', 1);
    // }

    // Process heartbeats directly
    const processedCount = await processHeartbeats(req.body);

    res.json({
      status: 'success',
      message: `Processed ${processedCount} heartbeats`
    });
  } catch (error) {
    logger.error('Error processing heartbeats:', error);
    res.status(500).json({ error: 'Error processing heartbeats' });
  }
});

// user's heartbeat sent from  cli for the given day as an array
// date - Date - required - Requested day; Heartbeats will be returned from 12am until 11:59pm in user's timezone for this day.


router.get('/', /* authenticateUser ,*/ async (req, res) => {

});

module.exports = router;