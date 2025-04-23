const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get dashboard data
router.get('/dashboard', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_30_days' } = req.query;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        break;
      case 'this_week':
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        break;
      case 'this_month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'last_30_days':
        start.setDate(start.getDate() - 30);
        break;
      case 'last_6_months':
        start.setMonth(start.getMonth() - 6);
        break;
      case 'last_year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range' });
    }

    // Get coding statistics including line counts
    const codingStats = await prisma.$queryRaw`
      WITH daily_stats AS (
        SELECT 
          DATE(timestamp) as date,
          SUM(duration) as total_seconds,
          SUM(lines) as total_lines,
          COUNT(DISTINCT entity) as files_touched,
          COUNT(*) as Heartbeat_count,
          COUNT(DISTINCT CASE WHEN is_write THEN entity END) as files_modified
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp)
      )
      SELECT 
        COUNT(DISTINCT date) as active_days,
        SUM(total_seconds) as total_coding_time,
        SUM(total_lines) as total_lines_written,
        ROUND(AVG(total_lines)::numeric, 2) as avg_lines_per_day,
        MAX(total_lines) as most_lines_in_day,
        SUM(files_touched) as total_files_touched,
        SUM(files_modified) as total_files_modified,
        SUM(Heartbeat_count) as total_Heartbeats,
        json_agg(json_build_object(
          'date', date,
          'coding_time', total_seconds,
          'lines', total_lines,
          'files', files_touched
        ) ORDER BY date) as daily_breakdown
      FROM daily_stats
    `;

    // Get language breakdown with line counts
    const languageStats = await prisma.$queryRaw`
      SELECT 
        language,
        COUNT(DISTINCT DATE(timestamp)) as days_used,
        SUM(duration) as total_seconds,
        SUM(lines) as total_lines,
        COUNT(DISTINCT entity) as unique_files,
        json_agg(json_build_object(
          'date', DATE(timestamp),
          'lines', lines,
          'duration', duration
        )) as timeline
      FROM Heartbeat
      WHERE userId = ${req.user.id}
        AND timestamp BETWEEN ${start} AND ${end}
        AND language IS NOT NULL
      GROUP BY language
      ORDER BY total_seconds DESC
    `;

    // Get project statistics
    const projectStats = await prisma.$queryRaw`
      SELECT 
        p.name as project_name,
        COUNT(DISTINCT DATE(h.timestamp)) as active_days,
        SUM(h.duration) as total_seconds,
        SUM(h.lines) as total_lines,
        COUNT(DISTINCT h.entity) as unique_files,
        MAX(h.lines) as largest_file,
        json_agg(json_build_object(
          'date', DATE(h.timestamp),
          'lines', h.lines,
          'duration', h.duration
        )) as timeline
      FROM Project p
      JOIN Heartbeat h ON h.projectId = p.id
      WHERE h.userId = ${req.user.id}
        AND h.timestamp BETWEEN ${start} AND ${end}
      GROUP BY p.id, p.name
      ORDER BY total_seconds DESC
    `;

    // Get editor usage
    const editorStats = await prisma.$queryRaw`
      SELECT 
        editor,
        COUNT(DISTINCT DATE(timestamp)) as days_used,
        SUM(duration) as total_seconds,
        SUM(lines) as total_lines,
        COUNT(DISTINCT entity) as unique_files
      FROM Heartbeat
      WHERE userId = ${req.user.id}
        AND timestamp BETWEEN ${start} AND ${end}
        AND editor IS NOT NULL
      GROUP BY editor
      ORDER BY total_seconds DESC
    `;

    // Calculate line count trends
    const lineTrends = await prisma.$queryRaw`
      WITH weekly_lines AS (
        SELECT 
          DATE_TRUNC('week', timestamp) as week,
          SUM(lines) as total_lines,
          COUNT(DISTINCT DATE(timestamp)) as active_days
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE_TRUNC('week', timestamp)
      )
      SELECT 
        week,
        total_lines,
        active_days,
        ROUND(
          (total_lines::float - LAG(total_lines) OVER (ORDER BY week)) / 
          NULLIF(LAG(total_lines) OVER (ORDER BY week), 0) * 100,
          2
        ) as growth_percentage
      FROM weekly_lines
      ORDER BY week
    `;

    // Format response
    const dashboardData = {
      summary: {
        ...codingStats[0],
        lines_per_hour: Math.round(codingStats[0].total_lines_written / (codingStats[0].total_coding_time / 3600)),
        avg_session_lines: Math.round(codingStats[0].total_lines_written / codingStats[0].total_Heartbeats)
      },
      time_tracking: {
        range: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        daily_breakdown: codingStats[0].daily_breakdown,
        total_hours: Math.round(codingStats[0].total_coding_time / 3600 * 100) / 100
      },
      lines_of_code: {
        total: codingStats[0].total_lines_written,
        average_per_day: codingStats[0].avg_lines_per_day,
        best_day: codingStats[0].most_lines_in_day,
        by_language: languageStats.map(lang => ({
          language: lang.language,
          lines: lang.total_lines,
          files: lang.unique_files,
          timeline: lang.timeline
        })),
        trends: lineTrends
      },
      projects: projectStats.map(proj => ({
        name: proj.project_name,
        total_lines: proj.total_lines,
        files: proj.unique_files,
        largest_file: proj.largest_file,
        active_days: proj.active_days,
        timeline: proj.timeline
      })),
      languages: languageStats.map(lang => ({
        name: lang.language,
        days_used: lang.days_used,
        total_time: lang.total_seconds,
        total_lines: lang.total_lines,
        files: lang.unique_files,
        percentage: Math.round(lang.total_seconds / codingStats[0].total_coding_time * 100)
      })),
      editors: editorStats.map(editor => ({
        name: editor.editor,
        days_used: editor.days_used,
        total_time: editor.total_seconds,
        total_lines: editor.total_lines,
        files: editor.unique_files,
        percentage: Math.round(editor.total_seconds / codingStats[0].total_coding_time * 100)
      }))
    };

    // Add comparative statistics
    if (range !== 'today') {
      const previousPeriodStart = new Date(start);
      const previousPeriodEnd = new Date(start);
      
      const [previousStats] = await prisma.$queryRaw`
        SELECT 
          SUM(duration) as total_seconds,
          SUM(lines) as total_lines,
          COUNT(DISTINCT DATE(timestamp)) as active_days
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${previousPeriodStart} AND ${previousPeriodEnd}
      `;

      if (previousStats.total_lines) {
        dashboardData.comparison = {
          lines_change_percentage: Math.round(
            (codingStats[0].total_lines_written - previousStats.total_lines) / 
            previousStats.total_lines * 100
          ),
          time_change_percentage: Math.round(
            (codingStats[0].total_coding_time - previousStats.total_seconds) / 
            previousStats.total_seconds * 100
          ),
          activity_change_percentage: Math.round(
            (codingStats[0].active_days - previousStats.active_days) / 
            previousStats.active_days * 100
          )
        };
      }
    }

    res.json({ data: dashboardData });
  } catch (error) {
    logger.error('Error generating dashboard data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get productivity insights
router.get('/productivity', authenticateUser, async (req, res) => {
  try {
    const { range = 'last_30_days' } = req.query;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case 'last_7_days':
        start.setDate(start.getDate() - 7);
        break;
      case 'last_30_days':
        start.setDate(start.getDate() - 30);
        break;
      case 'last_6_months':
        start.setMonth(start.getMonth() - 6);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range' });
    }

    // Get hourly productivity patterns
    const hourlyPatterns = await prisma.$queryRaw`
      WITH hourly_stats AS (
        SELECT 
          EXTRACT(HOUR FROM timestamp) as hour,
          AVG(duration) as avg_duration,
          COUNT(*) as Heartbeat_count
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY EXTRACT(HOUR FROM timestamp)
      )
      SELECT 
        hour,
        avg_duration,
        Heartbeat_count,
        CASE 
          WHEN avg_duration > (SELECT AVG(avg_duration) + STDDEV(avg_duration) FROM hourly_stats) THEN 'peak'
          WHEN avg_duration < (SELECT AVG(avg_duration) - STDDEV(avg_duration) FROM hourly_stats) THEN 'low'
          ELSE 'average'
        END as productivity_level
      FROM hourly_stats
      ORDER BY hour
    `;

    // Get project complexity metrics
    const projectComplexity = await prisma.$queryRaw`
      SELECT 
        p.name as project_name,
        COUNT(DISTINCT h.language) as language_count,
        COUNT(DISTINCT DATE(h.timestamp)) as active_days,
        SUM(h.duration) as total_seconds,
        AVG(h.lines) as avg_file_size,
        COUNT(DISTINCT h.entity) as total_files
      FROM Project p
      JOIN Heartbeat h ON h.projectId = p.id
      WHERE h.userId = ${req.user.id}
        AND h.timestamp BETWEEN ${start} AND ${end}
      GROUP BY p.id, p.name
      HAVING COUNT(DISTINCT h.entity) > 10
      ORDER BY total_seconds DESC
    `;

    // Get language proficiency growth
    const languageGrowth = await prisma.$queryRaw`
      WITH weekly_stats AS (
        SELECT 
          language,
          DATE_TRUNC('week', timestamp) as week,
          SUM(duration) as duration,
          COUNT(DISTINCT entity) as files_touched
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY language, DATE_TRUNC('week', timestamp)
      )
      SELECT 
        language,
        COUNT(DISTINCT week) as weeks_active,
        AVG(duration) as avg_weekly_seconds,
        SUM(files_touched) as total_files,
        CASE 
          WHEN COUNT(DISTINCT week) >= 4 AND AVG(duration) > 3600 THEN 'expert'
          WHEN COUNT(DISTINCT week) >= 2 AND AVG(duration) > 1800 THEN 'proficient'
          ELSE 'learning'
        END as proficiency_level
      FROM weekly_stats
      GROUP BY language
      HAVING COUNT(DISTINCT week) > 0
      ORDER BY avg_weekly_seconds DESC
    `;

    // Get collaboration patterns
    const collaborationPatterns = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('hour', timestamp) as time_block,
        COUNT(DISTINCT userId) as active_users,
        STRING_AGG(DISTINCT branch, ', ') as active_branches,
        COUNT(DISTINCT entity) as files_changed
      FROM Heartbeat
      WHERE projectId IN (
        SELECT projectId 
        FROM Heartbeat 
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
      )
      AND timestamp BETWEEN ${start} AND ${end}
      GROUP BY DATE_TRUNC('hour', timestamp)
      HAVING COUNT(DISTINCT userId) > 1
      ORDER BY time_block DESC
    `;

    res.json({
      data: {
        productivity_patterns: {
          hourly: hourlyPatterns,
          peak_productivity_hours: hourlyPatterns
            .filter(h => h.productivity_level === 'peak')
            .map(h => h.hour),
          recommended_focus_times: hourlyPatterns
            .filter(h => h.productivity_level === 'peak' && h.Heartbeat_count > 100)
            .map(h => h.hour)
        },
        project_insights: {
          complexity_metrics: projectComplexity,
          recommended_reviews: projectComplexity
            .filter(p => p.avg_file_size > 500 || p.language_count > 3)
            .map(p => ({
              project: p.project_name,
              reason: p.avg_file_size > 500 ? 'Large file sizes' : 'Multiple languages'
            }))
        },
        skill_development: {
          language_proficiency: languageGrowth,
          recommendations: languageGrowth
            .filter(l => l.proficiency_level === 'learning')
            .map(l => ({
              language: l.language,
              suggested_hours: Math.ceil((3600 - l.avg_weekly_seconds) / 3600)
            }))
        },
        collaboration_insights: {
          patterns: collaborationPatterns,
          peak_collaboration_times: collaborationPatterns
            .filter(c => c.active_users > 2)
            .map(c => ({
              time: c.time_block,
              active_users: c.active_users,
              branches: c.active_branches
            }))
        }
      }
    });
  } catch (error) {
    logger.error('Error generating insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get personalized recommendations
router.get('/recommendations', authenticateUser, async (req, res) => {
  try {
    // Get user's recent activity patterns
    const [recentActivity] = await prisma.$queryRaw`
      WITH recent_stats AS (
        SELECT 
          COUNT(DISTINCT DATE(timestamp)) as active_days,
          AVG(duration) as avg_session_length,
          COUNT(DISTINCT language) as languages_used,
          COUNT(DISTINCT projectId) as active_projects,
          SUM(duration) as total_coding_time
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp >= NOW() - INTERVAL '30 days'
      )
      SELECT 
        *,
        CASE 
          WHEN active_days < 5 THEN 'low'
          WHEN active_days < 15 THEN 'moderate'
          ELSE 'high'
        END as engagement_level
      FROM recent_stats
    `;

    // Generate personalized recommendations
    const recommendations = [];

    // Engagement recommendations
    if (recentActivity.engagement_level === 'low') {
      recommendations.push({
        type: 'engagement',
        priority: 'high',
        title: 'Increase Coding Consistency',
        description: 'Try to code at least 30 minutes every day to build a consistent habit.',
        action_items: [
          'Set a daily coding reminder',
          'Join coding challenges',
          'Start a personal project'
        ]
      });
    }

    // Learning recommendations
    if (recentActivity.languages_used < 3) {
      recommendations.push({
        type: 'learning',
        priority: 'medium',
        title: 'Expand Your Skill Set',
        description: 'Learning new languages can increase your versatility as a developer.',
        action_items: [
          'Try a new programming language',
          'Complete online courses',
          'Build projects using different technologies'
        ]
      });
    }

    // Project recommendations
    if (recentActivity.active_projects < 2) {
      recommendations.push({
        type: 'projects',
        priority: 'medium',
        title: 'Diversify Your Projects',
        description: 'Working on multiple projects helps build a comprehensive portfolio.',
        action_items: [
          'Start a side project',
          'Contribute to open source',
          'Collaborate with other developers'
        ]
      });
    }

    // Time management recommendations
    if (recentActivity.avg_session_length < 1800) { // Less than 30 minutes
      recommendations.push({
        type: 'time_management',
        priority: 'high',
        title: 'Optimize Coding Sessions',
        description: 'Longer, focused coding sessions can improve productivity.',
        action_items: [
          'Use the Pomodoro Technique',
          'Schedule dedicated coding blocks',
          'Minimize distractions during coding'
        ]
      });
    }

    res.json({
      data: {
        activity_summary: {
          ...recentActivity,
          recommended_daily_goal: Math.max(7200, recentActivity.avg_session_length * 1.2), // At least 2 hours or 20% more than current average
          potential_improvement: Math.round((7200 - recentActivity.avg_session_length) / 7200 * 100)
        },
        recommendations: recommendations.sort((a, b) => 
          a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : 0
        ),
        next_steps: recommendations.flatMap(r => r.action_items).slice(0, 3)
      }
    });
  } catch (error) {
    logger.error('Error generating recommendations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get team insights
router.get('/team', authenticateUser, async (req, res) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Get team collaboration metrics
    const teamMetrics = await prisma.$queryRaw`
      WITH team_activity AS (
        SELECT 
          u.id,
          u.username,
          COUNT(DISTINCT DATE(h.timestamp)) as active_days,
          COUNT(DISTINCT h.entity) as files_touched,
          COUNT(DISTINCT h.branch) as branches_used,
          SUM(h.duration) as total_seconds
        FROM "User" u
        JOIN Heartbeat h ON h.userId = u.id
        WHERE h.projectId = ${parseInt(projectId)}
          AND h.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY u.id, u.username
      )
      SELECT 
        *,
        ROUND(total_seconds * 100.0 / (SELECT SUM(total_seconds) FROM team_activity), 2) as contribution_percentage
      FROM team_activity
      ORDER BY total_seconds DESC
    `;

    // Get code overlap analysis
    const codeOverlap = await prisma.$queryRaw`
      WITH file_contributors AS (
        SELECT 
          h.entity,
          STRING_AGG(DISTINCT u.username, ', ') as contributors,
          COUNT(DISTINCT u.id) as contributor_count
        FROM Heartbeat h
        JOIN "User" u ON h.userId = u.id
        WHERE h.projectId = ${parseInt(projectId)}
          AND h.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY h.entity
        HAVING COUNT(DISTINCT u.id) > 1
      )
      SELECT 
        entity,
        contributors,
        contributor_count,
        CASE 
          WHEN contributor_count > 3 THEN 'high'
          WHEN contributor_count > 1 THEN 'medium'
          ELSE 'low'
        END as collaboration_level
      FROM file_contributors
      ORDER BY contributor_count DESC
      LIMIT 10
    `;

    res.json({
      data: {
        team_metrics: {
          members: teamMetrics,
          total_active_days: teamMetrics.reduce((sum, m) => sum + m.active_days, 0),
          total_contribution_hours: Math.round(teamMetrics.reduce((sum, m) => sum + m.total_seconds, 0) / 3600)
        },
        collaboration_analysis: {
          file_overlap: codeOverlap,
          high_collaboration_files: codeOverlap.filter(f => f.collaboration_level === 'high'),
          recommended_reviews: codeOverlap
            .filter(f => f.contributor_count > 2)
            .map(f => ({
              file: f.entity,
              contributors: f.contributors,
              reason: 'Multiple contributors - potential for conflicts'
            }))
        },
        recommendations: {
          code_review_pairs: teamMetrics.map(m1 => 
            teamMetrics
              .filter(m2 => m1.id !== m2.id)
              .map(m2 => ({
                reviewer: m1.username,
                reviewee: m2.username,
                reason: 'Complementary work patterns'
              }))
          ).flat().slice(0, 5),
          knowledge_sharing: teamMetrics
            .filter(m => m.files_touched > 10)
            .map(m => ({
              expert: m.username,
              areas: ['Code organization', 'Project structure'],
              suggested_session: '30 minutes knowledge sharing'
            }))
        }
      }
    });
  } catch (error) {
    logger.error('Error generating team insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get premium coding insights
router.get('/premium/coding-patterns', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionTier: true }
    });

    if (!TIER_LIMITS[user.subscriptionTier].codingInsights) {
      return res.status(403).json({
        error: 'Premium insights not available in your plan',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    const { range = 'last_30_days' } = req.query;
    const end = new Date();
    let start = new Date();

    switch (range) {
      case 'last_7_days':
        start.setDate(start.getDate() - 7);
        break;
      case 'last_30_days':
        start.setDate(start.getDate() - 30);
        break;
      case 'last_90_days':
        start.setDate(start.getDate() - 90);
        break;
      default:
        return res.status(400).json({ error: 'Invalid range' });
    }

    // Get advanced coding patterns
    const codingPatterns = await prisma.$queryRaw`
      WITH daily_stats AS (
        SELECT 
          DATE(timestamp) as date,
          EXTRACT(HOUR FROM timestamp) as hour,
          language,
          entity,
          SUM(duration) as coding_time,
          COUNT(*) as edit_count,
          SUM(CASE WHEN is_write THEN 1 ELSE 0 END) as write_count
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp), EXTRACT(HOUR FROM timestamp), language, entity
      )
      SELECT 
        hour,
        language,
        ROUND(AVG(coding_time)::numeric, 2) as avg_coding_time,
        ROUND(AVG(edit_count)::numeric, 2) as avg_edits,
        ROUND(AVG(write_count)::numeric, 2) as avg_writes,
        COUNT(DISTINCT date) as active_days,
        COUNT(DISTINCT entity) as unique_files
      FROM daily_stats
      GROUP BY hour, language
      HAVING COUNT(DISTINCT date) >= 3
      ORDER BY avg_coding_time DESC
    `;

    // Get focus metrics
    const focusMetrics = await prisma.$queryRaw`
      WITH session_gaps AS (
        SELECT 
          userId,
          timestamp,
          EXTRACT(EPOCH FROM (
            timestamp - LAG(timestamp) OVER (
              PARTITION BY userId, DATE(timestamp)
              ORDER BY timestamp
            )
          )) as gap_seconds
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
      )
      SELECT 
        COUNT(*) as total_sessions,
        ROUND(AVG(
          CASE WHEN gap_seconds <= 300 THEN gap_seconds ELSE NULL END
        )::numeric, 2) as avg_focus_time,
        COUNT(
          CASE WHEN gap_seconds <= 300 THEN 1 ELSE NULL END
        ) as focused_sessions
      FROM session_gaps
      WHERE gap_seconds IS NOT NULL
    `;

    // Get complexity trends
    const complexityTrends = await prisma.$queryRaw`
      WITH file_complexity AS (
        SELECT 
          DATE(timestamp) as date,
          entity,
          MAX(lines) as file_size,
          COUNT(DISTINCT language) as languages_used,
          COUNT(*) as edit_frequency
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp), entity
      )
      SELECT 
        date,
        ROUND(AVG(file_size)::numeric, 2) as avg_file_size,
        ROUND(AVG(languages_used)::numeric, 2) as avg_languages_per_file,
        ROUND(AVG(edit_frequency)::numeric, 2) as avg_edits_per_file,
        COUNT(DISTINCT entity) as files_touched
      FROM file_complexity
      GROUP BY date
      ORDER BY date DESC
    `;

    // Get language proficiency scores
    const proficiencyScores = await prisma.$queryRaw`
      WITH language_metrics AS (
        SELECT 
          language,
          COUNT(DISTINCT DATE(timestamp)) as days_used,
          COUNT(DISTINCT entity) as files_touched,
          SUM(duration) as total_time,
          COUNT(*) as total_edits
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND language IS NOT NULL
        GROUP BY language
      )
      SELECT 
        language,
        days_used,
        files_touched,
        total_time,
        total_edits,
        ROUND(
          (
            (days_used::float / EXTRACT(days FROM ${end}::timestamp - ${start}::timestamp)) * 0.3 +
            (total_time::float / (SELECT MAX(total_time) FROM language_metrics)) * 0.4 +
            (files_touched::float / (SELECT MAX(files_touched) FROM language_metrics)) * 0.3
          ) * 100,
          2
        ) as proficiency_score
      FROM language_metrics
      ORDER BY proficiency_score DESC
    `;

    res.json({
      data: {
        coding_patterns: {
          hourly_patterns: codingPatterns,
          most_productive_hours: codingPatterns
            .filter(p => p.active_days >= 5)
            .sort((a, b) => b.avg_coding_time - a.avg_coding_time)
            .slice(0, 3)
            .map(p => ({
              hour: p.hour,
              language: p.language,
              productivity_score: Math.round((p.avg_coding_time / 3600) * 100) / 100
            }))
        },
        focus_metrics: {
          ...focusMetrics[0],
          focus_score: Math.round(
            (focusMetrics[0].focused_sessions / focusMetrics[0].total_sessions) * 100
          )
        },
        complexity_analysis: {
          trends: complexityTrends,
          recommendations: complexityTrends
            .filter(t => t.avg_file_size > 500 || t.avg_languages_per_file > 2)
            .map(t => ({
              date: t.date,
              type: t.avg_file_size > 500 ? 'high_complexity' : 'multi_language',
              recommendation: t.avg_file_size > 500
                ? 'Consider breaking down large files'
                : 'Review multi-language dependencies'
            }))
        },
        language_proficiency: {
          scores: proficiencyScores,
          recommendations: proficiencyScores
            .filter(p => p.proficiency_score < 50)
            .map(p => ({
              language: p.language,
              current_score: p.proficiency_score,
              suggested_practice_hours: Math.ceil((50 - p.proficiency_score) / 5)
            }))
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching premium insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-powered code review insights
router.get('/premium/code-review', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionTier: true }
    });

    if (!TIER_LIMITS[user.subscriptionTier].aiCodeReview) {
      return res.status(403).json({
        error: 'AI code review not available in your plan',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    const { days = 7 } = req.query;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    // Get code patterns and potential issues
    const codePatterns = await prisma.$queryRaw`
      WITH file_stats AS (
        SELECT 
          entity,
          language,
          MAX(lines) as file_size,
          COUNT(*) as edit_count,
          COUNT(DISTINCT DATE(timestamp)) as days_modified,
          SUM(duration) as total_time
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
          AND type = 'file'
        GROUP BY entity, language
      )
      SELECT 
        entity,
        language,
        file_size,
        edit_count,
        days_modified,
        total_time,
        CASE 
          WHEN file_size > 1000 AND edit_count > 50 THEN 'high_complexity'
          WHEN days_modified > 5 AND edit_count/days_modified > 20 THEN 'high_churn'
          WHEN file_size > 500 AND days_modified = 1 THEN 'needs_review'
          ELSE 'normal'
        END as status,
        CASE 
          WHEN file_size > 1000 AND edit_count > 50 THEN 'Consider breaking down this file into smaller modules'
          WHEN days_modified > 5 AND edit_count/days_modified > 20 THEN 'High number of changes, might need refactoring'
          WHEN file_size > 500 AND days_modified = 1 THEN 'Large new file, recommend code review'
          ELSE 'No immediate action needed'
        END as recommendation
      FROM file_stats
      WHERE file_size > 100
      ORDER BY 
        CASE status
          WHEN 'high_complexity' THEN 1
          WHEN 'high_churn' THEN 2
          WHEN 'needs_review' THEN 3
          ELSE 4
        END,
        file_size DESC
    `;

    res.json({
      data: {
        files_analyzed: codePatterns.length,
        review_recommendations: codePatterns
          .filter(p => p.status !== 'normal')
          .map(p => ({
            file: p.entity,
            language: p.language,
            status: p.status,
            recommendation: p.recommendation,
            metrics: {
              size: p.file_size,
              edits: p.edit_count,
              days_modified: p.days_modified,
              total_time: Math.round(p.total_time / 60) // minutes
            }
          })),
        summary: {
          high_complexity: codePatterns.filter(p => p.status === 'high_complexity').length,
          high_churn: codePatterns.filter(p => p.status === 'high_churn').length,
          needs_review: codePatterns.filter(p => p.status === 'needs_review').length,
          normal: codePatterns.filter(p => p.status === 'normal').length
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching code review insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get premium wakatime insights
router.get('/premium/wakatime-insights', authenticateUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionTier: true }
    });

    if (!TIER_LIMITS[user.subscriptionTier].codingInsights) {
      return res.status(403).json({
        error: 'Premium wakatime insights not available in your plan',
        upgrade_url: '/api/v1/subscriptions/plans'
      });
    }

    const { days = 30 } = req.query;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    // Get advanced wakatime metrics
    const wakatimeMetrics = await prisma.$queryRaw`
      WITH daily_coding AS (
        SELECT 
          DATE(timestamp) as date,
          entity,
          language,
          category,
          project_name,
          SUM(duration) as coding_time,
          COUNT(*) as edit_count,
          MAX(lines) as max_lines,
          COUNT(DISTINCT machine_name) as machines_used,
          bool_or(is_write) as has_writes,
          array_agg(DISTINCT dependencies) as all_dependencies
        FROM Heartbeat
        WHERE userId = ${req.user.id}
          AND timestamp BETWEEN ${start} AND ${end}
        GROUP BY DATE(timestamp), entity, language, category, project_name
      )
      SELECT 
        date,
        project_name,
        language,
        SUM(coding_time) as total_coding_time,
        COUNT(DISTINCT entity) as files_touched,
        SUM(edit_count) as total_edits,
        MAX(max_lines) as largest_file,
        COUNT(DISTINCT machines_used) as total_machines,
        COUNT(DISTINCT CASE WHEN has_writes THEN entity END) as files_modified,
        array_agg(DISTINCT all_dependencies) as project_dependencies
      FROM daily_coding
      GROUP BY date, project_name, language
      ORDER BY date DESC, total_coding_time DESC
    `;

    // Calculate premium insights
    const insights = {
      productivity_patterns: wakatimeMetrics.reduce((acc, day) => {
        const date = day.date.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = {
            total_time: 0,
            languages: {},
            projects: {},
            complexity_score: 0
          };
        }
        
        acc[date].total_time += day.total_coding_time;
        acc[date].languages[day.language] = (acc[date].languages[day.language] || 0) + day.total_coding_time;
        acc[date].projects[day.project_name] = {
          time: day.total_coding_time,
          files: day.files_touched,
          edits: day.total_edits,
          complexity: (day.largest_file / 100) + (day.files_modified / day.files_touched)
        };
        acc[date].complexity_score += acc[date].projects[day.project_name].complexity;
        
        return acc;
      }, {}),
      
      project_insights: Object.fromEntries(
        [...new Set(wakatimeMetrics.map(m => m.project_name))].map(project => [
          project,
          {
            total_time: wakatimeMetrics
              .filter(m => m.project_name === project)
              .reduce((sum, m) => sum + m.total_coding_time, 0),
            languages: [...new Set(wakatimeMetrics
              .filter(m => m.project_name === project)
              .map(m => m.language))],
            dependencies: [...new Set(wakatimeMetrics
              .filter(m => m.project_name === project)
              .flatMap(m => m.project_dependencies)
              .filter(Boolean))],
            complexity_trend: wakatimeMetrics
              .filter(m => m.project_name === project)
              .map(m => ({
                date: m.date,
                complexity: (m.largest_file / 100) + (m.files_modified / m.files_touched)
              }))
          }
        ])
      ),
      
      recommendations: []
    };

    // Generate AI-powered recommendations
    insights.recommendations = Object.entries(insights.project_insights)
      .flatMap(([project, data]) => {
        const recs = [];
        
        // Check for complex projects
        if (data.complexity_trend.some(t => t.complexity > 5)) {
          recs.push({
            type: 'refactoring',
            project,
            message: 'Consider breaking down large files or modularizing the codebase'
          });
        }
        
        // Check for language diversity
        if (data.languages.length > 3) {
          recs.push({
            type: 'architecture',
            project,
            message: 'High language diversity detected. Consider standardizing the tech stack'
          });
        }
        
        // Check for dependency complexity
        if (data.dependencies.length > 20) {
          recs.push({
            type: 'dependencies',
            project,
            message: 'Large number of dependencies detected. Consider auditing and optimizing'
          });
        }
        
        return recs;
      });

    res.json({
      data: {
        insights,
        summary: {
          total_coding_time: wakatimeMetrics.reduce((sum, m) => sum + m.total_coding_time, 0),
          total_projects: Object.keys(insights.project_insights).length,
          total_languages: [...new Set(wakatimeMetrics.map(m => m.language))].length,
          most_productive_day: Object.entries(insights.productivity_patterns)
            .sort(([,a], [,b]) => b.total_time - a.total_time)[0][0]
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching wakatime insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 