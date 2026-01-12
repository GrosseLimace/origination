export interface Note {
  id: string;
  customerId: string;
  farmId?: string;
  createdBy: string;
  createdAt: Date;
  content: string;
  isPinned: boolean;
}
