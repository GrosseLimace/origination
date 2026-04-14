export interface QueryLibraryItem {
  id: number;
  category: string;
  name: string;
  description?: string;
  queryText: string;
  tags?: string;
  sortOrder: number;
}
