export interface Commodity {
  id: number;
  code: string;
  name: string;
  category?: string;
  tier1?: string;
  tier2?: string;
  tier3?: string;
  baseUOM?: string;
  isActive: boolean;
}
