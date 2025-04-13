const { prisma } = require('../config/db');  // Prisma client
const { parseISO } = require('date-fns');

async function getSummaries(userId, start, end, project, branches, timeout, timezone) {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  userId = parseInt(userId);

  // Fetch coding sessions within the given time range
  const sessions = await prisma.codingSession.findMany({
    where: {
      userId,
      startTime: {
        gte: startDate,
        lte: endDate,
      },
      project: project ? { equals: project } : undefined,
      branch: branches ? { in: branches.split(',') } : undefined, // handle multiple branches
    },
    include: {
      user: true,  // Include user data in case needed for more info
    },
  });

  // Initialize summary structures
  let grandTotalSeconds = 0;
  const categories = {};
  const projects = {};
  const languages = {};
  const branchesSummary = {}; // Fix: Initialize for branches
  const editors = {};
  const operatingSystems = {};
  const dependencies = {};
  const machines = {};

  // Loop through each session to collect summary data
  for (const session of sessions) {
    const { startTime, endTime, project, branch, language, duration } = session;

    // Increment the grand total coding time
    grandTotalSeconds += duration;

    // Aggregate data by categories (you can add more categories here)
    if (!categories['Coding']) {
      categories['Coding'] = 0;
    }
    categories['Coding'] += duration;

    // Aggregate by project
    if (!projects[project]) {
      projects[project] = 0;
    }
    projects[project] += duration;

    // Aggregate by language
    if (language) {
      if (!languages[language]) {
        languages[language] = 0;
      }
      languages[language] += duration;
    }

    // Aggregate by branch
    if (branch) {
      if (!branchesSummary[branch]) {
        branchesSummary[branch] = 0;
      }
      branchesSummary[branch] += duration;
    }

    // Aggregate by other fields (editors, operating systems, etc.)
    // Assuming you have similar logic for these fields if data is available
  }

  // Calculate averages and cumulative total
  const cumulativeTotal = {
    seconds: grandTotalSeconds,
    text: `${Math.floor(grandTotalSeconds / 3600)} hours ${Math.floor((grandTotalSeconds % 3600) / 60)} minutes`,
    decimal: (grandTotalSeconds / 60).toFixed(2), // Cumulative total in decimal format
    digital: `${Math.floor(grandTotalSeconds / 3600)}:${Math.floor((grandTotalSeconds % 3600) / 60)}:${grandTotalSeconds % 60}`,
  };

  const dailyAverage = {
    holidays: 0, // Assuming no holidays, you can add logic to calculate this
    daysIncludingHolidays: sessions.length, // For simplicity, assuming one session per day
    daysMinusHolidays: sessions.length, // Same assumption for simplicity
    seconds: grandTotalSeconds / sessions.length,
    text: `${Math.floor((grandTotalSeconds / sessions.length) / 3600)} hours ${Math.floor(((grandTotalSeconds / sessions.length) % 3600) / 60)} minutes`,
    secondsIncludingOtherLanguage: grandTotalSeconds / sessions.length,
    textIncludingOtherLanguage: `${Math.floor((grandTotalSeconds / sessions.length) / 3600)} hours ${Math.floor(((grandTotalSeconds / sessions.length) % 3600) / 60)} minutes`,
  };

  return {
    data: [{
      grand_total: cumulativeTotal,
      categories: Object.entries(categories).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
      })),
      projects: Object.entries(projects).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
      })),
      languages: Object.entries(languages).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
      })),
      branches: Object.entries(branchesSummary).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
      })),
      editors: Object.entries(editors).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
      })),
      operating_systems: Object.entries(operatingSystems).map(([name, totalSeconds]) => ({
        name,
        total_seconds: totalSeconds,
        percent: (totalSeconds / grandTotalSeconds) * 100,
        digital: `${Math.floor(totalSeconds / 3600)}:${Math.floor((totalSeconds % 3600) / 60)}:${totalSeconds % 60}`,
        text: `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes`,
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
      })),
      range: {
        date: startDate.toISOString().split('T')[0],
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        text: `From ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        timezone: timezone || 'UTC',
      },
    }],
    cumulative_total: cumulativeTotal,
    daily_average: dailyAverage,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

module.exports = {
  getSummaries
}
