import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocumentActionGateDocument = HydratedDocument<XviFcDocumentActionGate>;

export type DocumentActionGateRole = 'ULB' | 'STATE' | 'MOHUA';
export type DocumentActionGateScope = 'document' | 'section';

export type DocumentActionGateAction =
  | 'upload'
  | 'reupload'
  | 'retry'
  | 'delete'
  | 'approve'
  | 'return'
  | 'undo'
  | 'approveSection'
  | 'returnSection'
  | 'undoSection';

/**
 * UI-visibility gate for annual-account document/section action buttons — decides only
 * whether a role may attempt an action while the section is in a given status. This is
 * NOT an authorization boundary: the backend's own gates (assertCanDecide, canUlbEditForm,
 * canStateDecideAnnualAccount, permission checks) keep enforcing independently of this data.
 * Which specific button/label/enablement shows within an allowed action stays fixed logic,
 * driven by the document's own runtime state (file exists / processingStatus / decision) —
 * not stored here.
 */
@Schema({
  collection: 'xvifc_action_gates',
  timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' },
  versionKey: false,
})
export class XviFcDocumentActionGate {
  @Prop({ type: String, default: 'XVI-FC' })
  module: string;

  /** null = applies to every form (audited + provisional); set to 30 or 31 to scope to one. */
  @Prop({ type: Number, default: null })
  formId: number | null;

  /** Only meaningful when scope = 'document'. null = applies to every document in the form. */
  @Prop({ type: String, default: null })
  docKey: string | null;

  @Prop({ type: String, required: true, enum: ['document', 'section'] })
  scope: DocumentActionGateScope;

  @Prop({ type: String, required: true, enum: ['ULB', 'STATE', 'MOHUA'] })
  role: DocumentActionGateRole;

  @Prop({
    type: String,
    required: true,
    enum: [
      'upload',
      'reupload',
      'retry',
      'delete',
      'approve',
      'return',
      'undo',
      'approveSection',
      'returnSection',
      'undoSection',
    ],
  })
  action: DocumentActionGateAction;

  /** Subset of the shared FORM_STATUS values (1-7 today) this action is reachable in. */
  @Prop({ type: [Number], required: true })
  statusIds: number[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const XviFcDocumentActionGateSchema = SchemaFactory.createForClass(XviFcDocumentActionGate);

XviFcDocumentActionGateSchema.index({ module: 1, formId: 1, docKey: 1, scope: 1, role: 1, isActive: 1 });
