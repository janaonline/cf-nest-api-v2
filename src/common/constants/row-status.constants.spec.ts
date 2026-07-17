import { ROW_STATUS } from './row-status.constants';

describe('ROW_STATUS', () => {
  it('has exactly the four documented values', () => {
    expect(ROW_STATUS).toEqual({
      ACTIVE: 'active',
      NEEDS_UPDATE: 'needs_update',
      UPDATE_PENDING: 'update_pending',
      REJECTED: 'rejected',
    });
  });

  it('adds no additional values beyond the four documented ones', () => {
    expect(Object.keys(ROW_STATUS).sort()).toEqual(['ACTIVE', 'NEEDS_UPDATE', 'REJECTED', 'UPDATE_PENDING']);
  });
});
