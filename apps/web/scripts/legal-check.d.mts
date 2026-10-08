export declare const STORAGE_APIS: string[];
export declare function checkNoPlaceholders(text: string, name: string): string[];
export declare function unlistedStorageApis(js: string, inventory: { apis: string[] }): string[];
export declare function storageApiOutsideAllowedFiles(files: Record<string, string>, inventory: { apis: string[]; apiFiles?: Record<string, string> }, referenced?: string[]): string[];
