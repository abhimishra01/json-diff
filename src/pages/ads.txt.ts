import type { APIRoute } from 'astro';
import site from '../site.config.ts';
// Built from the AdSense ID in site.config.ts. google.com is the ad system; f08c47fec0942fa0 is Google's fixed certification ID.
export const GET: APIRoute = () => {
  const pub = site.adsense.trim().replace(/^ca-/, '');
  const body = pub
    ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
    : '# AdSense is off. Set "adsense" in src/site.config.ts and rebuild; this file is then generated.\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
