export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}
export interface EventListItemDto {
  // TODO: Every item from schema.
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
