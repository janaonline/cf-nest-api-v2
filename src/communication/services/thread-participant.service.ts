import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { THREAD_PERMISSION } from '../../common/constants/communication.constants';
import { IThreadParticipant } from '../interfaces/thread-participant.interface';
import { ThreadParticipant, ThreadParticipantDocument } from '../schemas/thread-participant.schema';

@Injectable()
export class ThreadParticipantService {
  constructor(
    @InjectModel(ThreadParticipant.name)
    private readonly participantModel: Model<ThreadParticipantDocument>,
  ) {}

  /**
   * Adds an individual user as a thread participant (idempotent upsert).
   * @param threadId Thread to add user to.
   * @param userId User to add.
   * @param permissions Permissions to grant; defaults to READ + REPLY.
   * @param session Optional MongoDB transaction session.
   */
  async addUserParticipant(
    threadId: string,
    userId: string,
    permissions: string[] = [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
    session?: ClientSession,
  ): Promise<void> {
    const threadObjId = new Types.ObjectId(threadId);
    const doc = {
      threadId: threadObjId,
      participantType: 'USER',
      participantId: userId,
      permissions,
      canReceiveNotifications: true,
      joinedAt: new Date(),
    };

    const updateOptions: { session?: ClientSession; upsert: boolean; new: boolean } = {
      upsert: true,
      new: true,
      ...(session ? { session } : {}),
    };

    await this.participantModel
      .findOneAndUpdate(
        { threadId: threadObjId, participantType: 'USER', participantId: userId },
        { $setOnInsert: doc },
        updateOptions,
      )
      .exec();
  }

  /**
   * Adds an org+role group as a thread participant (idempotent upsert).
   * The participantId key is "{orgType}:{orgId}:{roleCode}" for uniqueness.
   * @param threadId Thread to add the group to.
   * @param orgType Org type (e.g. 'ULB', 'STATE').
   * @param orgId Org ObjectId or string.
   * @param roleCode Role within the org.
   * @param permissions Permissions to grant; defaults to READ + REPLY.
   * @param session Optional MongoDB transaction session.
   */
  async addRoleGroupParticipant(
    threadId: string,
    orgType: string,
    orgId: string | Types.ObjectId,
    roleCode: string,
    permissions: string[] = [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
    session?: ClientSession,
  ): Promise<void> {
    const orgIdStr = orgId.toString();
    const participantId = `${orgType}:${orgIdStr}:${roleCode}`;
    const threadObjId = new Types.ObjectId(threadId);

    const doc = {
      threadId: threadObjId,
      participantType: 'ROLE_GROUP',
      participantId,
      orgType,
      orgId: new Types.ObjectId(orgIdStr),
      roleCode,
      permissions,
      canReceiveNotifications: true,
      joinedAt: new Date(),
    };

    const updateOptions: { session?: ClientSession; upsert: boolean; new: boolean } = {
      upsert: true,
      new: true,
      ...(session ? { session } : {}),
    };

    await this.participantModel
      .findOneAndUpdate(
        { threadId: threadObjId, participantType: 'ROLE_GROUP', participantId },
        { $setOnInsert: doc },
        updateOptions,
      )
      .exec();
  }

  /**
   * Checks if a specific user holds a given permission on the thread.
   * @param userId User to check.
   * @param threadId Thread to check against.
   * @param permission Permission string to verify.
   * @returns True if a USER participant record exists with the given permission.
   */
  async userHasPermission(userId: string, threadId: string, permission: string): Promise<boolean> {
    const participant = await this.participantModel
      .findOne({
        threadId: new Types.ObjectId(threadId),
        participantType: 'USER',
        participantId: userId,
        permissions: permission,
      })
      .lean()
      .exec();

    return !!participant;
  }

  /**
   * Fetches all participants for a thread.
   * Pass session when reading participants created within an active transaction.
   * @param threadId Thread whose participants to fetch.
   * @param session Optional MongoDB transaction session.
   * @returns Array of participant records.
   */
  async getThreadParticipants(threadId: string, session?: ClientSession): Promise<IThreadParticipant[]> {
    const records = await this.participantModel
      .find({ threadId: new Types.ObjectId(threadId) })
      .session(session ?? null)
      .lean()
      .exec();

    return records as unknown as IThreadParticipant[];
  }

  async removeParticipant(threadId: string, participantId: string, session?: ClientSession): Promise<void> {
    const deleteOptions: { session?: ClientSession } = session ? { session } : {};
    await this.participantModel
      .findOneAndDelete({ threadId: new Types.ObjectId(threadId), participantId }, deleteOptions)
      .exec();
  }
}
