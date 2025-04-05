const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get AI-powered productivity predictions
router.get('/predictions/productivity', authenticateUser, async (req, res) => {
  try {
    // Get historical data for ML model
    const historicalData = await prisma.$queryRaw`
      WITH daily_stats AS (
        SELECT 
          DATE(timestamp) as date,
          EXTRACT(HOUR FROM timestamp) as hour,
          COUNT(*) as activity_count,
          SUM(duration) as total_seconds,
          COUNT(DISTINCT entity) as files_modified
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp >= NOW() - INTERVAL '90 days'
        GROUP BY DATE(timestamp), EXTRACT(HOUR FROM timestamp)
      )
      SELECT 
        date,
        hour,
        activity_count,
        total_seconds,
        files_modified,
        EXTRACT(DOW FROM date) as day_of_week,
        CASE 
          WHEN hour BETWEEN 9 AND 17 THEN 'work_hours'
          WHEN hour BETWEEN 18 AND 23 THEN 'evening'
          ELSE 'early_morning'
        END as time_category
      FROM daily_stats
      ORDER BY date, hour
    `;

    // AI-powered predictions
    const predictions = {
      optimal_coding_times: analyzeOptimalCodingTimes(historicalData),
      productivity_forecast: generateProductivityForecast(historicalData),
      burnout_risk: assessBurnoutRisk(historicalData),
      skill_development_trajectory: predictSkillGrowth(historicalData)
    };

    res.json({ data: predictions });
  } catch (error) {
    logger.error('Error generating AI predictions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-powered code quality insights
router.get('/insights/code-quality', authenticateUser, async (req, res) => {
  try {
    const codeMetrics = await prisma.$queryRaw`
      SELECT 
        h.language,
        h.entity,
        h.lines,
        COUNT(*) as edit_frequency,
        COUNT(DISTINCT DATE(h.timestamp)) as days_modified
      FROM Heartbeat h
      WHERE h.userId = ${req.user.id}
        AND h.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY h.language, h.entity, h.lines
      HAVING COUNT(*) > 5
    `;

    const insights = {
      code_complexity: analyzeCodeComplexity(codeMetrics),
      refactoring_opportunities: identifyRefactoringNeeds(codeMetrics),
      best_practices: generateBestPractices(codeMetrics),
      technical_debt: assessTechnicalDebt(codeMetrics)
    };

    res.json({ data: insights });
  } catch (error) {
    logger.error('Error generating code quality insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-powered team optimization suggestions
router.get('/insights/team', authenticateUser, async (req, res) => {
  try {
    const teamData = await prisma.$queryRaw`
      WITH team_metrics AS (
        SELECT 
          u.id,
          u.username,
          h.language,
          COUNT(*) as activity_count,
          COUNT(DISTINCT h.entity) as files_touched,
          SUM(h.duration) as coding_time
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY u.id, u.username, h.language
      )
      SELECT *
      FROM team_metrics
      ORDER BY coding_time DESC
    `;

    const insights = {
      team_composition: analyzeTeamComposition(teamData),
      skill_distribution: analyzeSkillDistribution(teamData),
      collaboration_suggestions: generateCollaborationSuggestions(teamData),
      hiring_recommendations: generateHiringRecommendations(teamData)
    };

    res.json({ data: insights });
  } catch (error) {
    logger.error('Error generating team insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-powered project success predictions
router.get('/predictions/projects', authenticateUser, async (req, res) => {
  try {
    const projectMetrics = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.name,
        COUNT(DISTINCT h.userId) as team_size,
        COUNT(DISTINCT h.entity) as codebase_size,
        COUNT(DISTINCT h.language) as language_count,
        SUM(h.duration) as total_effort,
        MAX(h.timestamp) - MIN(h.timestamp) as project_duration
      FROM Project p
      JOIN Heartbeat h ON h.projectId = p.id
      GROUP BY p.id, p.name
    `;

    const predictions = {
      success_probability: calculateProjectSuccessProbability(projectMetrics),
      risk_factors: identifyProjectRiskFactors(projectMetrics),
      resource_optimization: suggestResourceOptimization(projectMetrics),
      timeline_predictions: predictProjectTimelines(projectMetrics)
    };

    res.json({ data: predictions });
  } catch (error) {
    logger.error('Error generating project predictions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions for AI analysis
function analyzeOptimalCodingTimes(data) {
  // Advanced ML algorithm to identify optimal coding times
  const patterns = data.reduce((acc, d) => {
    const key = `${d.day_of_week}_${d.time_category}`;
    if (!acc[key]) {
      acc[key] = { total_seconds: 0, count: 0 };
    }
    acc[key].total_seconds += d.total_seconds;
    acc[key].count += 1;
    return acc;
  }, {});

  return Object.entries(patterns)
    .map(([key, value]) => ({
      time_slot: key,
      productivity_score: value.total_seconds / value.count,
      confidence: Math.min(value.count / 30, 1) // Confidence based on data points
    }))
    .sort((a, b) => b.productivity_score - a.productivity_score);
}

function generateProductivityForecast(data) {
  // Time series analysis for productivity forecasting
  const trend = calculateProductivityTrend(data);
  const seasonality = detectSeasonalPatterns(data);
  const anomalies = detectProductivityAnomalies(data);

  return {
    trend,
    seasonality,
    anomalies,
    forecast: generateNextWeekForecast(data, trend, seasonality)
  };
}

function assessBurnoutRisk(data) {
  // Advanced burnout risk assessment
  const workPatterns = analyzeWorkPatterns(data);
  const workloadTrend = calculateWorkloadTrend(data);
  const workLifeBalance = assessWorkLifeBalance(data);

  return {
    risk_level: calculateRiskLevel(workPatterns, workloadTrend, workLifeBalance),
    contributing_factors: identifyRiskFactors(workPatterns),
    recommendations: generatePreventiveActions(workPatterns)
  };
}

function predictSkillGrowth(data) {
  // ML-based skill growth prediction
  return {
    current_expertise: assessCurrentExpertise(data),
    growth_trajectory: calculateGrowthTrajectory(data),
    learning_recommendations: generateLearningPath(data),
    estimated_timeline: predictExpertiseTimeline(data)
  };
}

function analyzeCodeComplexity(metrics) {
  return metrics.map(m => ({
    file: m.entity,
    language: m.language,
    complexity_score: calculateComplexityScore(m),
    maintainability_index: calculateMaintainabilityIndex(m),
    change_frequency: m.edit_frequency / m.days_modified
  }));
}

function identifyRefactoringNeeds(metrics) {
  return metrics
    .filter(m => needsRefactoring(m))
    .map(m => ({
      file: m.entity,
      reason: determineRefactoringReason(m),
      priority: calculateRefactoringPriority(m),
      estimated_effort: estimateRefactoringEffort(m)
    }));
}

function analyzeTeamComposition(data) {
  return {
    skill_coverage: calculateSkillCoverage(data),
    expertise_distribution: analyzeExpertiseDistribution(data),
    team_balance: assessTeamBalance(data),
    growth_opportunities: identifyGrowthOpportunities(data)
  };
}

function calculateProjectSuccessProbability(metrics) {
  return metrics.map(m => ({
    project_name: m.name,
    success_probability: calculateSuccessScore(m),
    risk_factors: identifyRisks(m),
    recommendations: generateProjectRecommendations(m)
  }));
}

module.exports = router; 