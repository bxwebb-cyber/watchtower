#!/usr/bin/env node
// Gives the designer's bundles a phone layout: the landing page
// (public/landing.html) and the demo dashboard (public/demo.html).
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
// Usage: node scripts/phone-layout.cjs            (both pages)

const fs = require('fs');
const path = require('path');

const MARK = 'id="dunn-phone"';

// [match inside a tag's attributes, class to add, how many tags should match]
const LANDING_RULES = [
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

const LANDING_CSS = `<style ${MARK}>
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

// The demo dashboard: sidebar → a top bar with a sideways-scrolling menu,
// wide tables scroll inside their cards, two-column forms stack.
const DEMO_RULES = [
  ['grid-template-columns:216px minmax(0,1fr)', 'dm-shell', 1],
  ['position:sticky; top:0; align-self:start; height:100vh', 'dm-side', 1],
  ['padding:0 8px 26px', 'dm-logo', 1],
  [/^nav\b.*display:flex; flex-direction:column; gap:2px/, 'dm-nav', 1],
  ['margin-top:auto; border-top:1px solid rgba(15,48,46,.1); padding:16px 8px 2px', 'dm-me', 1],
  ['min-width:0; padding:32px 32px 64px', 'dm-main', 1],
  [/grid-template-columns:(?:minmax\(0,1\.3fr\) minmax\(110px,1\.2fr\) 64px 72px 84px|minmax\(0,1\.4fr\) minmax\(0,1fr\) minmax\(0,1fr\) 68px 112px|72px minmax\(0,1fr\) 96px 96px 100px)/, 'dm-trow', 6],
  [/grid-template-columns:(?:1fr 1fr; gap:14px|repeat\(3,1fr\); gap:10px; margin-top:16px|1\.3fr 1fr 1fr)/, 'dm-stack', 7],
  ['padding:40px 24px; overflow-y:auto', 'dm-modal', 2],
];

const DEMO_CSS = `<style ${MARK}>
  /* Phone layout (scripts/phone-layout.cjs). Desktop never sees these. */
  @media (max-width: 760px) {
    .dm-shell { grid-template-columns: minmax(0, 1fr) !important; } /* 1fr alone grows to fit the menu */
    .dm-side { min-width: 0; z-index: 30; height: auto !important; flex-direction: row !important; align-items: center; gap: 10px; padding: 8px 12px !important; border-right: none !important; border-bottom: 1px solid rgba(15,48,46,.1); }
    .dm-logo { padding: 0 !important; flex: none; }
    .dm-logo > div { display: none; }
    .dm-nav { flex-direction: row !important; overflow-x: auto; gap: 4px !important; flex: 1; min-width: 0; scrollbar-width: none; }
    .dm-nav::-webkit-scrollbar { display: none; }
    .dm-nav button { flex: none !important; white-space: nowrap; height: 36px !important; padding: 0 10px !important; }
    .dm-me { display: none !important; }
    .dm-main { padding: 16px 16px 48px !important; }
    .dm-trow { min-width: 600px; }
    .dm-stack { grid-template-columns: 1fr !important; }
    .dm-modal { padding: 16px 12px !important; }
  }
</style>`;

const TARGETS = [
  {
    file: path.join(__dirname, '../public/landing.html'),
    rules: LANDING_RULES,
    css: LANDING_CSS,
    // Only the marketing view: the template also carries an in-page demo that
    // getdunn.org never shows (See how it works goes to /demo).
    end: (tpl) => tpl.indexOf('<sc-if value="{{ onApp }}"'),
    // Right after the designer's own stylesheet (the one with the wt-* keyframes).
    styleAfter: (part) => part.indexOf('</style>', part.indexOf('@keyframes wt-beam')),
  },
  {
    file: path.join(__dirname, '../public/demo.html'),
    rules: DEMO_RULES,
    css: DEMO_CSS,
    end: (tpl) => tpl.indexOf('class Component'),
    styleAfter: (part) => part.lastIndexOf('</style>', part.indexOf('grid-template-columns:216px')),
  },
];

function apply({ file, rules, css, end, styleAfter }) {
  const name = path.basename(file);
  const html = fs.readFileSync(file, 'utf8');
  const re = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
  const found = re.exec(html);
  if (!found) throw new Error(`no __bundler/template in ${name} — has the bundle format changed?`);

  // The bundle escapes "</" so the template can't close its own <script>.
  const encode = (s) => JSON.stringify(s).replace(/<\//g, '<\\u002F');
  let tpl = JSON.parse(found[2]);
  if (encode(tpl) !== found[2]) throw new Error(`${name}: template does not re-encode byte-for-byte; refusing to rewrite it`);
  if (tpl.includes(MARK)) {
    console.log(`${name} already has the phone layout — nothing to do`);
    return;
  }

  const cut = end(tpl);
  if (cut < 0) throw new Error(`${name}: could not find where the tagged part ends`);
  let part = tpl.slice(0, cut);

  const counts = new Map(rules.map(([, cls]) => [cls, 0]));
  part = part.replace(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g, (tag, tagName, attrs = '') => {
    const hit = rules.filter(([m]) =>
      m instanceof RegExp ? m.test(m.source.startsWith('^') ? tagName + attrs : attrs) : attrs.includes(m));
    if (!hit.length) return tag;
    const classes = hit.map(([, cls]) => cls);
    for (const cls of classes) counts.set(cls, counts.get(cls) + 1);
    const withClass = /\sclass="([^"]*)"/.test(attrs)
      ? attrs.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${classes.join(' ')}"`)
      : ` class="${classes.join(' ')}"${attrs}`;
    return `<${tagName}${withClass}>`;
  });

  const wrong = rules.filter(([, cls, n]) => counts.get(cls) !== n)
    .map(([, cls, n]) => `${cls}: expected ${n}, matched ${counts.get(cls)}`);
  if (wrong.length) throw new Error(`${name} changed shape — update its rules:\n  ` + wrong.join('\n  '));

  const anchor = styleAfter(part);
  if (anchor < 0) throw new Error(`${name}: could not find the designer's stylesheet`);
  part = part.slice(0, anchor + 8) + '\n' + css + part.slice(anchor + 8);

  tpl = part + tpl.slice(cut);
  fs.writeFileSync(file, html.replace(re, (_, open, _body, close) => open + encode(tpl) + close));
  console.log(`${name}: phone layout added —`, [...counts].map(([c, n]) => `${c}×${n}`).join(', '));
}

for (const t of TARGETS) apply(t);
