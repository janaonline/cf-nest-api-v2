export type ApiClientContext = {
  apiClientId: string;
  clientId: string;
  actorType: 'STATE' | 'ULB';
  stateId: string;
  ulbId?: string;
  scopes: string[];
};
