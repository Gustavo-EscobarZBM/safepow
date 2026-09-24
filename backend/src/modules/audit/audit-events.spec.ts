import { auditSourceFromUserAgent } from './audit-events';

describe('auditSourceFromUserAgent', () => {
  it('cliente HTTP do app Flutter (Dart/...) ⇒ mobile', () => {
    expect(auditSourceFromUserAgent('Dart/3.5 (dart:io)')).toBe('mobile');
  });

  it('navegador ou ausente ⇒ web', () => {
    expect(auditSourceFromUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toBe('web');
    expect(auditSourceFromUserAgent(undefined)).toBe('web');
  });
});
