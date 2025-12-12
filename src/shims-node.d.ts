/* eslint-disable */
// 说明：
// - 这是一个“教学项目用”的最小化 Node 类型声明，避免读者必须先安装 @types/node 才能 `tsc` 编译。
// - 真实项目请改为：`npm i -D @types/node` 并删除本文件。

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf-8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf-8"): Promise<void>;
  export function appendFile(path: string, data: string, encoding: "utf-8"): Promise<void>;
  export function mkdir(path: string, opts: { recursive?: boolean }): Promise<void>;
  export function readdir(
    path: string,
    opts?: { withFileTypes?: boolean }
  ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

declare module "node:path" {
  export const sep: string;
  export function isAbsolute(p: string): boolean;
  export function normalize(p: string): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:child_process" {
  export interface ExecOptions {
    timeout?: number;
    maxBuffer?: number;
  }
  export function exec(
    command: string,
    options: ExecOptions,
    cb: (err: unknown, stdout: string, stderr: string) => void
  ): void;
  export function spawn(
    command: string,
    args?: string[],
    options?: {
      stdio?: ("pipe" | "ignore" | "inherit")[] | "pipe" | "ignore" | "inherit";
      shell?: boolean;
      env?: Record<string, string | undefined>;
    }
  ): {
    pid?: number;
    stdin?: { write(data: string): void };
    stdout?: { on(ev: "data", cb: (chunk: Uint8Array) => void): void };
    stderr?: { on(ev: "data", cb: (chunk: Uint8Array) => void): void };
    on(ev: "close", cb: (code: number | null) => void): void;
    kill(signal?: string): void;
  };
}

declare module "node:util" {
  export function promisify<T extends (...args: any[]) => any>(fn: T): any;
}

declare module "node:os" {
  export function platform(): string;
}

declare module "node:readline/promises" {
  export function createInterface(opts: any): any;
}

declare var process: {
  cwd(): string;
  exit(code?: number): never;
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: any;
  stdin: any;
  stderr: any;
};

interface Buffer {
  length: number;
  slice(start?: number, end?: number): Buffer;
  toString(encoding?: string): string;
  indexOf(value: string | number, byteOffset?: number): number;
}

declare var Buffer: {
  from(data: Uint8Array | string, encoding?: string): Buffer;
  concat(chunks: Buffer[]): Buffer;
  byteLength(text: string, encoding?: string): number;
};
