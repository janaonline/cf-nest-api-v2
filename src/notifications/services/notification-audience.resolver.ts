import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { INotificationAudience } from '../../common/types/workflow.types';
import { User } from '../../schemas/user/user.schema';

@Injectable()
export class NotificationAudienceResolver {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  /**
   * Resolves a logical audience description into concrete recipient user ID strings.
   * Queries users with indexed filters (role, ulb, state) — never loads all users into memory.
   * If userIds are provided directly they are returned as-is (de-duplicated).
   * @param audience Filter criteria: orgType, orgId, roleCodes, or explicit userIds.
   * @returns Array of user ID strings ready for bulk notification creation.
   */
  async resolveAudience(audience: INotificationAudience): Promise<string[]> {
    if (audience.userIds && audience.userIds.length > 0) {
      return [...new Set(audience.userIds)];
    }

    const query: Record<string, unknown> = { isActive: true, isDeleted: false };

    if (audience.orgType && !audience.roleCodes?.length) {
      query['role'] = audience.orgType;
    } else if (audience.roleCodes?.length) {
      query['role'] = { $in: audience.roleCodes };
    }

    if (audience.orgId) {
      const orgIdStr = audience.orgId.toString();
      const orgType = audience.orgType ?? (audience.roleCodes?.length === 1 ? audience.roleCodes[0] : undefined);
      if (orgType === 'ULB') {
        query['ulb'] = new Types.ObjectId(orgIdStr);
      } else if (orgType === 'STATE') {
        query['state'] = new Types.ObjectId(orgIdStr);
      } else {
        query['$or'] = [{ ulb: new Types.ObjectId(orgIdStr) }, { state: new Types.ObjectId(orgIdStr) }];
      }
    }

    const users = await this.userModel.find(query).select('_id').lean().exec();
    return (users as { _id: Types.ObjectId }[]).map((u) => u._id.toString());
  }
}
