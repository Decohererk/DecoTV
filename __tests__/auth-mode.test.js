const {
  getAuthMode,
  isPasswordMode,
  isPublicAdminAllowed,
  isPublicMode,
} = require('../src/lib/auth-mode');

describe('auth mode helpers', () => {
  const originalAuthMode = process.env.NEXT_PUBLIC_AUTH_MODE;
  const originalPublicAllowAdmin = process.env.PUBLIC_ALLOW_ADMIN;

  afterEach(() => {
    process.env.NEXT_PUBLIC_AUTH_MODE = originalAuthMode;
    process.env.PUBLIC_ALLOW_ADMIN = originalPublicAllowAdmin;
  });

  it('defaults to password mode', () => {
    delete process.env.NEXT_PUBLIC_AUTH_MODE;
    delete process.env.PUBLIC_ALLOW_ADMIN;

    expect(getAuthMode()).toBe('password');
    expect(isPasswordMode()).toBe(true);
    expect(isPublicMode()).toBe(false);
    expect(isPublicAdminAllowed()).toBe(false);
  });

  it('enables public mode without admin by default', () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'public';
    delete process.env.PUBLIC_ALLOW_ADMIN;

    expect(getAuthMode()).toBe('public');
    expect(isPublicMode()).toBe(true);
    expect(isPublicAdminAllowed()).toBe(false);
  });

  it('requires an explicit switch to open admin in public mode', () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'public';
    process.env.PUBLIC_ALLOW_ADMIN = 'true';

    expect(isPublicAdminAllowed()).toBe(true);
  });
});

