import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The dashboard's scripts ship as-is (no build step), so a typo like an
// unescaped quote breaks the live page. Parse every one before it ships.
const dir = join(__dirname, '../public');

describe('public scripts', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    it(`${file} parses`, () => {
      expect(() => new Function(readFileSync(join(dir, file), 'utf8'))).not.toThrow();
    });
  }
  // Inline <script> blocks in the hand-written pages (not the designer bundles).
  for (const file of ['login.html', 'forgot.html', 'reset.html', 'index.html', 'onboarding.html', 'dashboard.html', 'recurring.html']) {
    it(`${file} inline scripts parse`, () => {
      const html = readFileSync(join(dir, file), 'utf8');
      const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      for (const code of blocks) expect(() => new Function(code)).not.toThrow();
    });
  }
});
