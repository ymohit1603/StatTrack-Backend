const express = require('express');
const router = express.Router();
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { prisma, redis } = require('../config/db');

const USER_CACHE_TTL = 3600;
const TOKEN_CACHE_TTL = 86400;

passport.use(new TwitterStrategy({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    callbackURL: `${process.env.API_URL}/api/v1/auth/twitter/callback`
  },
  async (token, tokenSecret, profile, done) => {
    try {
      const cachedUser = await redis.get(`user:twitter:${profile.id}`);
      if (cachedUser) {
        return done(null, JSON.parse(cachedUser));
      }

      let user = await prisma.user.findFirst({
        where: { twitterId: profile.id }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            username: profile.username,
            email: profile.emails?.[0]?.value || `${profile.username}@twitter.com`,
            twitterId: profile.id,
            profile_url: profile.photos?.[0]?.value,
            app_name: 'X',
            isPrivate: false
          }
        });
      } else {
        if (user.app_name !== 'X') {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { app_name: 'X' }
          });
        }
      }

      await redis.set(
        `user:twitter:${profile.id}`,
        JSON.stringify(user),
        'EX',
        USER_CACHE_TTL
      );

      done(null, user);
    } catch (error) {
      logger.error('Twitter auth error:', error);
      done(error, null);
    }
  }
));

passport.use(new LinkedInStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: `${process.env.API_URL}/api/v1/auth/linkedin/callback`,
    scope: ['r_emailaddress', 'r_liteprofile']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const cachedUser = await redis.get(`user:linkedin:${profile.id}`);
      if (cachedUser) {
        return done(null, JSON.parse(cachedUser));
      }

      let user = await prisma.user.findFirst({
        where: { linkedinId: profile.id }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            username: profile.displayName.replace(/\s+/g, '').toLowerCase(),
            email: profile.emails[0].value,
            linkedinId: profile.id,
            profile_url: profile.photos?.[0]?.value,
            app_name: 'LinkedIn',
            isPrivate: false
          }
        });
      } else {
        if (user.app_name !== 'LinkedIn') {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { app_name: 'LinkedIn' }
          });
        }
      }

      await redis.set(
        `user:linkedin:${profile.id}`,
        JSON.stringify(user),
        'EX',
        USER_CACHE_TTL
      );

      done(null, user);
    } catch (error) {
      logger.error('LinkedIn auth error:', error);
      done(error, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id }
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

router.get('/twitter', passport.authenticate('twitter'));

router.get('/twitter/callback',
  passport.authenticate('twitter', { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { userId: req.user.id },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      await redis.set(
        `token:${token}`,
        req.user.id,
        'EX',
        TOKEN_CACHE_TTL
      );

      res.redirect(`${process.env.FRONTEND_URL}/auth-callback?token=${token}`);
    } catch (error) {
      logger.error('Twitter callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/auth-error`);
    }
  }
);

router.get('/linkedin', passport.authenticate('linkedin'));

router.get('/linkedin/callback',
  passport.authenticate('linkedin', { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { userId: req.user.id },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      await redis.set(
        `token:${token}`,
        req.user.id,
        'EX',
        TOKEN_CACHE_TTL
      );

      res.redirect(`${process.env.FRONTEND_URL}/auth-callback?token=${token}`);
    } catch (error) {
      logger.error('LinkedIn callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/auth-error`);
    }
  }
);

router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const cachedUserId = await redis.get(`token:${token}`);
    if (!cachedUserId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const cachedUser = await redis.get(`user:${cachedUserId}`);
    if (cachedUser) {
      return res.json({ data: JSON.parse(cachedUser) });
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(cachedUserId) },
      select: {
        id: true,
        username: true,
        email: true,
        profile_url: true,
        isPrivate: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    await redis.set(
      `user:${user.id}`,
      JSON.stringify(user),
      'EX',
      USER_CACHE_TTL
    );

    res.json({ data: user });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await redis.del(`token:${token}`);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;