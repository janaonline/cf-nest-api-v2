export interface UnsubscribePayload {
  email: string;
  desc: string;
}

export interface EmailResInterface {
  success: boolean;
  message: string;
  isUnsubscribed: boolean;
  isVerified: boolean;
}
