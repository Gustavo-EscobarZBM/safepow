import { describe, expect, it } from 'vitest';
import { scoreToSeverity, SEVERITY_STYLES } from './severity';

describe('scoreToSeverity', () => {
  it('classifies scores at or above 50 as critical', () => {
    expect(scoreToSeverity(50)).toBe('critical');
    expect(scoreToSeverity(80)).toBe('critical');
  });

  it('classifies scores between 25 and 49 as warning', () => {
    expect(scoreToSeverity(25)).toBe('warning');
    expect(scoreToSeverity(49)).toBe('warning');
  });

  it('classifies scores below 25 as info', () => {
    expect(scoreToSeverity(24)).toBe('info');
    expect(scoreToSeverity(0)).toBe('info');
  });
});

describe('SEVERITY_STYLES', () => {
  it('defines a style entry for every alert severity', () => {
    expect(Object.keys(SEVERITY_STYLES).sort()).toEqual(['critical', 'info', 'success', 'warning']);
  });
});
