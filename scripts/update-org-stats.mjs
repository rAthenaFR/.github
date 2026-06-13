import fs from "node:fs/promises";

const ORG = process.env.ORG_NAME || "rAthenaFR";
const TOKEN = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (TOKEN) {
  headers.Authorization = `Bearer ${TOKEN}`;
}

async function github(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${url}\n${body}`);
  }

  return response.json();
}

async function getAllRepos() {
  const repos = [];

  for (let page = 1; ; page++) {
    const batch = await github(
      `https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100&page=${page}`
    );

    if (batch.length === 0) break;
    repos.push(...batch);
  }

  return repos;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    }[char];
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

const org = await github(`https://api.github.com/orgs/${ORG}`);
const repos = await getAllRepos();

const projectRepos = repos.filter(
  (repo) => !repo.archived && !repo.fork && repo.name !== ".github"
);

const totals = {
  publicRepos: org.public_repos,
  projectRepos: projectRepos.length,
  stars: projectRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
  forks: projectRepos.reduce((sum, repo) => sum + repo.forks_count, 0),
  openIssuesAndPullRequests: projectRepos.reduce(
    (sum, repo) => sum + repo.open_issues_count,
    0
  ),
  sizeKb: projectRepos.reduce((sum, repo) => sum + repo.size, 0),
};

const languages = {};

for (const repo of projectRepos) {
  const repoLanguages = await github(repo.languages_url);

  for (const [language, bytes] of Object.entries(repoLanguages)) {
    languages[language] = (languages[language] || 0) + bytes;
  }
}

const totalLanguageBytes = Object.values(languages).reduce(
  (sum, bytes) => sum + bytes,
  0
);

const topLanguages = Object.entries(languages)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)
  .map(([name, bytes]) => ({
    name,
    bytes,
    percent:
      totalLanguageBytes > 0
        ? Number(((bytes / totalLanguageBytes) * 100).toFixed(1))
        : 0,
  }));

const latestPush = projectRepos
  .map((repo) => repo.pushed_at)
  .filter(Boolean)
  .sort()
  .at(-1);

const stats = {
  organization: ORG,
  updatedAt: new Date().toISOString(),
  latestPush,
  totals,
  topLanguages,
};

await fs.mkdir("assets", { recursive: true });

await fs.writeFile(
  "assets/org-stats.json",
  JSON.stringify(stats, null, 2) + "\n"
);

const languageLine =
  topLanguages.length > 0
    ? topLanguages
        .map((language) => `${language.name} ${language.percent}%`)
        .join(" · ")
    : "Aucun langage détecté";

const rows = [
  ["Dépôts publics", formatNumber(totals.publicRepos)],
  ["Projets comptés", formatNumber(totals.projectRepos)],
  ["Stars totales", formatNumber(totals.stars)],
  ["Forks totaux", formatNumber(totals.forks)],
  ["Issues / PR ouvertes", formatNumber(totals.openIssuesAndPullRequests)],
  ["Dernier push", latestPush ? latestPush.slice(0, 10) : "N/A"],
];

const rowSvg = rows
  .map(([label, value], index) => {
    const y = 82 + index * 24;

    return `
      <text x="40" y="${y}" fill="#c9d1d9" font-size="14">${escapeXml(label)}</text>
      <text x="660" y="${y}" fill="#58a6ff" font-size="14" text-anchor="end" font-weight="700">${escapeXml(value)}</text>
    `;
  })
  .join("");

const svg = `
<svg width="700" height="270" viewBox="0 0 700 270" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="700" height="270" rx="14" fill="#1a1b27"/>
  <rect x="1" y="1" width="698" height="268" rx="13" stroke="#30363d"/>

  <text x="40" y="42" fill="#70a5fd" font-size="22" font-family="Segoe UI, Arial, sans-serif" font-weight="700">
    Statistiques GitHub ${escapeXml(ORG)}
  </text>

  <g font-family="Segoe UI, Arial, sans-serif">
    ${rowSvg}

    <text x="40" y="232" fill="#c9d1d9" font-size="14">Langages principaux</text>
    <text x="660" y="232" fill="#a5d6ff" font-size="13" text-anchor="end">${escapeXml(languageLine)}</text>

    <text x="40" y="252" fill="#8b949e" font-size="11">
      Mis à jour automatiquement via GitHub Actions
    </text>
  </g>
</svg>
`.trim();

await fs.writeFile("assets/org-stats.svg", svg + "\n");

console.log(`Generated organization stats for ${ORG}`);
