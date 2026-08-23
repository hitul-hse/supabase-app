export const MULTI_SERVICE_COLUMNS = [
  { key: "DGUV_V2_SIFA", label: "DGUV V2 SiFa" },
  { key: "HS_CONSULTING", label: "H&S Consulting" },
  { key: "BRANDSCHUTZ", label: "Brandschutzbeauftragter" },
  { key: "SIGEKO", label: "SiGeKo" },
  { key: "ENERCON_SIGEKO", label: "ENERCON SiGeKo" },
  { key: "BETRIEBSARZT", label: "Betriebsarzt" },
  { key: "RETEACH_AKADEMIE", label: "Reteach / Akademie" },
] as const;

export type MultiServiceKey = (typeof MULTI_SERVICE_COLUMNS)[number]["key"];
export type MultiServiceUsage = Record<MultiServiceKey, number>;

export type ManagementMultiServiceRow = {
  legalEntityId: string;
  customer: string;
  services: MultiServiceUsage;
  activeServiceCount: number;
  contractHours: number | null;
  projectCount: number;
  possibleMissingServices: MultiServiceKey[];
};

export type ManagementMultiServiceMatrix = {
  rows: ManagementMultiServiceRow[];
  customerMappingAvailable: boolean;
  activeProjectsWithoutCustomerMapping: number | null;
  activeProjectsWithoutServiceMapping: number | null;
  unmappedContractHours: number | null;
};
