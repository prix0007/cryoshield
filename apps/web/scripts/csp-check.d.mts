export declare function directives(csp: string): Map<string, string[]>;
export declare function connectSrcViolations(csp: string, expected: readonly string[]): string[];
export declare const JSON_LD_OPEN: string;
export declare function stripJsonLd(html: string): { html: string; blocks: unknown[]; errors: string[] };
