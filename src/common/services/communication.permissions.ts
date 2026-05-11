import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '../../module/auth/enum/role.enum';
import { IAuthUser } from '../interfaces/auth-user.interface';
import { IMessageThread } from '../../communication/interfaces/message-thread.interface';
import { IThreadParticipant } from '../../communication/interfaces/thread-participant.interface';
import { MESSAGE_VISIBILITY, THREAD_PERMISSION, THREAD_STATUS } from '../constants/communication.constants';

@Injectable()
export class CommunicationPermissions {
  /**
   * Checks if user can view a thread.
   * ADMIN and MoHUA always have access; other users must match a participant record.
   * @param user Authenticated user.
   * @param _thread Message thread (reserved for future status checks).
   * @param participants Thread participant list.
   * @returns True if user has view access to the thread.
   */
  canViewThread(user: IAuthUser, _thread: IMessageThread, participants: IThreadParticipant[]): boolean {
    if (user.role === Role.ADMIN || user.role === Role.MoHUA) return true;

    return participants.some((p) => {
      if (p.participantType === 'USER') {
        return p.participantId === user._id;
      }
      if (p.participantType === 'ROLE_GROUP') {
        const roleMatch = p.roleCode === user.role;
        const orgMatch =
          (user.role === Role.ULB && !!user.ulb && p.orgId?.toString() === user.ulb) ||
          (user.role === Role.STATE && !!user.state && p.orgId?.toString() === user.state);
        return roleMatch && orgMatch;
      }
      return false;
    });
  }

  /**
   * Checks if user can reply to a thread.
   * Thread must be OPEN and user must have view access and REPLY (or INTERNAL_NOTE) permission.
   * @param user Authenticated user.
   * @param thread Message thread.
   * @param participants Thread participant list.
   * @returns True if thread is OPEN and user has reply permission.
   */
  canReplyToThread(user: IAuthUser, thread: IMessageThread, participants: IThreadParticipant[]): boolean {
    if (thread.status !== THREAD_STATUS.OPEN) return false;
    if (!this.canViewThread(user, thread, participants)) return false;
    if (user.role === Role.ADMIN || user.role === Role.MoHUA) return true;

    return participants.some((p) => {
      const hasReply =
        p.permissions.includes(THREAD_PERMISSION.REPLY) || p.permissions.includes(THREAD_PERMISSION.INTERNAL_NOTE);

      if (p.participantType === 'USER') {
        return p.participantId === user._id && hasReply;
      }
      if (p.participantType === 'ROLE_GROUP') {
        const roleMatch = p.roleCode === user.role;
        const orgMatch =
          (user.role === Role.ULB && !!user.ulb && p.orgId?.toString() === user.ulb) ||
          (user.role === Role.STATE && !!user.state && p.orgId?.toString() === user.state);
        return roleMatch && orgMatch && hasReply;
      }
      return false;
    });
  }

  /**
   * Determines if user can send a message with the given visibility level.
   * @param user Authenticated user.
   * @param visibility Target visibility (INTERNAL_ULB, INTERNAL_STATE, INTERNAL_MOHUA).
   * @returns True if user's role matches the visibility restriction, or visibility is EXTERNAL/SYSTEM.
   */
  canSendInternalNote(user: IAuthUser, visibility: MESSAGE_VISIBILITY): boolean {
    if (visibility === MESSAGE_VISIBILITY.INTERNAL_MOHUA) {
      return user.role === Role.MoHUA || user.role === Role.ADMIN;
    }
    if (visibility === MESSAGE_VISIBILITY.INTERNAL_STATE) {
      return user.role === Role.STATE || user.role === Role.ADMIN;
    }
    if (visibility === MESSAGE_VISIBILITY.INTERNAL_ULB) {
      return user.role === Role.ULB || user.role === Role.ADMIN;
    }
    return true;
  }

  /**
   * Checks if user can view a message based on its visibility level.
   * EXTERNAL and SYSTEM are visible to all; INTERNAL_* variants are org-restricted.
   * @param user Authenticated user.
   * @param messageVisibility Visibility level of the message.
   * @returns True if the message is visible to the user's role.
   */
  canViewMessage(user: IAuthUser, messageVisibility: MESSAGE_VISIBILITY): boolean {
    switch (messageVisibility) {
      case MESSAGE_VISIBILITY.EXTERNAL:
      case MESSAGE_VISIBILITY.SYSTEM:
        return true;
      case MESSAGE_VISIBILITY.INTERNAL_MOHUA:
        return user.role === Role.MoHUA || user.role === Role.ADMIN;
      case MESSAGE_VISIBILITY.INTERNAL_STATE:
        return user.role === Role.STATE || user.role === Role.ADMIN;
      case MESSAGE_VISIBILITY.INTERNAL_ULB:
        return user.role === Role.ULB || user.role === Role.ADMIN;
      default:
        return false;
    }
  }

  /**
   * @throws ForbiddenException if user cannot view the thread.
   */
  assertCanViewThread(user: IAuthUser, thread: IMessageThread, participants: IThreadParticipant[]): void {
    if (!this.canViewThread(user, thread, participants)) {
      throw new ForbiddenException('You do not have permission to view this thread');
    }
  }

  /**
   * @throws ForbiddenException if user cannot reply to the thread.
   */
  assertCanReplyToThread(user: IAuthUser, thread: IMessageThread, participants: IThreadParticipant[]): void {
    if (!this.canReplyToThread(user, thread, participants)) {
      throw new ForbiddenException('You do not have permission to reply to this thread');
    }
  }
}
