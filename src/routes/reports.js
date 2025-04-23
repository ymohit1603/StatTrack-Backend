const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Generate team performance report
router.get('/team-performance', authenticateUser, async (req, res) => {
  try {
    const { startDate, endDate, projectId } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Date range is required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get team performance metrics
    const teamMetrics = await prisma.$queryRaw`
      WITH daily_stats AS (
        SELECT 
          u.id as user_id,
          u.username,
          DATE(h.timestamp) as date,
          COUNT(*) as Heartbeat_count,
          COUNT(DISTINCT h.entity) as files_modified,
          SUM(h.duration) as coding_seconds
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.timestamp BETWEEN ${start} AND ${end}
          ${projectId ? prisma.sql`AND h.projectId = ${parseInt(projectId)}` : prisma.sql``}
        GROUP BY u.id, u.username, DATE(h.timestamp)
      )
      SELECT 
        user_id,
        username,
        COUNT(DISTINCT date) as active_days,
        ROUND(AVG(coding_seconds)::numeric, 2) as avg_daily_seconds,
        SUM(coding_seconds) as total_seconds,
        SUM(files_modified) as total_files_modified,
        ROUND(AVG(Heartbeat_count)::numeric, 2) as avg_daily_activity
      FROM daily_stats
      GROUP BY user_id, username
      ORDER BY total_seconds DESC
    `;

    // Get project progress metrics
    const projectMetrics = await prisma.$queryRaw`
      WITH weekly_stats AS (
        SELECT 
          DATE_TRUNC('week', h.timestamp) as week,
          COUNT(DISTINCT h.entity) as files_changed,
          COUNT(DISTINCT h.userId) as active_users,
          SUM(h.duration) as total_seconds
        FROM Heartbeat h
        WHERE h.timestamp BETWEEN ${start} AND ${end}
          ${projectId ? prisma.sql`AND h.projectId = ${parseInt(projectId)}` : prisma.sql``}
        GROUP BY DATE_TRUNC('week', h.timestamp)
      )
      SELECT 
        week,
        files_changed,
        active_users,
        total_seconds,
        ROUND(
          (total_seconds::float / LAG(total_seconds) OVER (ORDER BY week) - 1) * 100,
          2
        ) as growth_rate
      FROM weekly_stats
      ORDER BY week
    `;

    // Get code quality metrics
    const codeQualityMetrics = await prisma.$queryRaw`
      SELECT 
        h.language,
        COUNT(DISTINCT h.entity) as file_count,
        ROUND(AVG(h.lines)::numeric, 2) as avg_file_size,
        COUNT(DISTINCT h.userId) as contributors,
        SUM(h.duration) as total_seconds
      FROM Heartbeat h
      WHERE h.timestamp BETWEEN ${start} AND ${end}
        ${projectId ? prisma.sql`AND h.projectId = ${parseInt(projectId)}` : prisma.sql``}
      GROUP BY h.language
      HAVING COUNT(DISTINCT h.entity) > 5
      ORDER BY total_seconds DESC
    `;

    res.json({
      data: {
        report_period: {
          start: start.toISOString(),
          end: end.toISOString(),
          total_days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
        },
        team_performance: {
          members: teamMetrics,
          summary: {
            total_active_users: teamMetrics.length,
            total_coding_hours: Math.round(
              teamMetrics.reduce((sum, m) => sum + m.total_seconds, 0) / 3600
            ),
            avg_daily_hours_per_user: Math.round(
              teamMetrics.reduce((sum, m) => sum + m.avg_daily_seconds, 0) / 
              teamMetrics.length / 3600 * 100
            ) / 100
          }
        },
        project_progress: {
          weekly_metrics: projectMetrics,
          trend_analysis: {
            growth_trend: projectMetrics
              .filter(m => m.growth_rate)
              .reduce((sum, m) => sum + m.growth_rate, 0) / 
              projectMetrics.filter(m => m.growth_rate).length,
            peak_week: projectMetrics.reduce(
              (max, m) => m.total_seconds > max.total_seconds ? m : max,
              projectMetrics[0]
            )
          }
        },
        code_quality: {
          language_metrics: codeQualityMetrics,
          concerns: codeQualityMetrics
            .filter(m => m.avg_file_size > 500 || m.contributors < 2)
            .map(m => ({
              language: m.language,
              issue: m.avg_file_size > 500 ? 'High average file size' : 'Limited code review coverage',
              recommendation: m.avg_file_size > 500 
                ? 'Consider breaking down large files'
                : 'Increase code review participation'
            }))
        }
      }
    });
  } catch (error) {
    logger.error('Error generating team performance report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate productivity report
router.get('/productivity', authenticateUser, async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Date range is required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const targetUserId = userId ? parseInt(userId) : req.user.id;

    // Get daily productivity metrics
    const dailyMetrics = await prisma.$queryRaw`
      WITH daily_stats AS (
        SELECT 
          DATE(timestamp) as date,
          SUM(duration) as total_seconds,
          COUNT(DISTINCT entity) as files_modified,
          COUNT(*) as activity_count
        FROM Heartbeat
        WHERE userId = ${targetUserId}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp)
      )
      SELECT 
        date,
        total_seconds,
        files_modified,
        activity_count,
        ROUND(
          (total_seconds::float / LAG(total_seconds) OVER (ORDER BY date) - 1) * 100,
          2
        ) as day_over_day_change
      FROM daily_stats
      ORDER BY date
    `;

    // Get focus metrics
    const focusMetrics = await prisma.$queryRaw`
      WITH session_gaps AS (
        SELECT 
          timestamp,
          duration,
          EXTRACT(EPOCH FROM (
            timestamp - LAG(timestamp) OVER (ORDER BY timestamp)
          )) as gap_seconds
        FROM Heartbeat
        WHERE userId = ${targetUserId}
          AND timestamp BETWEEN ${start} AND ${end}
      )
      SELECT 
        COUNT(*) as total_sessions,
        ROUND(AVG(duration)::numeric, 2) as avg_session_duration,
        ROUND(AVG(CASE WHEN gap_seconds <= 300 THEN duration ELSE 0 END)::numeric, 2) as avg_focused_duration,
        COUNT(CASE WHEN gap_seconds <= 300 THEN 1 END) as focused_sessions
      FROM session_gaps
    `;

    // Get language proficiency growth
    const skillGrowth = await prisma.$queryRaw`
      WITH monthly_stats AS (
        SELECT 
          language,
          DATE_TRUNC('month', timestamp) as month,
          SUM(duration) as monthly_seconds,
          COUNT(DISTINCT entity) as files_touched
        FROM Heartbeat
        WHERE userId = ${targetUserId}
          AND timestamp BETWEEN ${start} AND ${end}
          AND language IS NOT NULL
        GROUP BY language, DATE_TRUNC('month', timestamp)
      )
      SELECT 
        language,
        COUNT(DISTINCT month) as active_months,
        ROUND(AVG(monthly_seconds)::numeric, 2) as avg_monthly_seconds,
        SUM(files_touched) as total_files,
        ROUND(
          (LAST_VALUE(monthly_seconds) OVER (
            PARTITION BY language ORDER BY month
          ) - FIRST_VALUE(monthly_seconds) OVER (
            PARTITION BY language ORDER BY month
          ))::numeric / NULLIF(FIRST_VALUE(monthly_seconds) OVER (
            PARTITION BY language ORDER BY month
          ), 0) * 100,
          2
        ) as growth_percentage
      FROM monthly_stats
      GROUP BY language
      HAVING COUNT(DISTINCT month) > 1
      ORDER BY avg_monthly_seconds DESC
    `;

    res.json({
      data: {
        report_period: {
          start: start.toISOString(),
          end: end.toISOString(),
          total_days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
        },
        productivity_metrics: {
          daily_stats: dailyMetrics,
          summary: {
            total_coding_hours: Math.round(
              dailyMetrics.reduce((sum, d) => sum + d.total_seconds, 0) / 3600
            ),
            avg_daily_hours: Math.round(
              dailyMetrics.reduce((sum, d) => sum + d.total_seconds, 0) / 
              dailyMetrics.length / 3600 * 100
            ) / 100,
            total_files_modified: dailyMetrics.reduce((sum, d) => sum + d.files_modified, 0)
          },
          trends: {
            most_productive_day: dailyMetrics.reduce(
              (max, d) => d.total_seconds > max.total_seconds ? d : max,
              dailyMetrics[0]
            ),
            avg_day_over_day_change: Math.round(
              dailyMetrics
                .filter(d => d.day_over_day_change)
                .reduce((sum, d) => sum + d.day_over_day_change, 0) /
              dailyMetrics.filter(d => d.day_over_day_change).length * 100
            ) / 100
          }
        },
        focus_metrics: {
          ...focusMetrics,
          focus_score: Math.round(
            (focusMetrics.focused_sessions / focusMetrics.total_sessions) * 100
          ),
          improvement_potential: Math.round(
            ((1 - focusMetrics.focused_sessions / focusMetrics.total_sessions) * 100) * 100
          ) / 100
        },
        skill_development: {
          language_growth: skillGrowth,
          recommendations: skillGrowth
            .filter(s => s.growth_percentage < 10)
            .map(s => ({
              language: s.language,
              current_hours: Math.round(s.avg_monthly_seconds / 3600),
              recommended_hours: Math.round(s.avg_monthly_seconds / 3600 * 1.5),
              reason: 'Low growth rate'
            }))
        }
      }
    });
  } catch (error) {
    logger.error('Error generating productivity report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate cost allocation report
router.get('/cost-allocation', authenticateUser, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Date range is required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get project cost metrics
    const projectCosts = await prisma.$queryRaw`
      WITH project_time AS (
        SELECT 
          p.id,
          p.name,
          COUNT(DISTINCT h.userId) as team_size,
          SUM(h.duration) as total_seconds
        FROM Project p
        JOIN Heartbeat h ON h.projectId = p.id
        WHERE h.timestamp BETWEEN ${start} AND ${end}
        GROUP BY p.id, p.name
      )
      SELECT 
        id,
        name,
        team_size,
        total_seconds,
        ROUND(
          (total_seconds::float / (
            SELECT SUM(total_seconds) FROM project_time
          ) * 100)::numeric,
          2
        ) as time_percentage
      FROM project_time
      ORDER BY total_seconds DESC
    `;

    // Get resource allocation metrics
    const resourceAllocation = await prisma.$queryRaw`
      SELECT 
        u.username,
        p.name as project_name,
        COUNT(DISTINCT DATE(h.timestamp)) as days_allocated,
        SUM(h.duration) as total_seconds,
        ROUND(
          (SUM(h.duration)::float / (
            SELECT SUM(duration)
            FROM Heartbeat
            WHERE timestamp BETWEEN ${start} AND ${end}
              AND userId = u.id
          ) * 100)::numeric,
          2
        ) as allocation_percentage
      FROM "User" u
      JOIN Heartbeat h ON h.userId = u.id
      JOIN Project p ON h.projectId = p.id
      WHERE h.timestamp BETWEEN ${start} AND ${end}
      GROUP BY u.username, p.name, u.id
      ORDER BY u.username, total_seconds DESC
    `;

    res.json({
      data: {
        report_period: {
          start: start.toISOString(),
          end: end.toISOString(),
          total_days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
        },
        project_costs: {
          projects: projectCosts,
          summary: {
            total_development_hours: Math.round(
              projectCosts.reduce((sum, p) => sum + p.total_seconds, 0) / 3600
            ),
            avg_team_size: Math.round(
              projectCosts.reduce((sum, p) => sum + p.team_size, 0) / 
              projectCosts.length * 100
            ) / 100
          },
          cost_distribution: projectCosts.map(p => ({
            project: p.name,
            cost_percentage: p.time_percentage,
            team_cost: p.team_size * (p.total_seconds / 3600) * 50 // Assuming $50/hour average rate
          }))
        },
        resource_allocation: {
          allocations: resourceAllocation,
          efficiency_metrics: {
            optimal_allocation_threshold: 70, // 70% allocation is considered optimal
            overallocated_resources: resourceAllocation
              .filter(r => r.allocation_percentage > 70)
              .map(r => ({
                username: r.username,
                project: r.project_name,
                allocation: r.allocation_percentage,
                recommendation: 'Consider redistributing workload'
              })),
            underutilized_resources: resourceAllocation
              .filter(r => r.allocation_percentage < 30)
              .map(r => ({
                username: r.username,
                project: r.project_name,
                allocation: r.allocation_percentage,
                recommendation: 'Increase project involvement'
              }))
          }
        }
      }
    });
  } catch (error) {
    logger.error('Error generating cost allocation report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 