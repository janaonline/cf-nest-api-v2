import { Types } from 'mongoose';

/** Plain-object shape returned by .lean() queries on form_status_histories. */
export interface IFormStatusHistory {
  _id: Types.ObjectId;
  formSubmissionId: Types.ObjectId;
  fromStatus: number;
  toStatus: number;
  action: string;
  remarks?: string;
  actorUserId: Types.ObjectId;
  actorOrgType: string;
  actorOrgId?: Types.ObjectId;
  actorRoleCode: string;
  createdAt: Date;
}
