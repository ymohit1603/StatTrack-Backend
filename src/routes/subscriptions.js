const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const { TIER_LIMITS } = require('../middleware/tierLimits');
const { redis } = require('../config/db');

const prisma = new PrismaClient();

const SUBSCRIPTION_TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    features: [
      'Basic coding analytics',
      'Personal dashboard',
      'Up to 3 projects',
      'Community support',
      '14-day history',
      'Basic productivity metrics',
      'Limited API access',
      '1GB storage',
      'Basic project insights'
    ],
    limits: {
      projects: 3,
      historyDays: 14,
      teamMembers: 1,
      aiMinutesPerMonth: 10,
      customReports: false,
      exportData: false,
      storage: '1GB',
      apiRequests: '1,000/day'
    }
  },
  PRO: {
    name: 'Pro',
    price: {
      monthly: 19,
      annual: 190
    },
    features: [
      'Everything in Free',
      'Unlimited projects',
      'Advanced analytics',
      'AI-powered insights',
      'Priority support',
      'API access',
      'Custom reports',
      '180-day history',
      'Data export',
      'Private profile',
      'Productivity scores',
      'Language proficiency tracking',
      'Code quality metrics',
      'Real-time coding alerts',
      'AI code review',
      'Project complexity analysis',
      '10GB storage',
      'Advanced project insights'
    ],
    limits: {
      projects: -1,
      historyDays: 180,
      teamMembers: 1,
      aiMinutesPerMonth: 100,
      customReports: true,
      exportData: true,
      storage: '10GB',
      apiRequests: '10,000/day'
    }
  },
  TEAM: {
    name: 'Team',
    price: {
      monthly: 59,
      annual: 590,
      perUser: 12
    },
    features: [
      'Everything in Pro',
      'Team collaboration',
      'Advanced permissions',
      'Team analytics',
      'Shared dashboards',
      'Priority support',
      '1-year history',
      'Cost allocation reports',
      'Resource optimization',
      'Team leaderboards',
      'Project complexity analysis',
      'Cross-project insights',
      'Team productivity metrics',
      'Code review automation',
      'Advanced security features',
      'Team coding patterns',
      '100GB storage',
      'Custom integrations'
    ],
    limits: {
      projects: -1,
      historyDays: 365,
      teamMembers: 5,
      aiMinutesPerMonth: 500,
      customReports: true,
      exportData: true,
      storage: '100GB',
      apiRequests: '50,000/day'
    }
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price: 'Custom',
    features: [
      'Everything in Team',
      'Unlimited team members',
      'Custom integrations',
      'Dedicated support',
      'SLA guarantee',
      'On-premise option',
      'Unlimited history',
      'Advanced security features',
      'Custom AI models',
      'Audit logs',
      'SSO integration',
      'Custom analytics',
      'Advanced compliance features',
      'Custom data retention',
      'Enterprise API access',
      'Custom SLAs',
      'Unlimited storage',
      'Priority feature development'
    ],
    limits: {
      projects: -1,
      historyDays: -1,
      teamMembers: -1,
      aiMinutesPerMonth: -1,
      customReports: true,
      exportData: true,
      storage: 'Unlimited',
      apiRequests: 'Unlimited'
    }
  }
};

// Get subscription plans
router.get('/plans', async (req, res) => {
  res.json({ data: SUBSCRIPTION_TIERS });
});

// Get current subscription with usage stats
router.get('/current', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        subscriptionTier: true,
        subscriptionStart: true,
        subscriptionEnd: true,
        billingInterval: true,
        teamId: true,
        team: {
          select: {
            subscriptionTier: true,
            subscriptionEnd: true,
            maxMembers: true
          }
        }
      }
    });

    // Get usage statistics
    const today = new Date().toISOString().split('T')[0];
    const usageKeys = [
      `usage:${req.user.id}:apiRequestsPerDay:${today}`,
      `usage:${req.user.id}:aiRequestsPerDay:${today}`
    ];
    
    const [apiRequests, aiRequests] = await Promise.all([
      redis.get(usageKeys[0]),
      redis.get(usageKeys[1])
    ]);

    const projectCount = await prisma.project.count({
      where: { userId: req.user.id }
    });

    const limits = TIER_LIMITS[user.subscriptionTier];
    const subscription = {
      ...user,
      plan: SUBSCRIPTION_TIERS[user.subscriptionTier],
      team_plan: user.team ? SUBSCRIPTION_TIERS[user.team.subscriptionTier] : null,
      usage: {
        api_requests: {
          used: parseInt(apiRequests) || 0,
          limit: limits.apiRequestsPerDay,
          remaining: limits.apiRequestsPerDay === -1 ? -1 : 
            Math.max(0, limits.apiRequestsPerDay - (parseInt(apiRequests) || 0))
        },
        ai_requests: {
          used: parseInt(aiRequests) || 0,
          limit: limits.aiRequestsPerDay,
          remaining: limits.aiRequestsPerDay === -1 ? -1 : 
            Math.max(0, limits.aiRequestsPerDay - (parseInt(aiRequests) || 0))
        },
        projects: {
          used: projectCount,
          limit: limits.projectsLimit,
          remaining: limits.projectsLimit === -1 ? -1 : 
            Math.max(0, limits.projectsLimit - projectCount)
        },
        history_days: {
          limit: limits.historyDays
        },
        team_members: {
          limit: limits.teamMembers
        },
        file_size: {
          limit: limits.maxFileSize
        }
      }
    };

    res.json({ data: subscription });
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create checkout session
router.post('/checkout', authenticateUser, async (req, res) => {
  try {
    const { tier, interval } = req.body;
    
    if (!SUBSCRIPTION_TIERS[tier]) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    const plan = SUBSCRIPTION_TIERS[tier];
    
    // Create or retrieve Stripe customer
    let customer;
    if (req.user.stripeCustomerId) {
      customer = await stripe.customers.retrieve(req.user.stripeCustomerId);
    } else {
      customer = await stripe.customers.create({
        email: req.user.email,
        metadata: {
          userId: req.user.id
        }
      });
      
      await prisma.user.update({
        where: { id: req.user.id },
        data: { stripeCustomerId: customer.id }
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${plan.name} Plan - ${interval}`,
            description: plan.features.join(', ')
          },
          unit_amount: plan.price[interval.toLowerCase()] * 100,
          recurring: {
            interval: interval.toLowerCase()
          }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`
    });

    res.json({ data: { sessionId: session.id } });
  } catch (error) {
    logger.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle webhook events
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      
      case 'customer.subscription.deleted':
        const canceledSubscription = event.data.object;
        await handleSubscriptionCancellation(canceledSubscription);
        break;
      
      case 'invoice.paid':
        const invoice = event.data.object;
        await handleInvoicePaid(invoice);
        break;
      
      case 'invoice.payment_failed':
        const failedInvoice = event.data.object;
        await handleInvoicePaymentFailed(failedInvoice);
        break;
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions for webhook handlers
async function handleSubscriptionUpdate(subscription) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: subscription.customer }
  });

  if (!user) return;

  const tier = subscription.items.data[0].price.nickname.split(' ')[0].toUpperCase();
  
  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionTier: tier,
      subscriptionStart: new Date(subscription.current_period_start * 1000),
      subscriptionEnd: new Date(subscription.current_period_end * 1000),
      billingInterval: subscription.items.data[0].price.recurring.interval.toUpperCase()
    }
  });
}

async function handleSubscriptionCancellation(subscription) {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: subscription.customer }
  });

  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionTier: 'FREE',
      subscriptionEnd: new Date(subscription.current_period_end * 1000)
    }
  });
}

async function handleInvoicePaid(invoice) {
  await prisma.invoice.create({
    data: {
      userId: invoice.customer_id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency,
      status: 'paid',
      stripeId: invoice.id,
      paid_at: new Date()
    }
  });
}

async function handleInvoicePaymentFailed(invoice) {
  await prisma.invoice.create({
    data: {
      userId: invoice.customer_id,
      amount: invoice.amount_due / 100,
      currency: invoice.currency,
      status: 'failed',
      stripeId: invoice.id
    }
  });
}

// Add usage-based pricing endpoint
router.get('/usage-pricing', authenticateUser, async (req, res) => {
  try {
    const { type } = req.query;
    const pricing = {
      ai: {
        base: 100, // minutes included in plan
        overage: 0.05 // price per minute over base
      },
      storage: {
        base: 5, // GB included in plan
        overage: 0.10 // price per GB over base
      },
      api: {
        base: 10000, // requests included in plan
        overage: 0.0001 // price per request over base
      }
    };

    res.json({ data: pricing[type] || pricing });
  } catch (error) {
    logger.error('Error fetching usage pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add team member management endpoints
router.post('/team/members', authenticateUser, async (req, res) => {
  try {
    const { emails } = req.body;
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { team: true }
    });

    if (!user.team || !user.isTeamAdmin) {
      return res.status(403).json({ error: 'Not authorized to manage team' });
    }

    const currentMemberCount = await prisma.user.count({
      where: { teamId: user.team.id }
    });

    if (currentMemberCount + emails.length > user.team.maxMembers) {
      return res.status(400).json({ 
        error: 'Team member limit exceeded',
        current: currentMemberCount,
        limit: user.team.maxMembers,
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    // Send invitations and handle team member addition
    // ... implementation details ...

    res.json({ success: true });
  } catch (error) {
    logger.error('Error managing team members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add subscription analytics endpoint
router.get('/analytics', authenticateUser, async (req, res) => {
  try {
    const { range = '30_days' } = req.query;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case '30_days':
        start.setDate(start.getDate() - 30);
        break;
      case '90_days':
        start.setDate(start.getDate() - 90);
        break;
      case '1_year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }

    const analytics = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('day', timestamp) as date,
        COUNT(DISTINCT userId) as active_users,
        SUM(duration) as total_coding_time,
        COUNT(DISTINCT projectId) as active_projects,
        COUNT(DISTINCT language) as languages_used
      FROM Heartbeat
      WHERE timestamp BETWEEN ${start} AND ${end}
      GROUP BY DATE_TRUNC('day', timestamp)
      ORDER BY date ASC
    `;

    res.json({ data: analytics });
  } catch (error) {
    logger.error('Error fetching subscription analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 