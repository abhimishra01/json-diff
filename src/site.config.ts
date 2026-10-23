// ONE config file. Change values here; every page reads from it.
// Keep this file plain (no type-only syntax): scripts/deploy.mjs imports it directly.
const cfg = {
  name: 'JSON Diff Checker',                   // shown in header, title, footer
  domain: 'bingemind.com',                     // no https://, no www.
  cloudflareProject: 'json-diff',              // Cloudflare Pages project name (used by npm run deploy)
  keyword: 'json diff checker',                // main keyword
  keywords: ['json diff', 'json compare', 'compare json online', 'json difference', 'compare two json files', 'json diff ignore order'],
  tagline: 'Free, fast and private',
  description:
    'Paste two JSON files and see every change by path. Ignore key order, match array items by id, and keep your data in your browser. Free, no sign-up.',
  email: 'hello@bingemind.com',                // contact email (shown on the Contact, Privacy and Terms pages)
  ga4: '',                                     // GA4 measurement ID, e.g. 'G-XXXXXXXXXX'. Empty = Google Analytics off
  adsense: '',                                 // AdSense publisher ID, e.g. 'ca-pub-1234567890123456'. Empty = ads off
  brand: '#6d28d9',                            // brand color (hex). Violet keeps green and red free for added and removed.
  locale: 'en-US',                             // BCP 47 language tag
  ogImage: '/og.png',                          // 1200x630 file in public/
  category: 'DeveloperApplication',            // schema.org applicationCategory
  owner: 'JSON Diff Checker',                  // name used in legal pages
};

// Bingemind mode (SITE_MODE=bingemind): the tool lives at bingemind.com/json-diff/.
// Canonical links always name that address. Legal pages name Bingemind as the owner.
const bingemind = process.env.SITE_MODE === 'bingemind';
export default {
  ...cfg,
  domain: 'bingemind.com/json-diff',
  origin: 'https://bingemind.com/json-diff',
  bingemind,
  owner: bingemind ? 'Bingemind (Abhishek Mishra)' : cfg.owner,
  contactWord: bingemind ? 'Contact' : 'Email',
  contactHref: bingemind ? 'https://bingemind.com/#contact' : `mailto:${cfg.email}`,
  contactLabel: bingemind ? 'bingemind.com/#contact' : cfg.email,
};
