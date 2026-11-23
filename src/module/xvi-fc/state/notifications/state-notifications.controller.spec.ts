import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { StateNotificationsController } from './state-notifications.controller';

describe('StateNotificationsController', () => {
  it('passes the state, year and caller to the service', async () => {
    const service = { getNotifications: jest.fn().mockResolvedValue('feed') };
    const controller = new StateNotificationsController(service as never);
    const user = { _id: 'u1' } as unknown as AuthUser;

    await expect(controller.getNotifications('state-1', 'year-1', user)).resolves.toBe('feed');
    expect(service.getNotifications).toHaveBeenCalledWith('state-1', 'year-1', user);
  });
});
