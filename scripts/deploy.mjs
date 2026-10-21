// Deploys dist/ to Cloudflare Pages. The project name comes from src/site.config.ts.
// Run with: npm run deploy (needs `npx wrangler login` once, done by you, not by this script).
import { spawnSync } from 'node:child_process';
const { default: site } = await import('../src/site.config.ts');
const r = spawnSync('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', site.cloudflareProject], { stdio: 'inherit' });
process.exit(r.status ?? 1);
