import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import type { FormFieldOption } from 'src/module/xvi-fc/common/types/field-config.type';
import { FcUnspentDeclarationFormJsonService } from './fc-unspent-declaration-form-json.service';
import {
  FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
  FC_UNSPENT_FORM_ID,
} from '../../constants/fc-unspent-declaration.constants';
import { FC_UNSPENT_STATE_FORM_JSON } from '../../constants/fc-unspent-declaration.form-json.constant';

describe('FcUnspentDeclarationFormJsonService', () => {
  let service: FcUnspentDeclarationFormJsonService;
  let formJsonService: Record<string, jest.Mock>;

  const yearId = '67d7d136d3d038946a5239e9';

  beforeEach(async () => {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue(FC_UNSPENT_STATE_FORM_JSON),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FcUnspentDeclarationFormJsonService, { provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    service = module.get(FcUnspentDeclarationFormJsonService);
  });

  it('loads fields via FormJsonService.findActiveByDesignYearAndFormId(yearId, 25)', async () => {
    const fields = await service.loadFields(yearId);
    expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledWith(yearId, FC_UNSPENT_FORM_ID);
    expect(fields).toEqual(FC_UNSPENT_STATE_FORM_JSON.data);
  });

  it('propagates the NotFoundException FormJsonService throws when no active document exists', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockRejectedValue(new NotFoundException('FormJson for year x and formId 25 not found'));
    await expect(service.loadFields(yearId)).rejects.toThrow(NotFoundException);
  });

  it('throws when the loaded document data is empty', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockResolvedValue({ ...FC_UNSPENT_STATE_FORM_JSON, data: [] });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws when the loaded document is missing a required field key', async () => {
    const withoutCheckbox = FC_UNSPENT_STATE_FORM_JSON.data.filter((f) => f.key !== 'checkboxConfirmation');
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockResolvedValue({ ...FC_UNSPENT_STATE_FORM_JSON, data: withoutCheckbox });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "FC Unspent Declaration form configuration is missing required field 'checkboxConfirmation'.",
    );
  });

  it('verifies the seed payload defines isFcUnspent (yes/no radio ids matching Angular), fcDeclaration (folderPathKey, no branch only) and checkboxConfirmation (requiredTrue, yes branch only)', () => {
    const isFcUnspent = FC_UNSPENT_STATE_FORM_JSON.data.find((f) => f.key === 'isFcUnspent')!;
    const isFcUnspentOptions = isFcUnspent.options as FormFieldOption[];
    expect(isFcUnspentOptions.map((o) => o.id)).toEqual(['no', 'yes']);
    expect(isFcUnspent.validations?.some((v) => v.name === 'required')).toBe(true);

    const fcDeclaration = FC_UNSPENT_STATE_FORM_JSON.data.find((f) => f.key === 'fcDeclaration')!;
    expect(fcDeclaration.folderPathKey).toBeTruthy();
    expect(fcDeclaration.folderPath).toBeUndefined();
    expect(fcDeclaration.visibleWhen).toEqual({
      mode: 'all',
      conditions: [{ key: 'isFcUnspent', operator: 'equals', value: 'no' }],
    });
    expect(fcDeclaration.clearValueWhenDisabled).toBe(true);
    expect(fcDeclaration.allowedFileTypes).toEqual(['pdf']);
    expect(fcDeclaration.maxFileSize).toBe(5);

    const checkboxConfirmation = FC_UNSPENT_STATE_FORM_JSON.data.find((f) => f.key === 'checkboxConfirmation')!;
    expect(checkboxConfirmation.validations?.some((v) => v.name === 'requiredTrue')).toBe(true);
    expect(checkboxConfirmation.visibleWhen).toEqual({
      mode: 'all',
      conditions: [{ key: 'isFcUnspent', operator: 'equals', value: 'yes' }],
    });
    expect(checkboxConfirmation.clearValueWhenDisabled).toBe(true);
  });

  describe('download-template action validation', () => {
    it('passes when fcDeclaration has the expected download-template action', async () => {
      await expect(service.loadFields(yearId)).resolves.toBeDefined();
    });

    it('fails when fcDeclaration is missing supportingContent entirely', async () => {
      const withoutSupportingContent = FC_UNSPENT_STATE_FORM_JSON.data.map((f) =>
        f.key === 'fcDeclaration' ? { ...f, supportingContent: undefined } : f,
      );
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockResolvedValue({ ...FC_UNSPENT_STATE_FORM_JSON, data: withoutSupportingContent });
      await expect(service.loadFields(yearId)).rejects.toThrow(
        `FC Unspent Declaration form configuration is missing the '${FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID}' action on 'fcDeclaration'.`,
      );
    });

    it('fails when the actions block exists but the download-template action id is missing', async () => {
      const withWrongActionId = FC_UNSPENT_STATE_FORM_JSON.data.map((f) => {
        if (f.key !== 'fcDeclaration') return f;
        return {
          ...f,
          supportingContent: [{ type: 'actions', position: 'before', actions: [{ id: 'some-other-action' }] }],
        };
      });
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockResolvedValue({ ...FC_UNSPENT_STATE_FORM_JSON, data: withWrongActionId });
      await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
    });

    it('fails when the supportingContent block type is not "actions"', async () => {
      const wrongBlockType = FC_UNSPENT_STATE_FORM_JSON.data.map((f) => {
        if (f.key !== 'fcDeclaration') return f;
        return {
          ...f,
          supportingContent: [
            { type: 'info', position: 'before', actions: [{ id: FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID }] },
          ],
        };
      });
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockResolvedValue({ ...FC_UNSPENT_STATE_FORM_JSON, data: wrongBlockType });
      await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
