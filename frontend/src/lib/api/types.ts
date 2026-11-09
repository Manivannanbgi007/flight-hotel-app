/** Paged list response (`?page=0&size=20&sort=...`, API_DOCUMENTATION.md §1). `page` is zero-based. */
export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** Generic `{ message }` body returned by the auth endpoints that must not reveal whether an account exists. */
export interface MessageResponse {
  message: string;
}
