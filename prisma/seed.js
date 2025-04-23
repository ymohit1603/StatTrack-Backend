let chalk;

(async () => {
  chalk = (await import('chalk')).default;

  const { subDays, subHours, addDays } = require('date-fns');
  const { prisma } = require('../src/config/db');

  async function main() {
    console.log(chalk.bold.cyan("🌱 Starting seed for Mohit..."));

    console.log(chalk.yellow("🧹 Deleting existing data for Mohit (ID: 15)..."));
    await prisma.Heartbeat.deleteMany({ where: { userId: 15 } });
    await prisma.codingSession.deleteMany({ where: { userId: 15 } });
    await prisma.dailySummary.deleteMany({ where: { userId: 15 } });
    await prisma.project.deleteMany({ where: { userId: 15 } });
    await prisma.apiKey.deleteMany({ where: { userId: 15 } });
    await prisma.invoice.deleteMany({ where: { userId: 15 } });
    console.log(chalk.green("✅ Existing data for Mohit deleted."));

    console.log(chalk.yellow("📁 Creating projects..."));
    const projects = await Promise.all([
      prisma.project.create({
        data: {
          userId: 15,
          name: "StatTrack",
          repository: "stattrack",
          badge: "https://wakatime.com/badge/user/15/project/123.svg",
          color: "#007ACC",
          clients: ["VS Code", "Chrome"],
          has_public_url: true,
          human_readable_last_Heartbeat_at: "5 minutes ago",
          last_Heartbeat_at: new Date().toISOString(),
          human_readable_first_Heartbeat_at: "1 month ago",
          first_Heartbeat_at: subDays(new Date(), 30).toISOString(),
          url: "https://github.com/ymohit1603/stattrack",
          urlencoded_name: "stattrack"
        }
      }),
      prisma.project.create({
        data: {
          userId: 15,
          name: "LMM",
          repository: "long-mail-memory",
          badge: "https://wakatime.com/badge/user/15/project/456.svg",
          color: "#FF5722",
          clients: ["VS Code"],
          has_public_url: true,
          human_readable_last_Heartbeat_at: "10 minutes ago",
          last_Heartbeat_at: new Date().toISOString(),
          human_readable_first_Heartbeat_at: "2 months ago",
          first_Heartbeat_at: subDays(new Date(), 60).toISOString(),
          url: "https://github.com/ymohit1603/long-mail-memory",
          urlencoded_name: "long-mail-memory"
        }
      })
    ]);
    console.log(chalk.green("✅ Projects created."));

    const languages = ["TypeScript", "JavaScript", "Python"];
    const categories = ["coding", "debugging", "building"];

    console.log(chalk.yellow("💓 Creating Heartbeats..."));
    for (let j = 0; j < 100; j++) {
      await prisma.Heartbeat.create({
        data: {
          userId: 15,
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
    console.log(chalk.green("✅ 100 Heartbeats created."));

    console.log(chalk.yellow("⌨️  Creating coding sessions..."));
    for (let j = 0; j < 10; j++) {
      const startTime = subHours(new Date(), j * 3);
      const endTime = subHours(startTime, -2);
      await prisma.codingSession.create({
        data: {
          userId: 15,
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
          userId: 15,
          summaryDate: subDays(new Date(), j),
          totalDuration: parseFloat((Math.random() * 28800).toFixed(2)),
          totalEvents: Math.floor(Math.random() * 100)
        }
      });
    }
    console.log(chalk.green("✅ 30 daily summaries created."));

    console.log(chalk.yellow("🔑 Creating API key..."));
    await prisma.apiKey.create({
      data: {
        userId: 15,
        name: "Mohit Dev Key",
        key: `waka_seed_15_${Math.random().toString(36).substring(7)}`,
        lastUsed: new Date(),
        expires_at: addDays(new Date(), 365),
        isActive: true
      }
    });
    console.log(chalk.green("✅ API key created."));

    console.log(chalk.yellow("💵 Creating invoice..."));
    await prisma.invoice.create({
      data: {
        userId: 15,
        amount: 29.99,
        currency: "USD",
        status: "paid",
        stripeId: `in_seed_15_${Math.random().toString(36).substring(7)}`,
        paid_at: new Date()
      }
    });
    console.log(chalk.green("✅ Invoice created."));

    console.log(chalk.bold.green("\n🎉 Mohit's seed complete!"));
  }

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
