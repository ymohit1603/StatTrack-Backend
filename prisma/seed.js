const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helper function to generate random date within a range
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

// Helper function to generate random duration in seconds (between 5 minutes and 4 hours)
function randomDuration() {
  return Math.floor(Math.random() * (14400 - 300) + 300);
}

// Helper function to generate random lines of code
function randomLines() {
  return Math.floor(Math.random() * 1000) + 50;
}

// Helper function to get a random item from an array
function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Languages and their colors
const languages = [
  { name: 'JavaScript', color: '#f1e05a' },
  { name: 'TypeScript', color: '#2b7489' },
  { name: 'Python', color: '#3572A5' },
  { name: 'Java', color: '#b07219' },
  { name: 'C++', color: '#f34b7d' },
  { name: 'Go', color: '#00ADD8' },
  { name: 'Rust', color: '#dea584' },
  { name: 'Ruby', color: '#CC342D' },
  { name: 'PHP', color: '#4F5B93' },
  { name: 'Swift', color: '#ffac45' },
  { name: 'Kotlin', color: '#F18E33' },
  { name: 'HTML', color: '#e34c26' },
  { name: 'CSS', color: '#563d7c' },
  { name: 'SQL', color: '#e48e00' },
  { name: 'Shell', color: '#89e051' }
];

// Project names
const projectNames = [
  'StatTrack',
  'Personal Website',
  'E-commerce Platform',
  'Task Manager',
  'Weather App',
  'Fitness Tracker',
  'Recipe Finder',
  'Budget Planner',
  'Social Media Dashboard',
  'Portfolio Website'
];

// Editors
const editors = [
  'VS Code',
  'IntelliJ IDEA',
  'PyCharm',
  'WebStorm',
  'Sublime Text',
  'Atom',
  'Vim',
  'Emacs',
  'Notepad++',
  'Eclipse'
];

// Categories
const categories = [
  'coding',
  'building',
  'indexing',
  'debugging'
];

async function main() {
  console.log('Starting seed...');
  
  // Check if user with ID 1 exists
  const user = await prisma.user.findUnique({
    where: { id: 1 }
  });
  
  if (!user) {
    console.log('User with ID 1 not found. Creating user...');
    await prisma.user.create({
      data: {
        id: 1,
        username: 'demo_user',
        email: 'demo@example.com',
        profile_url: 'https://github.com/demo_user',
        app_name: 'X',
        github_username: 'demo_user',
        isPrivate: false,
        editors_used_public: true,
        categories_used_public: true,
        os_used_public: true,
        logged_time_public: true,
        timezone: 'UTC',
        subscriptionTier: 'PRO',
        subscriptionStart: new Date(),
        subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        billingInterval: 'MONTHLY',
        isTeamAdmin: false
      }
    });
    console.log('User created successfully.');
  } else {
    console.log('User with ID 1 already exists.');
  }
  
  // Create projects
  console.log('Creating projects...');
  const projects = [];
  
  // First, get existing projects for user 1
  const existingProjects = await prisma.project.findMany({
    where: { userId: 1 }
  });
  
  // Create a map of existing project names for quick lookup
  const existingProjectNames = new Set(existingProjects.map(p => p.name));
  
  // Add existing projects to our projects array
  projects.push(...existingProjects);
  
  // Create new projects only if they don't exist
  for (let i = 0; i < 5; i++) {
    const projectName = projectNames[i];
    
    // Skip if project already exists
    if (existingProjectNames.has(projectName)) {
      console.log(`Project "${projectName}" already exists, skipping creation.`);
      continue;
    }
    
    const language = randomItem(languages);
    const now = new Date();
    const firstHeartbeatAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    try {
      const project = await prisma.project.create({
        data: {
          userId: 1,
          name: projectName,
          repository: `https://github.com/demo_user/${projectName.toLowerCase().replace(/\s+/g, '-')}`,
          badge: `![${projectName}](https://img.shields.io/badge/${projectName}-${language.color.replace('#', '')})`,
          color: language.color,
          clients: [editors[Math.floor(Math.random() * editors.length)]],
          has_public_url: Math.random() > 0.5,
          human_readable_last_Heartbeat_at: now.toLocaleString(),
          last_Heartbeat_at: now.toISOString(),
          human_readable_first_Heartbeat_at: firstHeartbeatAt.toLocaleString(),
          first_Heartbeat_at: firstHeartbeatAt.toISOString(),
          url: `https://github.com/demo_user/${projectName.toLowerCase().replace(/\s+/g, '-')}`,
          urlencoded_name: encodeURIComponent(projectName)
        }
      });
      projects.push(project);
      console.log(`Created project: ${projectName}`);
    } catch (error) {
      console.error(`Error creating project ${projectName}:`, error.message);
    }
  }
  
  // If we don't have enough projects, create some with unique names
  if (projects.length < 5) {
    const additionalProjectsNeeded = 5 - projects.length;
    console.log(`Creating ${additionalProjectsNeeded} additional projects with unique names...`);
    
    for (let i = 0; i < additionalProjectsNeeded; i++) {
      // Generate a unique project name
      let uniqueProjectName;
      let counter = 1;
      do {
        uniqueProjectName = `Project ${counter++}`;
      } while (existingProjectNames.has(uniqueProjectName));
      
      const language = randomItem(languages);
      const now = new Date();
      const firstHeartbeatAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      try {
        const project = await prisma.project.create({
          data: {
            userId: 1,
            name: uniqueProjectName,
            repository: `https://github.com/demo_user/${uniqueProjectName.toLowerCase().replace(/\s+/g, '-')}`,
            badge: `![${uniqueProjectName}](https://img.shields.io/badge/${uniqueProjectName}-${language.color.replace('#', '')})`,
            color: language.color,
            clients: [editors[Math.floor(Math.random() * editors.length)]],
            has_public_url: Math.random() > 0.5,
            human_readable_last_Heartbeat_at: now.toLocaleString(),
            last_Heartbeat_at: now.toISOString(),
            human_readable_first_Heartbeat_at: firstHeartbeatAt.toLocaleString(),
            first_Heartbeat_at: firstHeartbeatAt.toISOString(),
            url: `https://github.com/demo_user/${uniqueProjectName.toLowerCase().replace(/\s+/g, '-')}`,
            urlencoded_name: encodeURIComponent(uniqueProjectName)
          }
        });
        projects.push(project);
        console.log(`Created additional project: ${uniqueProjectName}`);
      } catch (error) {
        console.error(`Error creating additional project ${uniqueProjectName}:`, error.message);
      }
    }
  }
  
  console.log(`Using ${projects.length} projects for seeding data.`);
  
  // Create coding sessions and daily summaries for the last 30 days
  console.log('Creating coding sessions and daily summaries...');
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Create daily summaries
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const totalDuration = Math.random() > 0.3 ? randomDuration() : 0; // 70% chance of coding on a day
    const totalEvents = Math.floor(Math.random() * 100) + 10;
    
    if (totalDuration > 0) {
      // Check if daily summary already exists for this date
      const existingSummary = await prisma.dailySummary.findFirst({
        where: {
          userId: 1,
          summaryDate: {
            gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
          }
        }
      });
      
      if (!existingSummary) {
        await prisma.dailySummary.create({
          data: {
            userId: 1,
            summaryDate: date,
            totalDuration: totalDuration,
            totalEvents: totalEvents
          }
        });
      } else {
        console.log(`Daily summary for ${date.toISOString().split('T')[0]} already exists, skipping.`);
        continue;
      }
      
      // Create coding sessions for this day
      const sessionsCount = Math.floor(Math.random() * 5) + 1; // 1-5 sessions per day
      for (let i = 0; i < sessionsCount; i++) {
        const sessionDuration = Math.floor(totalDuration / sessionsCount);
        const startTime = new Date(date);
        startTime.setHours(Math.floor(Math.random() * 20) + 4, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
        
        const endTime = new Date(startTime.getTime() + sessionDuration * 1000);
        
        // Select random languages for this session
        const sessionLanguages = [];
        const languagesCount = Math.floor(Math.random() * 3) + 1; // 1-3 languages per session
        for (let j = 0; j < languagesCount; j++) {
          const language = randomItem(languages);
          if (!sessionLanguages.includes(language.name)) {
            sessionLanguages.push(language.name);
          }
        }
        
        const project = randomItem(projects);
        
        // Create coding session
        await prisma.codingSession.create({
          data: {
            userId: 1,
            projectId: project.id,
            startTime: startTime,
            endTime: endTime,
            duration: sessionDuration,
            branch: Math.random() > 0.5 ? 'main' : 'develop',
            languages: sessionLanguages,
            totalLines: randomLines()
          }
        });
        
        // Create heartbeats for this session
        const heartbeatsCount = Math.floor(Math.random() * 20) + 5; // 5-25 heartbeats per session
        for (let j = 0; j < heartbeatsCount; j++) {
          const heartbeatTime = new Date(startTime.getTime() + Math.random() * (endTime.getTime() - startTime.getTime()));
          const language = randomItem(sessionLanguages);
          
          await prisma.heartbeat.create({
            data: {
              userId: 1,
              project: project.name,
              language: language,
              time: Math.random() * 60 + 30, // 30-90 seconds
              project_root_count: Math.floor(Math.random() * 10) + 1,
              entity: `src/components/${language.toLowerCase()}/index.${language === 'JavaScript' ? 'js' : language === 'TypeScript' ? 'ts' : 'py'}`,
              type: 'file',
              category: randomItem(categories),
              is_write: Math.random() > 0.7, // 30% chance of write operation
              branch: Math.random() > 0.5 ? 'main' : 'develop',
              dependencies: JSON.stringify(['react', 'axios', 'lodash']),
              lines: randomLines(),
              line_additions: Math.floor(Math.random() * 50),
              line_deletions: Math.floor(Math.random() * 30),
              lineno: Math.floor(Math.random() * 1000) + 1,
              cursorpos: Math.floor(Math.random() * 100) + 1,
              machine_name: 'demo-laptop',
              created_at: heartbeatTime,
              updated_at: heartbeatTime
            }
          });
        }
      }
    }
  }
  
  // Add detailed data for today and past 24 hours
  console.log('Adding detailed data for today and past 24 hours...');
  
  // Today's data
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Create a more substantial daily summary for today
  const todayTotalDuration = randomDuration() * 2; // More coding time today
  const todayTotalEvents = Math.floor(Math.random() * 200) + 50; // More events today
  
  // Delete any existing daily summary for today to avoid conflicts
  await prisma.dailySummary.deleteMany({
    where: {
      userId: 1,
      summaryDate: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    }
  });
  
  // Create today's daily summary
  await prisma.dailySummary.create({
    data: {
      userId: 1,
      summaryDate: today,
      totalDuration: todayTotalDuration,
      totalEvents: todayTotalEvents
    }
  });
  
  // Create multiple coding sessions for today
  const todaySessions = [
    { startHour: 9, duration: 7200 }, // Morning session: 2 hours
    { startHour: 14, duration: 10800 }, // Afternoon session: 3 hours
    { startHour: 20, duration: 5400 } // Evening session: 1.5 hours
  ];
  
  for (const session of todaySessions) {
    const startTime = new Date(today);
    startTime.setHours(session.startHour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
    
    const endTime = new Date(startTime.getTime() + session.duration * 1000);
    
    // Select languages for this session
    const sessionLanguages = [];
    const languagesCount = Math.floor(Math.random() * 2) + 1; // 1-2 languages per session
    for (let j = 0; j < languagesCount; j++) {
      const language = randomItem(languages);
      if (!sessionLanguages.includes(language.name)) {
        sessionLanguages.push(language.name);
      }
    }
    
    const project = randomItem(projects);
    
    // Create coding session
    const codingSession = await prisma.codingSession.create({
      data: {
        userId: 1,
        projectId: project.id,
        startTime: startTime,
        endTime: endTime,
        duration: session.duration,
        branch: Math.random() > 0.5 ? 'main' : 'develop',
        languages: sessionLanguages,
        totalLines: randomLines() * 2 // More lines of code
      }
    });
    
    // Create detailed heartbeats for this session
    const heartbeatsCount = Math.floor(Math.random() * 30) + 20; // 20-50 heartbeats per session
    for (let j = 0; j < heartbeatsCount; j++) {
      const heartbeatTime = new Date(startTime.getTime() + Math.random() * (endTime.getTime() - startTime.getTime()));
      const language = randomItem(sessionLanguages);
      
      // Create more realistic file paths
      const fileTypes = ['components', 'pages', 'utils', 'hooks', 'styles', 'api', 'models', 'services'];
      const fileType = randomItem(fileTypes);
      const fileName = randomItem(['index', 'utils', 'helper', 'config', 'types', 'constants', 'context', 'provider']);
      const fileExtension = language === 'JavaScript' ? 'js' : language === 'TypeScript' ? 'ts' : language === 'Python' ? 'py' : 'js';
      
      await prisma.heartbeat.create({
        data: {
          userId: 1,
          project: project.name,
          language: language,
          time: Math.random() * 60 + 30, // 30-90 seconds
          project_root_count: Math.floor(Math.random() * 10) + 1,
          entity: `src/${fileType}/${fileName}.${fileExtension}`,
          type: 'file',
          category: randomItem(categories),
          is_write: Math.random() > 0.7, // 30% chance of write operation
          branch: Math.random() > 0.5 ? 'main' : 'develop',
          dependencies: JSON.stringify(['react', 'axios', 'lodash', 'date-fns', 'tailwindcss']),
          lines: randomLines(),
          line_additions: Math.floor(Math.random() * 50),
          line_deletions: Math.floor(Math.random() * 30),
          lineno: Math.floor(Math.random() * 1000) + 1,
          cursorpos: Math.floor(Math.random() * 100) + 1,
          machine_name: 'demo-laptop',
          created_at: heartbeatTime,
          updated_at: heartbeatTime
        }
      });
    }
  }
  
  // Past 24 hours data (in addition to today)
  const past24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // Create a session that started yesterday and ended today
  const yesterdayStart = new Date(past24Hours);
  yesterdayStart.setHours(22, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
  
  const todayEnd = new Date(today);
  todayEnd.setHours(2, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
  
  const crossDayDuration = Math.floor((todayEnd.getTime() - yesterdayStart.getTime()) / 1000);
  
  // Select languages for this session
  const crossDayLanguages = [];
  const crossDayLanguagesCount = Math.floor(Math.random() * 2) + 1; // 1-2 languages per session
  for (let j = 0; j < crossDayLanguagesCount; j++) {
    const language = randomItem(languages);
    if (!crossDayLanguages.includes(language.name)) {
      crossDayLanguages.push(language.name);
    }
  }
  
  const crossDayProject = randomItem(projects);
  
  // Create coding session that spans yesterday and today
  const crossDaySession = await prisma.codingSession.create({
    data: {
      userId: 1,
      projectId: crossDayProject.id,
      startTime: yesterdayStart,
      endTime: todayEnd,
      duration: crossDayDuration,
      branch: 'main',
      languages: crossDayLanguages,
      totalLines: randomLines() * 3 // More lines of code for this longer session
    }
  });
  
  // Create heartbeats for this cross-day session
  const crossDayHeartbeatsCount = Math.floor(Math.random() * 40) + 30; // 30-70 heartbeats
  for (let j = 0; j < crossDayHeartbeatsCount; j++) {
    const heartbeatTime = new Date(yesterdayStart.getTime() + Math.random() * (todayEnd.getTime() - yesterdayStart.getTime()));
    const language = randomItem(crossDayLanguages);
    
    // Create more realistic file paths
    const fileTypes = ['components', 'pages', 'utils', 'hooks', 'styles', 'api', 'models', 'services'];
    const fileType = randomItem(fileTypes);
    const fileName = randomItem(['index', 'utils', 'helper', 'config', 'types', 'constants', 'context', 'provider']);
    const fileExtension = language === 'JavaScript' ? 'js' : language === 'TypeScript' ? 'ts' : language === 'Python' ? 'py' : 'js';
    
    await prisma.heartbeat.create({
      data: {
        userId: 1,
        project: crossDayProject.name,
        language: language,
        time: Math.random() * 60 + 30, // 30-90 seconds
        project_root_count: Math.floor(Math.random() * 10) + 1,
        entity: `src/${fileType}/${fileName}.${fileExtension}`,
        type: 'file',
        category: randomItem(categories),
        is_write: Math.random() > 0.7, // 30% chance of write operation
        branch: 'main',
        dependencies: JSON.stringify(['react', 'axios', 'lodash', 'date-fns', 'tailwindcss']),
        lines: randomLines(),
        line_additions: Math.floor(Math.random() * 50),
        line_deletions: Math.floor(Math.random() * 30),
        lineno: Math.floor(Math.random() * 1000) + 1,
        cursorpos: Math.floor(Math.random() * 100) + 1,
        machine_name: 'demo-laptop',
        created_at: heartbeatTime,
        updated_at: heartbeatTime
      }
    });
  }
  
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 