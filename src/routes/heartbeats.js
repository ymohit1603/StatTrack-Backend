const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');
const { processHeartbeats } = require('../workers/heartbeatWorker');
const { checkApiLimit, checkStorageLimit } = require('../middleware/tierLimits');
const os = require('os');
const { validateSessionKey } = require('../utils/session');
const NodeCache = require('node-cache');
const sessionKeyCache = new NodeCache({ stdTTL: 3600 }); 
// Create Heartbeat(s)
router.post('/', async (req, res) => {
  // console.log("req",req.body);
  const baseEncodedsessionKey = req.headers.authorization.split(' ')[1];
  const buffer = Buffer.from(baseEncodedsessionKey, 'base64');
const sessionKey = buffer.toString('utf-8');
  console.log("sessionKey",sessionKey);

  let userId = sessionKeyCache.get(sessionKey);
  console.log("userId",userId);
  if (!userId) {
    // Validate session key and get userId
    userId = validateSessionKey(sessionKey);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Cache the validated session key
    sessionKeyCache.set(sessionKey, userId);
    
  }
  req.body[0].userId = userId ;
  console.log("req.body",req.body);


  
   
   



 
  try {
    let Heartbeats = Array.isArray(req.body) ? req.body : [req.body];
    

    
    

    if (Heartbeats.length === 0) {
      return res.status(400).json({ error: 'Invalid Heartbeat data' });
    }


    // Track premium features usage
    // const redis = req.app.get('redis');
    // const today = new Date().toISOString().split('T')[0];
    // await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'api_requests', 1);
    
    // Check for premium features in Heartbeats
    // const hasPremiumFeatures = transformedHeartbeats.some(hb => 
    //   hb.dependencies?.length > 0 || 
    //   hb.lines > 1000 ||
    //   hb.category === 'debugging'
    // );

    // if (hasPremiumFeatures) {
    //   await redis.hincrby(`user:${req.user.id}:usage:${today}`, 'premium_features', 1);
    // }

    // Process Heartbeats directly

    const result = await processHeartbeats(req.body);
    console.log("Processing complete, returning response");
    console.log("result",result);
    // Send response in the specified format
    return result;
  } catch (error) {
    logger.error('Error processing Heartbeats:', error);
    res.status(500).json({ error: 'Error processing Heartbeats' });
  }
});

// user's Heartbeat sent from  cli for the given day as an array
// date - Date - required - Requested day; Heartbeats will be returned from 12am until 11:59pm in user's timezone for this day.


router.get('/', /* authenticateUser ,*/ async (req, res) => {

});

module.exports = router;