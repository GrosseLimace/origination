export interface Note {
  id: number;
  customerId: number;
  customerName: string;
  customerCode?: string;
  tradeUnit?: string;
  content: string;
  isPinned: boolean;
  createdBy: string;
  createdAt: Date;
  modifiedBy?: string;
  modifiedAt?: Date;
}
