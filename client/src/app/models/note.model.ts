export interface Note {
  id: string;
  customerId: string;
  farmId?: string;
  originatorName: string;
  timestamp: Date;
  content: string;
  pinned: boolean;
}
