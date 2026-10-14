export interface MohuaUlbFormStatus {
  /** The form's numeric status; null when the ULB has no record for it. */
  statusCode: number | null;
  statusLabel: string;
  /** Whether the ULB has submitted the form to the State (the rule used by every MoHUA count). */
  submitted: boolean;
}

export interface MohuaUlbForms {
  forms: {
    audited: MohuaUlbFormStatus;
    unaudited: MohuaUlbFormStatus;
    pfms: MohuaUlbFormStatus;
    slb: MohuaUlbFormStatus;
    dur: MohuaUlbFormStatus;
  };
}
