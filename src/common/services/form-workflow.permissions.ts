import { ForbiddenException, Injectable } from '@nestjs/common';
import { IFormSubmission } from '../../forms/interfaces/form-submission.interface';
import { Role } from '../../module/auth/enum/role.enum';
import { FORM_STATUS } from '../constants/form-status.constants';
import { IAuthUser } from '../interfaces/auth-user.interface';

const ULB_EDITABLE_STATUSES: readonly number[] = [
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

const ULB_SUBMITTABLE_STATUSES: readonly number[] = [
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

@Injectable()
export class FormWorkflowPermissions {
  /**
   * Checks if user can view the form submission.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user is ADMIN/MoHUA/PMU, or belongs to the form's state/ULB.
   */
  canViewFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role === Role.ADMIN || user.role === Role.MoHUA) {
      return true;
    }
    if (user.role === Role.STATE) {
      return !!user.state && !!formSubmission.stateId && user.state.toString() === formSubmission.stateId.toString();
    }
    if (user.role === Role.ULB) {
      return !!user.ulb && !!formSubmission.ulbId && user.ulb.toString() === formSubmission.ulbId.toString();
    }
    return false;
  }

  /**
   * Checks if user can edit the form submission.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user is the ULB owner and form is in an editable status.
   */
  canEditFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role !== Role.ULB || !user.ulb || !formSubmission.ulbId) return false;
    if (user.ulb.toString() !== formSubmission.ulbId.toString()) return false;
    return ULB_EDITABLE_STATUSES.includes(formSubmission.currentFormStatus);
  }

  /**
   * Checks if user can submit the form to State for review.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user is the ULB owner and form is in a submittable status.
   */
  canSubmitFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role !== Role.ULB || !user.ulb || !formSubmission.ulbId) return false;
    if (user.ulb.toString() !== formSubmission.ulbId.toString()) return false;
    return ULB_SUBMITTABLE_STATUSES.includes(formSubmission.currentFormStatus);
  }

  /**
   * Checks if user can return the form with remarks.
   * STATE users can return when form is UNDER_REVIEW_BY_STATE; MoHUA/ADMIN when UNDER_REVIEW_BY_MOHUA.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user's role and the form's current status permit a return action.
   */
  canReturnFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role === Role.STATE) {
      return (
        !!user.state &&
        !!formSubmission.stateId &&
        user.state.toString() === formSubmission.stateId.toString() &&
        formSubmission.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_STATE
      );
    }
    if (user.role === Role.MoHUA || user.role === Role.ADMIN) {
      return formSubmission.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    }
    return false;
  }

  /**
   * Checks if user can approve the form to move to MoHUA review.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user is STATE owner (or ADMIN) and form is UNDER_REVIEW_BY_STATE.
   */
  canApproveFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role === Role.STATE) {
      return (
        !!user.state &&
        !!formSubmission.stateId &&
        user.state.toString() === formSubmission.stateId.toString() &&
        formSubmission.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_STATE
      );
    }
    if (user.role === Role.ADMIN) {
      return formSubmission.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_STATE;
    }
    return false;
  }

  /**
   * Checks if user can acknowledge the form in MoHUA review stage.
   * @param user Authenticated user.
   * @param formSubmission Form to check access for.
   * @returns True if user is MoHUA/ADMIN and form is UNDER_REVIEW_BY_MOHUA.
   */
  canAcknowledgeFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): boolean {
    if (user.role !== Role.MoHUA && user.role !== Role.ADMIN) return false;
    return formSubmission.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
  }

  /**
   * @throws ForbiddenException if user cannot view the form submission.
   */
  assertCanViewFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canViewFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to view this form submission');
    }
  }

  /**
   * @throws ForbiddenException if user cannot edit the form submission.
   */
  assertCanEditFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canEditFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to edit this form submission');
    }
  }

  /**
   * @throws ForbiddenException if user cannot submit the form submission.
   */
  assertCanSubmitFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canSubmitFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to submit this form submission');
    }
  }

  /**
   * @throws ForbiddenException if user cannot return the form submission.
   */
  assertCanReturnFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canReturnFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to return this form submission');
    }
  }

  /**
   * @throws ForbiddenException if user cannot approve the form submission.
   */
  assertCanApproveFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canApproveFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to approve this form submission');
    }
  }

  /**
   * @throws ForbiddenException if user cannot acknowledge the form submission.
   */
  assertCanAcknowledgeFormSubmission(user: IAuthUser, formSubmission: IFormSubmission): void {
    if (!this.canAcknowledgeFormSubmission(user, formSubmission)) {
      throw new ForbiddenException('You do not have permission to acknowledge this form submission');
    }
  }
}
