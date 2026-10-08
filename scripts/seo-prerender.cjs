#!/usr/bin/env node
// Makes the homepage (public/landing.html) readable without JavaScript, and
// keeps its SEO tags after it unpacks.
//
// landing.html is the designer's bundle: the first response is a loader, and
// on load it replaces the whole document with a template embedded as JSON
// (<script type="__bundler/template">). Two problems that fixes:
//   1. The first response had no viewport and no page text (crawlers that
//      don't run JavaScript, like ChatGPT's and Perplexity's, saw nothing).
//      → the page's text (scripts/landing-prerender.html) goes into the first
//        response, under the loader's cover, until the real page replaces it.
//   2. The unpacked document's <head> only had charset + viewport, so the
//      title, description, canonical, Open Graph and JSON-LD vanished.
//      → the same SEO tags are copied into the template's <head>.
// Also sets the product screenshot (public/og-dunn.png) as the social image.
// The designer's two JSON-LD blocks (SoftwareApplication, FAQPage) are kept
// as they are and copied into the unpacked <head> with the rest.
//
// Safe to re-run: every block it adds sits between dunn-seo markers and is
// replaced on the next run. Re-run after a new landing.html from the designer
// (after scripts/phone-layout.cjs). If the page copy changes, update
// scripts/landing-prerender.html to match.
//
// Usage: node scripts/seo-prerender.cjs

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../public/landing.html');
const PRERENDER = path.join(__dirname, 'landing-prerender.html');
const OG_IMAGE = 'https://getdunn.org/og-dunn.png';

const block = (name, html) => `<!-- dunn-seo:${name} -->${html}<!-- /dunn-seo:${name} -->`;
const putBlock = (s, name, html, insertAt) => {
  const re = new RegExp(`<!-- dunn-seo:${name} -->[\\s\\S]*?<!-- /dunn-seo:${name} -->`);
  if (re.test(s)) return s.replace(re, () => block(name, html));
  const i = insertAt(s);
  if (i < 0) throw new Error(`no place to put ${name}`);
  return s.slice(0, i) + block(name, html) + s.slice(i);
};
const after = (needle) => (s) => { const i = s.indexOf(needle); return i < 0 ? -1 : i + needle.length; };

let html = fs.readFileSync(FILE, 'utf8');
const prerender = fs.readFileSync(PRERENDER, 'utf8').trim();
if (!prerender.includes('<h1>')) throw new Error('landing-prerender.html has no <h1>');

// ── the outer document (the first response) ──
const tplRe = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
const tplAt = html.search(tplRe);
if (tplAt < 0) throw new Error('no __bundler/template in landing.html — has the bundle format changed?');
const headEnd = html.indexOf('</head>');
if (headEnd < 0 || headEnd > tplAt) throw new Error('landing.html: outer </head> not found');
let outerHead = html.slice(0, headEnd);
let rest = html.slice(headEnd);

outerHead = putBlock(outerHead, 'viewport', '\n  <meta name="viewport" content="width=device-width, initial-scale=1">', after('<meta charset="utf-8">'));
outerHead = outerHead
  .replace(/(<meta property="og:image" content=")[^"]*(">)/, `$1${OG_IMAGE}$2`)
  .replace(/(<meta name="twitter:image" content=")[^"]*(">)/, `$1${OG_IMAGE}$2`);
outerHead = putBlock(outerHead, 'og-image', `\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta property="og:image:alt" content="The Dunn dashboard: overdue invoices, late fees, and which clients are always late.">`,
  (s) => { const m = /<meta property="og:image" content="[^"]*">/.exec(s); return m ? m.index + m[0].length : -1; });

// The SEO tags to carry into the unpacked document: from <title> through the
// last JSON-LD block — meta, Open Graph, Twitter and both JSON-LD blocks,
// nothing of the loader's own styling (which comes after them).
const seoStart = outerHead.indexOf('<title>');
const lastLd = outerHead.lastIndexOf('<script type="application/ld+json">');
const seoEnd = lastLd < 0 ? -1 : outerHead.indexOf('</script>', lastLd) + '</script>'.length;
if (seoStart < 0 || seoEnd < seoStart) throw new Error('could not find the SEO tags in the outer <head>');
const seoTags = outerHead.slice(seoStart, seoEnd).replace(/<!-- \/?dunn-seo:[a-z-]+ -->/g, '');
if ((seoTags.match(/application\/ld\+json/g) || []).length !== 2 || /<style|<noscript/.test(seoTags)) {
  throw new Error('the SEO tags to copy should be exactly the meta tags + 2 JSON-LD blocks; the outer <head> changed shape');
}

// The page's text, right after <body>, under the loader's full-screen cover.
rest = putBlock(rest, 'prerender', `\n<div id="dunn-prerender">\n${prerender}\n</div>\n`, after('<body>'));

html = outerHead + rest;

// ── the template (the unpacked document) ──
const found = tplRe.exec(html);
const encode = (s) => JSON.stringify(s).replace(/<\//g, '<\\u002F');
let tpl = JSON.parse(found[2]);
if (encode(tpl) !== found[2]) throw new Error('template does not re-encode byte-for-byte; refusing to rewrite it');
tpl = putBlock(tpl, 'head', '\n' + seoTags + '\n', after('<meta name="viewport" content="width=device-width, initial-scale=1">'));
html = html.replace(tplRe, (_, open, _body, close) => open + encode(tpl) + close);

fs.writeFileSync(FILE, html);
console.log(`landing.html: viewport, social image, ${prerender.length} chars of page text, SEO tags in the unpacked <head>`);
