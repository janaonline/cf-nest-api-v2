export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Response DTO for event list items.
export interface EventListItemDto {
  // TODO: Every item from schema.
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
