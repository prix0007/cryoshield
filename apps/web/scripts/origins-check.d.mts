export interface ListedOrigin {
  origin: string;
  row: number;
  role: string;
  vendor: string;
}
export declare function checkOrigins(
  csp: string,
  inventory: { origins: Record<string, { row: number; role: string; vendor: string }> },
): { listed: ListedOrigin[]; missing: string[] };
