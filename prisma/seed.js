// prisma/seed.js

let chalk;

(async () => {
  // 1️⃣ Dynamically import Chalk (ESM)
  chalk = (await import('chalk')).default;

  // 2️⃣ Require the rest as CommonJS
  const { subDays, subHours, addDays } = require('date-fns');
  const { prisma } = require('../src/config/db');

  // 3️⃣ Main seeding logic
  async function main() {
    console.log(chalk.bold.cyan("🌱 Starting seed..."));

    console.log(chalk.yellow("🧹 Deleting existing data..."));
    await prisma.heartbeat.deleteMany();
    await prisma.codingSession.deleteMany();
    await prisma.dailySummary.deleteMany();
    await prisma.project.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();
    console.log(chalk.green("✅ All existing data deleted."));

    console.log(chalk.yellow("👥 Creating team..."));
    const team = await prisma.team.create({
      data: {
        name: "Awesome Dev Team",
        subscriptionTier: "TEAM",
        subscriptionStart: new Date(),
        subscriptionEnd: addDays(new Date(), 365),
        billingInterval: "ANNUAL",
        stripeCustomerId: "cus_team_seed_1",
        maxMembers: 5
      }
    });
    console.log(chalk.green(`✅ Team created: ${chalk.bold(team.name)} (ID: ${team.id})`));

    console.log(chalk.yellow("👤 Creating users..."));
    const users = await Promise.all([
      prisma.user.create({
        data: {
          username: "johndoe_seed",
          email: "john_seed@example.com",
          twitterId: "twitter_seed_1",
          profile_url: "https://twitter.com/johndoe",
          app_name: "X",
          website: "https://johndoe.dev",
          github_username: "johndoe",
          twitter_username: "johndoe",
          timezone: "America/New_York",
          subscriptionTier: "PRO",
          subscriptionStart: new Date(),
          subscriptionEnd: addDays(new Date(), 30),
          billingInterval: "MONTHLY",
          stripeCustomerId: "cus_seed_1",
          teamId: team.id,
          isTeamAdmin: true
        }
      }),
      prisma.user.create({
        data: {
          username: "janesmith_seed",
          email: "jane_seed@example.com",
          linkedinId: "linkedin_seed_1",
          profile_url: "https://linkedin.com/in/janesmith",
          app_name: "LinkedIn",
          website: "https://janesmith.dev",
          github_username: "janesmith",
          linkedin_username: "janesmith",
          timezone: "Europe/London",
          subscriptionTier: "FREE",
          teamId: team.id
        }
      })
    ]);
    console.log(chalk.green(`✅ ${users.length} users created.`));

    const languages = ["TypeScript", "JavaScript", "Python", "HTML", "CSS"];
    const categories = ["coding", "debugging", "building"];

    for (const [i, user] of users.entries()) {
      console.log(chalk.bold(`\n🛠 Seeding data for user: ${chalk.cyan(user.username)} (ID: ${user.id})`));

      console.log(chalk.yellow("📁 Creating projects..."));
      const projects = await Promise.all([
        prisma.project.create({
          data: {
            userId: user.id,
            name: `Personal Website ${i}`,
            repository: `personal-website-${i}`,
            badge: `https://wakatime.com/badge/user/${i}/project/456.svg`,
            color: "#FF0000",
            clients: ["Chrome", "VS Code"],
            has_public_url: true,
            human_readable_last_heartbeat_at: "3 hours ago",
            last_heartbeat_at: new Date().toISOString(),
            human_readable_first_heartbeat_at: "2 months ago",
            first_heartbeat_at: subDays(new Date(), 60).toISOString(),
            url: `https://github.com/username/personal-website-${i}`,
            urlencoded_name: `personal-website-${i}`
          }
        }),
        prisma.project.create({
          data: {
            userId: user.id,
            name: `Todo App ${i}`,
            repository: `todo-app-${i}`,
            badge: `https://wakatime.com/badge/user/${i}/project/789.svg`,
            color: "#00FF00",
            clients: ["VS Code"],
            has_public_url: true,
            human_readable_last_heartbeat_at: "1 hour ago",
            last_heartbeat_at: new Date().toISOString(),
            human_readable_first_heartbeat_at: "1 month ago",
            first_heartbeat_at: subDays(new Date(), 30).toISOString(),
            url: `https://github.com/username/todo-app-${i}`,
            urlencoded_name: `todo-app-${i}`
          }
        })
      ]);
      console.log(chalk.green(`✅ ${projects.length} projects created.`));

      console.log(chalk.yellow("💓 Creating heartbeats..."));
      for (let j = 0; j < 100; j++) {
        await prisma.heartbeat.create({
          data: {
            userId: user.id,
            project: projects[Math.floor(Math.random() * projects.length)].name,
            language: languages[Math.floor(Math.random() * languages.length)],
            time: Date.now() / 1000,
            project_root_count: Math.floor(Math.random() * 10),
            entity: `/src/components/Component${j}.tsx`,
            type: "file",
            category: categories[Math.floor(Math.random() * categories.length)],
            is_write: Math.random() > 0.5,
            branch: "main",
            dependencies: "react,next,typescript",
            lines: Math.floor(Math.random() * 1000),
            line_additions: Math.floor(Math.random() * 20),
            line_deletions: Math.floor(Math.random() * 10),
            lineno: Math.floor(Math.random() * 100),
            cursorpos: Math.floor(Math.random() * 80),
            machine_name: "macbook-pro"
          }
        });
      }
      console.log(chalk.green("✅ 100 heartbeats created."));

      console.log(chalk.yellow("⌨️  Creating coding sessions..."));
      for (let j = 0; j < 10; j++) {
        const startTime = subHours(new Date(), j * 3);
        const endTime = subHours(startTime, 2);
        await prisma.codingSession.create({
          data: {
            userId: user.id,
            startTime,
            endTime,
            duration: 7200,
            branch: "main",
            language: languages[Math.floor(Math.random() * languages.length)]
          }
        });
      }
      console.log(chalk.green("✅ 10 coding sessions created."));

      console.log(chalk.yellow("📊 Creating daily summaries..."));
      for (let j = 0; j < 30; j++) {
        await prisma.dailySummary.create({
          data: {
            userId: user.id,
            summaryDate: subDays(new Date(), j),
            totalDuration: (Math.random() * 28800).toFixed(2),
            totalEvents: Math.floor(Math.random() * 100)
          }
        });
      }
      console.log(chalk.green("✅ 30 daily summaries created."));

      console.log(chalk.yellow("🔑 Creating API key..."));
      await prisma.apiKey.create({
        data: {
          userId: user.id,
          name: "Dev API Key",
          key: `waka_seed_${i}_${Math.random().toString(36).substring(7)}`,
          lastUsed: new Date(),
          expires_at: addDays(new Date(), 365),
          isActive: true
        }
      });
      console.log(chalk.green("✅ API key created."));

      console.log(chalk.yellow("💵 Creating invoice..."));
      await prisma.invoice.create({
        data: {
          userId: user.id,
          amount: 29.99,
          currency: "USD",
          status: "paid",
          stripeId: `in_seed_${i}_${Math.random().toString(36).substring(7)}`,
          paid_at: new Date()
        }
      });
      console.log(chalk.green("✅ Invoice created."));
    }

    console.log(chalk.bold.green("\n🎉 Seeding complete!"));
  }

  // 4️⃣ Execute with proper error handling
  try {
    await main();
  } catch (e) {
    console.error(chalk.red("❌ Seeding error:"), e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log(chalk.gray("🔌 Disconnected from database."));
  }
})();
