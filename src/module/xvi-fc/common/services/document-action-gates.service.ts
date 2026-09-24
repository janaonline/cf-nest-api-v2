import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DocumentActionGateDocument,
  XviFcDocumentActionGate,
} from 'src/schemas/xvi-fc/document-action-gate.schema';

/**
 * UI-visibility gates for document/section action buttons — which (role, action) pairs are
 * reachable, and in which section statuses. Not an authorization check; see
 * XviFcDocumentActionGate for why. Extracted from AnnualAccountsService.getActionGates (still
 * used there under its own private method) so a new form doesn't have to duplicate this query —
 * `formId: null` rows are module-wide wildcards that already apply to every xvi-fc form,
 * including any new one, with zero extra configuration.
 */
@Injectable()
export class DocumentActionGatesService {
  constructor(
    @InjectModel(XviFcDocumentActionGate.name)
    private readonly actionGateModel: Model<DocumentActionGateDocument>,
  ) {}

  async getActionGates(formId: number) {
    const gates = await this.actionGateModel
      .find({ module: 'XVI-FC', formId: { $in: [null, formId] }, isActive: true })
      .lean()
      .exec();

    return gates.map((g) => ({
      docKey: g.docKey,
      scope: g.scope,
      role: g.role,
      action: g.action,
      statusIds: g.statusIds,
    }));
  }
}
