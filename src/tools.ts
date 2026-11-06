import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ALLOWED_WRITES = ["src/main.tsx", "src/tracking.ts"];
const run = promisify(execFile);

function safePath(repoPath: string, filePath: string): string {
  const root = resolve(repoPath);
  const fullPath = resolve(root, filePath);

  if (!fullPath.startsWith(root + sep)) {
    throw new Error(`Path is outside the repo: ${filePath}`);
  }

  return fullPath;
}

export async function readRepoFile(repoPath: string, filePath: string): Promise<string> {
  return await readFile(safePath(repoPath, filePath), "utf8");
}

export async function writeRepoFile(repoPath: string, filePath: string, content: string): Promise<string> {
  const fullPath = safePath(repoPath, filePath);

  if (!ALLOWED_WRITES.includes(filePath)) {
    throw new Error(`Not allowed to change: ${filePath}`);
  }

  await writeFile(fullPath, content, "utf8");
  return `Saved ${filePath}`;
}

interface TypecheckResult {
  passed: boolean;
  output: string;
}

export async function runTypecheck(repoPath: string): Promise<TypecheckResult> {
  try {
    await run("npx", ["tsc", "--noEmit"], { cwd: repoPath });
    return { passed: true, output: "No type errors" };
  } catch (error) {
    const failure = error as { stdout?: string; message: string };
    return { passed: false, output: failure.stdout || failure.message };
  }
}

export async function listChangedFiles(repoPath: string): Promise<string[]> {
  const { stdout } = await run("git", ["status", "--porcelain"], { cwd: repoPath });
  return stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
}