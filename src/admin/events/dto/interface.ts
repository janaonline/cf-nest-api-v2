import { Events } from 'src/schemas/events.schema';

export interface EventReponse {
  success: boolean;
  message: string;
  data: Events | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  success: boolean;
  message: string;
}

// Response DTO for event list items.
export interface EventListItemDto {
  // TODO: Every item from schema.
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
