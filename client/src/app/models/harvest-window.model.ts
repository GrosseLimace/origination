export interface HarvestWindow {
  id: number;
  commodity: string;
  deliveryStartMonth: number;
  deliveryStartDay: number;
  deliveryEndMonth: number;
  deliveryEndDay: number;
  isActive: boolean;
}
