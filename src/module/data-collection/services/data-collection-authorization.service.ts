import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';

@Injectable()
export class DataCollectionAuthorizationService {
  constructor(
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
  ) {}

  /**
   * Validates if client can access a specific ULB.
   * ULB clients may only access their own ULB.
   * STATE clients may access any active ULB under their state.
   * @param client API client context.
   * @param ulbId ULB ObjectId string.
   * @throws ForbiddenException if not allowed.
   */
  async validateCanAccessUlb(client: ApiClientContext, ulbId: string): Promise<void> {
    if (client.actorType === 'ULB') {
      if (client.ulbId !== ulbId) {
        throw new ForbiddenException('Client is not allowed to access this ULB.');
      }
      return;
    }

    const exists = await this.ulbModel.exists({
      _id: new Types.ObjectId(ulbId),
      state: new Types.ObjectId(client.stateId),
      isActive: true,
    });

    if (!exists) {
      throw new ForbiddenException('Client is not allowed to access this ULB.');
    }
  }

  /**
   * Validates if client can submit data for a specific ULB.
   * @param client API client context.
   * @param ulbId ULB to submit for.
   * @throws ForbiddenException if not allowed.
   */
  validateCanSubmitForUlb(client: ApiClientContext, ulbId: string): Promise<void> {
    return this.validateCanAccessUlb(client, ulbId);
  }

  /**
   * Validates if client can modify data for a specific ULB.
   * @param client API client context.
   * @param ulbId ULB to modify for.
   * @throws ForbiddenException if not allowed.
   */
  validateCanModifyForUlb(client: ApiClientContext, ulbId: string): Promise<void> {
    return this.validateCanAccessUlb(client, ulbId);
  }

  /**
   * Returns MongoDB filter for allowed ULBs based on client type.
   * Use this in list queries to avoid per-ULB authorization checks.
   * @param client API client context.
   * @returns Mongoose filter object.
   */
  getAllowedUlbFilter(client: ApiClientContext): object {
    if (client.actorType === 'ULB') {
      return { _id: new Types.ObjectId(client.ulbId), isActive: true };
    }
    return { state: new Types.ObjectId(client.stateId), isActive: true };
  }
}
