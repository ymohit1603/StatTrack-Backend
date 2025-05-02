const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Helpers
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}
function randomDuration() { return Math.floor(Math.random() * (14400 - 300) + 300); }
function randomLines() { return Math.floor(Math.random() * 1000) + 50; }
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const languages = [ 'JavaScript','TypeScript','Python','Java','C++','Go','Rust','Ruby','PHP','Swift','Kotlin','HTML','CSS','SQL','Shell' ];
const projectNames = [ 'StatTrack','Personal Website','E-commerce Platform','Task Manager','Weather App','Fitness Tracker','Recipe Finder','Budget Planner','Social Media Dashboard','Portfolio Website' ];
const editors = [ 'VS Code','IntelliJ IDEA','PyCharm','WebStorm','Sublime Text','Atom','Vim','Emacs','Notepad++','Eclipse' ];
const categories = [ 'coding','building','indexing','debugging' ];

async function generateYearlyData(userId, year) {
  const start = new Date(year,0,1), end = new Date(year,11,31);
  const projects = await prisma.project.findMany({ where: { userId } });
  for (const p of projects) {
    for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
      if (Math.random()>0.3) {
        const hbCount = Math.floor(Math.random()*10)+5;
        for (let i=0;i<hbCount;i++) {
          const lang = randomItem(languages);
          await prisma.heartbeat.create({ data: {
            userId, project: p.name, language: lang, time: randomDuration(), project_root_count:1,
            entity: `src/main.${lang.toLowerCase()}`, type:'file', category: randomItem(categories),
            is_write: Math.random()>0.5, branch:'main', dependencies: JSON.stringify(['react','typescript']),
            lines: randomLines(), line_additions: Math.floor(Math.random()*100), line_deletions: Math.floor(Math.random()*50),
            lineno: Math.floor(Math.random()*1000), cursorpos: Math.floor(Math.random()*100), machine_name:`machine-${userId}`,
            created_at: randomDate(new Date(d.getFullYear(),d.getMonth(),d.getDate(),9,0,0), new Date(d.getFullYear(),d.getMonth(),d.getDate(),18,0,0))
          }});
        }
      }
    }
    for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
      if (Math.random()>0.3) {
        const sessions = Math.floor(Math.random()*3)+1;
        for (let i=0;i<sessions;i++) {
          const st = randomDate(new Date(d.getFullYear(),d.getMonth(),d.getDate(),9,0,0), new Date(d.getFullYear(),d.getMonth(),d.getDate(),18,0,0));
          const dur = randomDuration();
          await prisma.codingSession.create({ data: {
            userId, projectId: p.id, startTime: st, endTime: new Date(st.getTime()+dur*1000), duration:dur,
            branch:'main', languages:[randomItem(languages)], totalLines: randomLines()
          }});
        }
      }
    }
    for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) {
      const date = new Date(d);
      const totalDuration = Math.random()>0.3?randomDuration():0;
      const totalEvents = Math.floor(Math.random()*100)+10;
      if (totalDuration>0) await prisma.dailySummary.upsert({ where:{ userId_projectId_summaryDate:{userId,projectId:p.id,summaryDate:date}}, update:{totalDuration, totalEvents}, create:{userId,projectId:p.id,summaryDate:date,totalDuration,totalEvents} });
    }
  }
}

async function main() {
  console.log('Deleting existing records...');
  await prisma.alphaUsageTracking?.deleteMany().catch(()=>{});
  await prisma.aiUsageTracking.deleteMany();
  await prisma.connectionTracking.deleteMany();
  await prisma.usageTracking.deleteMany();
  await prisma.token.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.userPreferences.deleteMany();
  await prisma.dailySummary.deleteMany();
  await prisma.codingSession.deleteMany();
  await prisma.heartbeat.deleteMany();
  await prisma.project.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding User #1...');
  const user = await prisma.user.create({ data:{
    id:1, username:'user1', email:'user1@example.com', profile_url:'https://github.com/user1',
    app_name:'X', github_username:'user1', isPrivate:false, editors_used_public:true, categories_used_public:true,
    os_used_public:true, logged_time_public:true, timezone:'UTC', subscriptionTier:'FREE',
    subscriptionStart:new Date(), subscriptionEnd:new Date(Date.now()+365*24*60*60*1000), billingInterval:'ANNUAL'
  }});

  console.log('Seeding Team for User #1...');
  const team = await prisma.team.create({ data:{ name:'Team1', subscriptionTier:'TEAM', maxMembers:5, members:{ connect:[{ id:1 }] } }});
  await prisma.user.update({ where:{id:1}, data:{ teamId: team.id, isTeamAdmin:true }});

  console.log('Seeding Projects...');
  const projectCount = Math.floor(Math.random()*3)+2;
  for(let i=0;i<projectCount;i++){
    const name=randomItem(projectNames);
    await prisma.project.create({ data:{
      userId:1, name, repository:`https://github.com/user1/${name.toLowerCase().replace(/\s+/g,'-')}`,
      badge:`![${name}](https://img.shields.io/badge/${name}-blue)`, color:'#3572A5',
      clients:[randomItem(editors)], has_public_url:true, human_readable_last_Heartbeat_at:'2 hours ago',
      last_Heartbeat_at:new Date().toISOString(), human_readable_first_Heartbeat_at:'1 month ago',
      first_Heartbeat_at:new Date(Date.now()-30*24*60*60*1000).toISOString(),
      url:`https://github.com/user1/${name.toLowerCase().replace(/\s+/g,'-')}`, urlencoded_name:name.toLowerCase().replace(/\s+/g,'-')
    }});
  }

  console.log('Seeding Preferences, API Key, Token, Usage & Invoices...');
  await prisma.userPreferences.create({ data:{ userId:1, dashboard:{ theme:'dark',layout:'grid',widgets:['coding_time','languages','projects'] }, notifications:{ email:true,push:true,daily_summary:true }, appearance:{ theme:'dark',fontSize:'medium',showBadges:true } }});
  await prisma.apiKey.create({ data:{ userId:1,name:'Default Key', key:'sk_test_1', lastUsed:new Date(), expires_at:new Date(Date.now()+365*24*60*60*1000), isActive:true }});
  await prisma.token.create({ data:{ userId:1, token:'tok_test_1', expiresAt:new Date(Date.now()+7*24*60*60*1000) }});
  await prisma.usageTracking.create({ data:{ userId:1, limitType:'heartbeat', date:new Date(), count:0, duration:0 }});
  await prisma.connectionTracking.create({ data:{ userId:1, date:new Date(), count:0 }});
  await prisma.aiUsageTracking.create({ data:{ userId:1, month:`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`, minutes:0 }});
  await prisma.invoice.create({ data:{ userId:1, amount:0, currency:'USD', status:'pending' }});

  console.log('Generating historical data...');
  await generateYearlyData(1, 2024);
  await generateYearlyData(1, new Date().getFullYear());

  console.log('Seeding complete');
}

main().catch(e=>{ console.error(e); process.exit(1); }).finally(async()=>{ await prisma.$disconnect(); });
