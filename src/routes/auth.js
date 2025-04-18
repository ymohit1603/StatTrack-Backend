const express = require('express');
const router = express.Router();
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const jwt = require('jsonwebtoken');
const { jwtDecode } = require('jwt-decode');
const logger = require('../utils/logger');
const { prisma, redis } = require('../config/db');

const USER_CACHE_TTL = 3600;
const TOKEN_CACHE_TTL = 86400;

// --------------------- TWITTER STRATEGY ---------------------
passport.use(new TwitterStrategy({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    callbackURL: `${process.env.API_URL}/api/v1/auth/twitter/callback`
  },
  async (token, tokenSecret, profile, done) => {
    try {
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
      } else if (user.app_name !== 'X') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { app_name: 'X' }
        });
      }

      done(null, user);
    } catch (error) {
      logger.error('Twitter auth error:', error);
      done(error, null);
    }
  }
));

// --------------------- LINKEDIN OPENID STRATEGY ---------------------
const linkedInStrategy = new LinkedInStrategy({
  clientID: process.env.LINKEDIN_CLIENT_ID,
  clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  callbackURL: `${process.env.API_URL}/api/v1/auth/linkedin/callback`,
  scope: ['openid', 'profile', 'email'],
  state: true,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, params, profile, done) => {
  try {
    const decodedIdToken = jwtDecode(params.id_token);
    console.log(decodedIdToken);
    const email = decodedIdToken.email;
    const fullName = decodedIdToken.name;
    const profilePicture = decodedIdToken.picture || null;

    let user = await prisma.user.findFirst({
      where: { linkedinId: decodedIdToken.sub }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: fullName.replace(/\s+/g, '').toLowerCase(),
          email,
          linkedinId: decodedIdToken.sub,
          profile_url: profilePicture,
          app_name: 'LinkedIn',
          isPrivate: false
        }
      });
    } else if (user.app_name !== 'LinkedIn') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { app_name: 'LinkedIn' }
      });
    }

    done(null, user);
  } catch (error) {
    logger.error('LinkedIn OpenID auth error:', error);
    done(error, null);
  }
});

// 🛠️ override userProfile to skip the default fetch
linkedInStrategy.userProfile = function (accessToken, done) {
  return done(null, {}); // skip the call to /v2/me
};

passport.use(linkedInStrategy);

// --------------------- SESSION SERIALIZATION ---------------------
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// --------------------- AUTH ROUTES ---------------------
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

      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
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

      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
    } catch (error) {
      logger.error('LinkedIn callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/auth-error`);
    }
  }
);

router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    // const cachedUserId = await redis.get(`token:${token}`);
    // if (!cachedUserId) return res.status(401).json({ error: 'Invalid token' });

    // const cachedUser = await redis.get(`user:${cachedUserId}`);
    // if (cachedUser) return res.json({ data: JSON.parse(cachedUser) });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        twitterId: true,
        linkedinId: true,
        profile_url: true,
        app_name: true,
        website: true,
        github_username: true,
        twitter_username: true,
        linkedin_username: true,
        address: true,
        isPrivate: true,
        editors_used_public: true,
        categories_used_public: true,
        os_used_public: true,
        logged_time_public: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        subscriptionTier: true,
        subscriptionStart: true,
        subscriptionEnd: true,
        billingInterval: true
      }
    });

    if (!user) return res.status(401).json({ error: 'User not found' });

    // await redis.set(
    //   `user:${user.id}`,
    //   JSON.stringify(user),
    //   'EX',
    //   USER_CACHE_TTL
    // );

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
