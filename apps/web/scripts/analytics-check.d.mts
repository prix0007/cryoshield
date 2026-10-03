export declare const ALLOWED_LANDING_EXTRAS: Record<string, string[]>;
export declare function landingCspDiff(appCsp: string, landingCsp: string): string[];
export declare function analyticsLeaks(files: Record<string, string>, token?: string): string[];
export declare function policyDrift(pages: Record<string, string>): string[];
