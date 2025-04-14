const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

router.get('/predictions/productivity', authenticateUser, async (req, res) => {
  
  
  try {
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

    const predictions = {
      optimal_coding_times: analyzeOptimalCodingTimes(historicalData),
      productivity_forecast: generateProductivityForecast(historicalData),
      burnout_risk: assessBurnoutRisk(historicalData),
      skill_development_trajectory: predictSkillGrowth(historicalData)
    };

    res.json({ data: predictions });
  } catch (error) {
    logger.error('Error generating productivity predictions:', error);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});

router.get('/predictions/projects', authenticateUser, async (req, res) => {
  try {
    const projectMetrics = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.name,
        COUNT(DISTINCT h.entity) as files_modified,
        COUNT(DISTINCT h.branch) as branches,
        COUNT(DISTINCT h.language) as languages,
        AVG(h.lines) as avg_lines_per_file,
        MAX(h.lines) as max_lines,
        COUNT(DISTINCT h.userId) as contributors,
        SUM(h.duration) as total_time
      FROM Project p
      LEFT JOIN Heartbeat h ON h.projectId = p.id
      WHERE p.userId = ${req.user.id}
        AND h.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY p.id, p.name
    `;

    const projectPredictions = projectMetrics.map(metrics => ({
      project_id: metrics.id,
      project_name: metrics.name,
      complexity_score: analyzeCodeComplexity(metrics),
      refactoring_needs: identifyRefactoringNeeds(metrics),
      team_composition: analyzeTeamComposition(metrics),
      success_probability: calculateProjectSuccessProbability(metrics)
    }));

    res.json({ data: projectPredictions });
  } catch (error) {
    logger.error('Error generating project predictions:', error);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});

function analyzeOptimalCodingTimes(data) {
  const timeAnalysis = data.reduce((acc, entry) => {
    const key = `${entry.day_of_week}-${entry.time_category}`;
    if (!acc[key]) {
      acc[key] = {
        activity_count: 0,
        total_seconds: 0,
        files_modified: 0,
        count: 0
      };
    }
    acc[key].activity_count += entry.activity_count;
    acc[key].total_seconds += entry.total_seconds;
    acc[key].files_modified += entry.files_modified;
    acc[key].count += 1;
    return acc;
  }, {});

  return Object.entries(timeAnalysis)
    .map(([key, stats]) => ({
      time_slot: key,
      productivity_score: (stats.activity_count / stats.count) * 
        (stats.files_modified / stats.count) * 
        (stats.total_seconds / stats.count)
    }))
    .sort((a, b) => b.productivity_score - a.productivity_score);
}

function generateProductivityForecast(data) {
  const recentTrend = data.slice(-7).reduce((acc, day) => {
    acc.activity += day.activity_count;
    acc.duration += day.total_seconds;
    acc.files += day.files_modified;
    return acc;
  }, { activity: 0, duration: 0, files: 0 });

  return {
    expected_activity: recentTrend.activity / 7,
    expected_duration: recentTrend.duration / 7,
    expected_files: recentTrend.files / 7
  };
}

function assessBurnoutRisk(data) {
  const workPatterns = data.reduce((acc, entry) => {
    if (entry.time_category === 'evening' || entry.time_category === 'early_morning') {
      acc.offHoursWork += entry.total_seconds;
    }
    acc.totalWork += entry.total_seconds;
    return acc;
  }, { offHoursWork: 0, totalWork: 0 });

  const offHoursRatio = workPatterns.offHoursWork / workPatterns.totalWork;
  return {
    risk_level: offHoursRatio > 0.4 ? 'high' : offHoursRatio > 0.2 ? 'medium' : 'low',
    off_hours_ratio: offHoursRatio
  };
}

function predictSkillGrowth(data) {
  const skillMetrics = {
    consistency: calculateConsistency(data),
    complexity: calculateComplexityTrend(data),
    diversity: calculateLanguageDiversity(data)
  };

  return {
    growth_rate: (skillMetrics.consistency + skillMetrics.complexity + skillMetrics.diversity) / 3,
    areas_for_improvement: identifyWeakAreas(skillMetrics)
  };
}

function analyzeCodeComplexity(metrics) {
  const complexityFactors = {
    fileCount: metrics.files_modified,
    avgFileSize: metrics.avg_lines_per_file,
    maxFileSize: metrics.max_lines,
    languageCount: metrics.languages
  };

  return calculateComplexityScore(complexityFactors);
}

function identifyRefactoringNeeds(metrics) {
  const thresholds = {
    files: 100,
    avgLines: 300,
    maxLines: 1000
  };

  return {
    needs_refactoring: metrics.files_modified > thresholds.files ||
                      metrics.avg_lines_per_file > thresholds.avgLines ||
                      metrics.max_lines > thresholds.maxLines,
    reasons: generateRefactoringReasons(metrics, thresholds)
  };
}

function analyzeTeamComposition(data) {
  return {
    team_size: data.contributors,
    contribution_distribution: calculateContributionDistribution(data),
    collaboration_score: calculateCollaborationScore(data)
  };
}

function calculateProjectSuccessProbability(metrics) {
  const factors = {
    team_size: normalizeTeamSize(metrics.contributors),
    codebase_health: calculateCodebaseHealth(metrics),
    development_velocity: calculateVelocity(metrics)
  };

  return calculateSuccessProbability(factors);
}

module.exports = router;