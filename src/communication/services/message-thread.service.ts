import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTEXT_TYPE,
  THREAD_PERMISSION,
  THREAD_PURPOSE,
  THREAD_STATUS,
} from '../../common/constants/communication.constants';
import { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { CommunicationPermissions } from '../../common/services/communication.permissions';
import { IFormSubmission } from '../../forms/interfaces/form-submission.interface';
import { Role } from '../../module/auth/enum/role.enum';
import { IMessageThread } from '../interfaces/message-thread.interface';
import { IThreadParticipant } from '../interfaces/thread-participant.interface';
import { MessageThread, MessageThreadDocument } from '../schemas/message-thread.schema';
import { ThreadParticipantService } from './thread-participant.service';

@Injectable()
export class MessageThreadService {
  constructor(
    @InjectModel(MessageThread.name)
    private readonly threadModel: Model<MessageThreadDocument>,
    private readonly participantService: ThreadParticipantService,
    private readonly communicationPermissions: CommunicationPermissions,
  ) {}

  /**
   * Finds the existing communication thread for a form submission or creates one.
   * The unique compound index on {contextType, contextId, threadPurpose} prevents
   * duplicate threads under concurrent requests. Also adds ULB and STATE as participants.
   * @param formSubmission Form whose thread to find or create.
   * @param createdByUser User initiating the thread (stored as createdBy).
   * @param session Optional MongoDB transaction session.
   * @returns Existing or newly created message thread with form metadata.
   */
  async findOrCreateFormSubmissionThread(
    formSubmission: IFormSubmission,
    createdByUser: IAuthUser,
    session?: ClientSession,
  ): Promise<IMessageThread> {
    const contextId = formSubmission._id.toString();

    const existing = await this.getThreadByContext(
      CONTEXT_TYPE.FORM_SUBMISSION,
      contextId,
      THREAD_PURPOSE.FORM_COMMUNICATION,
    );
    if (existing) return existing;

    const threadDoc = {
      contextType: CONTEXT_TYPE.FORM_SUBMISSION,
      contextId: new Types.ObjectId(contextId),
      threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
      financialYear: formSubmission.financialYear,
      formTemplateId: formSubmission.formJsonId,
      formName: formSubmission.formName,
      ulbId: formSubmission.ulbId,
      stateId: formSubmission.stateId,
      title: `${formSubmission.formName} — ${formSubmission.financialYear}`,
      status: THREAD_STATUS.OPEN,
      currentFormStatus: formSubmission.currentFormStatus,
      createdBy: new Types.ObjectId(createdByUser._id),
    };

    const insertOptions: { session?: ClientSession } = session ? { session } : {};
    const [thread] = await this.threadModel.create([threadDoc], insertOptions);
    const threadId = thread._id.toString();

    const participantOps: Promise<void>[] = [];
    if (formSubmission.ulbId) {
      participantOps.push(
        this.participantService.addRoleGroupParticipant(
          threadId,
          'ULB',
          formSubmission.ulbId,
          'ULB',
          [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
          session,
        ),
      );
    }
    if (formSubmission.stateId) {
      participantOps.push(
        this.participantService.addRoleGroupParticipant(
          threadId,
          'STATE',
          formSubmission.stateId,
          'STATE',
          [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
          session,
        ),
      );
    }
    await Promise.all(participantOps);

    return thread as unknown as IMessageThread;
  }

  /**
   * Looks up a thread by its context type, context ID, and purpose.
   * @param contextType Entity type the thread belongs to (e.g. FORM_SUBMISSION).
   * @param contextId ID of the entity (e.g. formSubmissionId string).
   * @param threadPurpose Purpose of the thread (e.g. FORM_COMMUNICATION).
   * @returns Matching thread or null if not found.
   */
  async getThreadByContext(
    contextType: string,
    contextId: string,
    threadPurpose: string,
  ): Promise<IMessageThread | null> {
    const record = await this.threadModel
      .findOne({
        contextType,
        contextId: new Types.ObjectId(contextId),
        threadPurpose,
      })
      .lean()
      .exec();

    return record ? (record as unknown as IMessageThread) : null;
  }

  /**
   * Updates the thread's denormalised last-message fields after a new message is sent.
   * @param threadId Thread to update.
   * @param messageBody Full body of the latest message (truncated to 120 chars for preview).
   * @param session Optional MongoDB transaction session.
   */
  async updateThreadLastMessage(threadId: string, messageBody: string, session?: ClientSession): Promise<void> {
    const preview = messageBody.slice(0, 120);
    const updateOptions: { session?: ClientSession } = session ? { session } : {};
    await this.threadModel
      .findByIdAndUpdate(threadId, { lastMessageAt: new Date(), lastMessagePreview: preview }, updateOptions)
      .exec();
  }

  /**
   * Syncs the form's current status into the thread's cached currentFormStatus field.
   * Called after every workflow status transition to keep thread list filters accurate.
   * @param formSubmission Form with the updated status.
   * @param session Optional MongoDB transaction session.
   */
  async syncThreadFormStatus(formSubmission: IFormSubmission, session?: ClientSession): Promise<void> {
    const updateOptions: { session?: ClientSession } = session ? { session } : {};
    await this.threadModel
      .findOneAndUpdate(
        {
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          contextId: new Types.ObjectId(formSubmission._id.toString()),
          threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
        },
        { currentFormStatus: formSubmission.currentFormStatus },
        updateOptions,
      )
      .exec();
  }

  /**
   * Fetches a thread by ID without any permission check.
   * Use this for workflow operations that have already verified permissions via
   * FormWorkflowPermissions. For user-facing reads use getThreadDetails() instead.
   * @param threadId Thread ObjectId string.
   * @param session Optional MongoDB transaction session.
   * @returns Thread document or null if not found.
   */
  async findThreadById(threadId: string, session?: ClientSession): Promise<IMessageThread | null> {
    const record = await this.threadModel
      .findById(threadId)
      .session(session ?? null)
      .lean()
      .exec();
    return record ? (record as unknown as IMessageThread) : null;
  }

  /**
   * Fetches a thread with its participants in a single logical operation, then checks
   * view permission. Returns both values so callers avoid a second participant query.
   * Pass session when the thread may have been created within an active transaction.
   * @param threadId Thread ObjectId string.
   * @param user Authenticated user whose role and org determine access.
   * @param session Optional MongoDB transaction session.
   * @returns Thread and its participants.
   * @throws NotFoundException if the thread does not exist.
   * @throws ForbiddenException if the user is not a participant with view access.
   */
  async getThreadDetailsForUser(
    threadId: string,
    user: IAuthUser,
    session?: ClientSession,
  ): Promise<{ thread: IMessageThread; participants: IThreadParticipant[] }> {
    const record = await this.threadModel
      .findById(threadId)
      .session(session ?? null)
      .lean()
      .exec();
    if (!record) throw new NotFoundException('Thread not found');

    const thread = record as unknown as IMessageThread;
    const participants = await this.participantService.getThreadParticipants(threadId, session);
    this.communicationPermissions.assertCanViewThread(user, thread, participants);

    return { thread, participants };
  }

  /**
   * Fetches thread details and checks view permission.
   * Delegates to getThreadDetailsForUser() and returns only the thread.
   * @param threadId Thread ObjectId string.
   * @param user Authenticated user whose role and org determine access.
   * @param session Optional MongoDB transaction session.
   * @returns The matching thread document.
   * @throws NotFoundException if the thread does not exist.
   * @throws ForbiddenException if the user is not a participant with view access.
   */
  async getThreadDetails(threadId: string, user: IAuthUser, session?: ClientSession): Promise<IMessageThread> {
    const { thread } = await this.getThreadDetailsForUser(threadId, user, session);
    return thread;
  }

  /**
   * Fetches paginated threads scoped to the requesting user's organisation.
   * ULB users see only threads for their ULB; STATE users see only threads for their state;
   * MoHUA/ADMIN see all threads. Optional filters narrow by financial year, context type,
   * thread purpose, form status, or a keyword search on form name and thread title.
   * @param user Authenticated user (determines org scope applied automatically).
   * @param filters Pagination options and optional narrowing criteria.
   * @returns Paginated threads sorted by last-message date descending, and total count.
   */
  async getThreads(
    user: IAuthUser,
    filters: {
      financialYear?: string;
      contextType?: string;
      threadPurpose?: string;
      currentFormStatus?: number;
      search?: string;
      page: number;
      limit: number;
    },
  ): Promise<{ threads: IMessageThread[]; total: number }> {
    const query: Record<string, unknown> = {};

    if (filters.financialYear) query['financialYear'] = filters.financialYear;
    if (filters.contextType) query['contextType'] = filters.contextType;
    if (filters.threadPurpose) query['threadPurpose'] = filters.threadPurpose;
    if (filters.currentFormStatus !== undefined) {
      query['currentFormStatus'] = filters.currentFormStatus;
    }

    if (filters.search) {
      query['$or'] = [
        { formName: { $regex: filters.search, $options: 'i' } },
        { title: { $regex: filters.search, $options: 'i' } },
      ];
    }

    if (user.role === Role.ULB && user.ulb) {
      query['ulbId'] = new Types.ObjectId(user.ulb);
    } else if (user.role === Role.STATE && user.state) {
      query['stateId'] = new Types.ObjectId(user.state);
    }

    const { page, limit } = filters;
    const [records, total] = await Promise.all([
      this.threadModel
        .find(query)
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.threadModel.countDocuments(query).exec(),
    ]);

    return { threads: records as unknown as IMessageThread[], total };
  }
}
