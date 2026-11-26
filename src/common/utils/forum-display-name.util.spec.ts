import { resolveForumDisplayName } from './forum-display-name.util';

describe('resolveForumDisplayName', () => {
  const base = {
    accountName: 'Rakesh Sharma',
    email: 'r@example.org',
    ulbName: 'Kaithoon Municipality',
    stateName: 'Punjab',
  };

  it('shows the ULB name for ULB accounts', () => {
    for (const role of ['ULB', 'ULB-EDITOR', 'ULB-VIEWER']) {
      expect(resolveForumDisplayName({ ...base, role })).toBe('Kaithoon Municipality');
    }
  });

  it('shows "State DMA, <State>" for State accounts', () => {
    for (const role of ['STATE', 'XVIFC_STATE', 'STATE-EDITOR', 'STATE-VIEWER']) {
      expect(resolveForumDisplayName({ ...base, role })).toBe('State DMA, Punjab');
    }
  });

  it('shows "MoHUA" for MoHUA accounts', () => {
    expect(resolveForumDisplayName({ ...base, role: 'MoHUA' })).toBe('MoHUA');
  });

  it('keeps the account name for other roles', () => {
    expect(resolveForumDisplayName({ ...base, role: 'ADMIN' })).toBe('Rakesh Sharma');
  });

  it('falls back to the account name when the ULB / State record is missing', () => {
    expect(resolveForumDisplayName({ ...base, role: 'ULB', ulbName: null })).toBe('Rakesh Sharma');
    expect(resolveForumDisplayName({ ...base, role: 'STATE', stateName: '  ' })).toBe('Rakesh Sharma');
  });

  it('falls back to email, then a placeholder, and caps the length', () => {
    expect(resolveForumDisplayName({ role: 'USER', email: 'a@b.c' })).toBe('a@b.c');
    expect(resolveForumDisplayName({})).toBe('Unknown user');
    expect(resolveForumDisplayName({ role: 'ULB', ulbName: 'x'.repeat(100) })).toHaveLength(60);
  });
});
