import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(__dirname, './globals.css'), 'utf-8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  const braceStart = css.indexOf('{', start);
  const braceEnd = css.indexOf('}', braceStart);
  return css.slice(braceStart, braceEnd);
}

const EXPECTED_LIGHT: Record<string, string> = {
  '--chart-1': '45 180 180',
  '--chart-2': '180 146 45',
  '--chart-3': '155 81 39',
  '--chart-4': '39 155 107',
  '--chart-5': '116 39 155',
};

const EXPECTED_DARK: Record<string, string> = {
  '--chart-1': '0 153 153',
  '--chart-2': '153 115 0',
  '--chart-3': '173 29 0',
  '--chart-4': '0 133 77',
  '--chart-5': '143 0 214',
};

describe('chart categorical palette (CVD-validated)', () => {
  const light = block(':root {');
  const dark = block(':root.dark {');

  for (const [token, value] of Object.entries(EXPECTED_LIGHT)) {
    it(`light ${token} is ${value}`, () => {
      expect(light).toContain(`${token}: ${value};`);
    });
  }

  for (const [token, value] of Object.entries(EXPECTED_DARK)) {
    it(`dark ${token} is ${value}`, () => {
      expect(dark).toContain(`${token}: ${value};`);
    });
  }
});
