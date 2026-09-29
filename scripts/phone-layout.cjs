#!/usr/bin/env node
// Gives the designer's landing page (public/landing.html) a phone layout.
//
// The file is a bundle: on load it redraws the whole document from a template
// embedded as JSON in <script type="__bundler/template">, so a stylesheet added
// to the outer page is thrown away. The phone rules have to live INSIDE that
// template. Everything is styled inline and there are no class names to hook,
// so this script tags the elements it needs (dm-* classes, found by a unique
// piece of their inline style) and adds one <style id="dunn-phone">.
//
// Desktop is untouched: every rule sits inside the max-width media query.
// Re-run it after the designer sends a new landing.html. It is idempotent, and
// it refuses to write if a rule matches a different number of elements than
// expected, so a redesign fails loudly instead of tagging the wrong thing.
//
// Usage: node scripts/phone-layout.cjs

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../public/landing.html');
const MARK = 'id="dunn-phone"';

// [match inside a tag's attributes, class to add, how many tags should match]
const RULES = [
  ['padding:14px 40px', 'dm-header', 1],
  ['padding:96px 40px 110px', 'dm-hero', 1],
  [/grid-template-columns:(?:1\.08fr \.92fr|1fr 1fr 1fr|repeat\([34],1fr\)|\.85fr 1\.15fr|\.8fr 1\.2fr)/, 'dm-stack', 6],
  [/grid-template-columns:(?:1\.08fr \.92fr|\.85fr 1\.15fr|\.8fr 1\.2fr)/, 'dm-gap', 3],
  ['font-size:72px', 'dm-h1', 1],
  [/^h2\b.*font-size:4[26]px/, 'dm-h2', 5],
  [/style="display:flex; gap:12px(?:; justify-content:center)?"/, 'dm-wrap', 2],
  ['min-height:440px', 'dm-art', 1],
  ['padding:110px 0"', 'dm-band', 1],
  ['max-width:1220px; margin:0 auto; padding:0 40px', 'dm-inner', 1],
  [/padding:(?:44px 36px|38px 30px 44px)/, 'dm-cell', 5],
  [/padding:(?:110px|90px|120px) 40px/, 'dm-pad', 6],
  ['grid-template-columns:1.4fr .9fr .9fr .8fr', 'dm-row', 2],
  ['padding:34px 40px', 'dm-footer', 1],
  ['animation:wt-wave', 'dm-still', 1],
];

const CSS = `<style ${MARK}>
  /* Phone layout (scripts/phone-layout.cjs). Desktop never sees these. */
  @media (max-width: 760px) {
    .dm-header { padding: 12px 16px !important; }
    .dm-hero { padding: 40px 20px 64px !important; }
    .dm-pad { padding: 72px 20px !important; }
    .dm-band { padding: 72px 0 !important; }
    .dm-inner { padding: 0 20px !important; }
    .dm-stack { grid-template-columns: 1fr !important; }
    .dm-gap { gap: 32px !important; }
    .dm-h1 { font-size: 46px !important; }
    .dm-h2 { font-size: 32px !important; }
    .dm-wrap { flex-wrap: wrap !important; }
    .dm-art { min-height: 0 !important; }
    .dm-art img { width: 240px !important; }
    .dm-cell { padding: 28px 24px !important; }
    .dm-row { gap: 10px !important; padding-left: 16px !important; padding-right: 16px !important; }
    .dm-footer { flex-direction: column !important; align-items: flex-start !important; gap: 16px !important; padding: 28px 20px !important; }
    .dm-still { animation: none !important; } /* the wave drifts 48px left: off-screen in a 20px margin */
  }
</style>`;

const html = fs.readFileSync(FILE, 'utf8');
const re = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
const found = re.exec(html);
if (!found) throw new Error('no __bundler/template in landing.html — has the bundle format changed?');

// The bundle escapes "</" so the template can't close its own <script>.
const encode = (s) => JSON.stringify(s).replace(/<\//g, '<\\u002F');
let tpl = JSON.parse(found[2]);
if (encode(tpl) !== found[2]) throw new Error('template does not re-encode byte-for-byte; refusing to rewrite it');
if (tpl.includes(MARK)) {
  console.log('landing.html already has the phone layout — nothing to do');
  process.exit(0);
}

// Only the marketing view: the template also carries an in-page demo that
// getdunn.org never shows (See how it works goes to /demo).
const cut = tpl.indexOf('<sc-if value="{{ onApp }}"');
if (cut < 0) throw new Error('could not find where the landing view ends');
let landing = tpl.slice(0, cut);

const counts = new Map(RULES.map(([, cls]) => [cls, 0]));
landing = landing.replace(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g, (tag, name, attrs = '') => {
  const hit = RULES.filter(([m]) =>
    m instanceof RegExp ? m.test(m.source.startsWith('^') ? name + attrs : attrs) : attrs.includes(m));
  if (!hit.length) return tag;
  const classes = hit.map(([, cls]) => cls);
  for (const cls of classes) counts.set(cls, counts.get(cls) + 1);
  const withClass = /\sclass="([^"]*)"/.test(attrs)
    ? attrs.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${classes.join(' ')}"`)
    : ` class="${classes.join(' ')}"${attrs}`;
  return `<${name}${withClass}>`;
});

const wrong = RULES.filter(([, cls, n]) => counts.get(cls) !== n)
  .map(([, cls, n]) => `${cls}: expected ${n}, matched ${counts.get(cls)}`);
if (wrong.length) throw new Error('the landing page changed shape — update RULES:\n  ' + wrong.join('\n  '));

// Right after the designer's own stylesheet (the one with the wt-* keyframes).
const anchor = landing.indexOf('</style>', landing.indexOf('@keyframes wt-beam'));
if (anchor < 0) throw new Error("could not find the designer's stylesheet");
landing = landing.slice(0, anchor + 8) + '\n' + CSS + landing.slice(anchor + 8);

tpl = landing + tpl.slice(cut);
fs.writeFileSync(FILE, html.replace(re, (_, open, _body, close) => open + encode(tpl) + close));
console.log('landing.html: phone layout added —', [...counts].map(([c, n]) => `${c}×${n}`).join(', '));
