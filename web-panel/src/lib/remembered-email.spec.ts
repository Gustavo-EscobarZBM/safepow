import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRememberedEmail, readRememberedEmail, saveRememberedEmail } from './remembered-email';

describe('remembered e-mail', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty string when nothing was saved', () => {
    expect(readRememberedEmail()).toBe('');
  });

  it('saves and reads back the e-mail', () => {
    saveRememberedEmail('ana@empresa.com.br');

    expect(readRememberedEmail()).toBe('ana@empresa.com.br');
  });

  it('forgets the e-mail when cleared', () => {
    saveRememberedEmail('ana@empresa.com.br');
    clearRememberedEmail();

    expect(readRememberedEmail()).toBe('');
  });

  it('never throws when the browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readRememberedEmail()).toBe('');
    expect(() => saveRememberedEmail('ana@empresa.com.br')).not.toThrow();
    expect(() => clearRememberedEmail()).not.toThrow();
  });
});
