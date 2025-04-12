const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Get all projects for current user
router.get('/', authenticateUser, async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user.id },
      orderBy: { name: 'asc' }
    });
    res.json({ data: projects });
  } catch (error) {
    logger.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get project by ID
// router.get('/:id', authenticateUser, async (req, res) => {
//   try {
//     const project = await prisma.project.findFirst({
//       where: {
//         id: parseInt(req.params.id),
//         userId: req.user.id
//       },
//       include: {
//         _count: {
//           select: {
//             heartbeats: true,
//             codingSessions: true
//           }
//         }
//       }
//     });

//     if (!project) {
//       return res.status(404).json({ error: 'Project not found' });
//     }

//     res.json({ data: project });
//   } catch (error) {
//     logger.error('Error fetching project:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// Create new project
// router.post('/', authenticateUser, async (req, res) => {
//   try {
//     const { name, description, repositoryUrl, branch } = req.body;

//     const project = await prisma.project.create({
//       data: {
//         name,
//         description,
//         repositoryUrl,
//         branch,
//         userId: req.user.id
//       }
//     });

//     res.status(201).json({ data: project });
//   } catch (error) {
//     if (error.code === 'P2002') {
//       return res.status(400).json({ error: 'Project name already exists' });
//     }
//     logger.error('Error creating project:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// Update project
// router.put('/:id', authenticateUser, async (req, res) => {
//   try {
//     const { name, description, repositoryUrl, branch } = req.body;

//     const project = await prisma.project.updateMany({
//       where: {
//         id: parseInt(req.params.id),
//         userId: req.user.id
//       },
//       data: {
//         name,
//         description,
//         repositoryUrl,
//         branch,
//         updated_at: new Date()
//       }
//     });

//     if (project.count === 0) {
//       return res.status(404).json({ error: 'Project not found' });
//     }

//     res.json({ data: project });
//   } catch (error) {
//     if (error.code === 'P2002') {
//       return res.status(400).json({ error: 'Project name already exists' });
//     }
//     logger.error('Error updating project:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// Delete project
// router.delete('/:id', authenticateUser, async (req, res) => {
//   try {
//     const project = await prisma.project.deleteMany({
//       where: {
//         id: parseInt(req.params.id),
//         userId: req.user.id
//       }
//     });

//     if (project.count === 0) {
//       return res.status(404).json({ error: 'Project not found' });
//     }

//     res.status(204).send();
//   } catch (error) {
//     logger.error('Error deleting project:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// Get project stats
// router.get('/:id/stats', authenticateUser, async (req, res) => {
//   try {
//     const { range = 'last_7_days' } = req.query;
//     const end = new Date();
//     let start = new Date();

//     switch (range) {
//       case 'last_7_days':
//         start.setDate(start.getDate() - 7);
//         break;
//       case 'last_30_days':
//         start.setDate(start.getDate() - 30);
//         break;
//       case 'last_6_months':
//         start.setMonth(start.getMonth() - 6);
//         break;
//       case 'last_year':
//         start.setFullYear(start.getFullYear() - 1);
//         break;
//       default:
//         return res.status(400).json({ error: 'Invalid range' });
//     }

//     const stats = await prisma.$queryRaw`
//       SELECT 
//         h.language,
//         COUNT(*) as total_heartbeats,
//         SUM(h.duration) as total_seconds
//       FROM Heartbeat h
//       WHERE h.projectId = ${parseInt(req.params.id)}
//         AND h.userId = ${req.user.id}
//         AND h.timestamp BETWEEN ${start} AND ${end}
//       GROUP BY h.language
//       ORDER BY total_seconds DESC
//     `;

//     res.json({ data: stats });
//   } catch (error) {
//     logger.error('Error fetching project stats:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

module.exports = router; 