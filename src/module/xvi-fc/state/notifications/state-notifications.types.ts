/** One of the five State condition forms, with its raw status code — the UI owns the wording/route. */
export interface StateNotificationForm {
  /** `MOHUA_OVERVIEW_FORMS` key: SFC_STATUS | ELECTED_BODIES | DEVOLUTION | FC_UNSPENT | GTC. */
  key: string;
  statusCode: number;
}

export interface StateNotificationsData {
  forms: StateNotificationForm[];
  /** ULB forms (Audited/Provisional accounts, PFMS bank account, DUR) currently under State review. */
  ulbSubmissionsAwaitingReview: number;
  /** Claim letters MoHUA returned for correction that the State has not yet followed with a newly
   *  submitted letter in the same slot (same installment and batch number). */
  claimLettersReturned: number;
}
