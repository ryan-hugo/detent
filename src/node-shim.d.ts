declare module "node:fs" { const value: any; export default value; }
declare module "node:path" { const value: any; export default value; }
declare module "node:os" { const value: any; export default value; }
declare module "node:child_process" {
  export function execFileSync(file: string, args: string[], options: any): string;
}
declare const Buffer: {
  prototype: any;
};
interface Buffer {
  indexOf(value: number, offset?: number): number;
  toString(encoding?: string, start?: number, end?: number): string;
  subarray(start?: number, end?: number): Buffer;
  length: number;
}
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  exitCode?: number;
};
