/** Minimal document shape required by XvifcFormActorsService. Both SFC and EULB lean docs satisfy this. */
export interface XvifcActorSourceDocument {
  state?: unknown;
  createdBy?: unknown;
  updatedBy?: unknown;
  submittedBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
}

export interface XvifcFormActor {
  action: 'Created by' | 'Updated by' | 'Submitted by';
  by: string | null;
  date: string | null;
  designation: string;
}

export interface XvifcFormActorsResult {
  actors: XvifcFormActor[];
  stateName: string;
}
