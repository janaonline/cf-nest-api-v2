import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { MohuaUlbFormsService } from './mohua-ulb-forms.service';

describe('MohuaUlbFormsService.get', () => {
  const build = (codes: Record<'audited' | 'unaudited' | 'pfms' | 'slb' | 'dur', number | null>) => {
    const progress = { loadUlbFormStatuses: jest.fn().mockResolvedValue(codes) };
    return { service: new MohuaUlbFormsService(progress as never), progress };
  };

  it('labels each form and marks submitted from the shared rule', async () => {
    const { service, progress } = build({
      audited: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      unaudited: FORM_STATUS.IN_PROGRESS,
      pfms: FORM_STATUS.APPROVED_BY_STATE,
      slb: FORM_STATUS.APPROVED_BY_STATE,
      dur: null,
    });

    const { forms } = await service.get('ulb1', 'year1');

    expect(progress.loadUlbFormStatuses).toHaveBeenCalledWith('year1', 'ulb1');
    expect(forms.audited).toEqual({ statusCode: 3, statusLabel: 'Under Review by State', submitted: true });
    expect(forms.unaudited).toMatchObject({ statusLabel: 'In Progress', submitted: false });
    expect(forms.pfms.submitted).toBe(true);
    expect(forms.slb.submitted).toBe(true);
    expect(forms.dur).toEqual({ statusCode: null, statusLabel: 'Not started', submitted: false });
  });

  it('counts SLB as submitted only at Approved by State (or exempt), unlike the other forms', async () => {
    const { service } = build({
      audited: null,
      unaudited: null,
      pfms: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      slb: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      dur: null,
    });

    const { forms } = await service.get('ulb1', 'year1');

    expect(forms.pfms.submitted).toBe(true);
    expect(forms.slb.submitted).toBe(false);
  });
});
