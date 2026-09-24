/** Response shape for both approve and reject - the one `data[]` entry's post-decision state. */
export interface RequestExemptionDecideResponseData {
  requestId: string;
  formId: number;
  currentFormStatus: number;
  currentFormStatusLabel: string;
}
