import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export async function writeRepoFile(
  repoPath: string,
  filePath: string,
  content: string,
  allowedFiles: string[],
): Promise<string> {
  const fullPath = safePath(repoPath, filePath);

  if (!allowedFiles.includes(filePath)) {
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

export async function listNewFiles(repoPath: string): Promise<string[]> {
  const { stdout } = await run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoPath });
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3));
}

export async function getDiff(repoPath: string): Promise<string> {
  const { stdout } = await run("git", ["diff"], { cwd: repoPath });
  return stdout;
}

export async function prepareRepo(cloneUrl: string, repoPath: string, branch: string): Promise<void> {
  await rm(repoPath, { recursive: true, force: true });
  await run("git", ["clone", cloneUrl, repoPath]);
  await run("git", ["switch", "-c", branch], { cwd: repoPath });
  await run("npm", ["ci"], { cwd: repoPath });
}

export async function findOpenPullRequest(repo: string, branch: string): Promise<string> {
  const { stdout } = await run("gh", [
    "pr", "list", "--repo", repo, "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url",
  ]);
  return stdout.trim();
}

export async function openPullRequest(
  repoPath: string,
  repo: string,
  branch: string,
  files: string[],
  title: string,
  body: string,
): Promise<string> {
  await run("git", ["add", ...files], { cwd: repoPath });
  await run("git", ["commit", "-m", title], { cwd: repoPath });
  await run("git", ["push", "-u", "origin", branch], { cwd: repoPath });

  const { stdout } = await run(
    "gh",
    ["pr", "create", "--repo", repo, "--base", "main", "--head", branch, "--title", title, "--body", body],
    { cwd: repoPath },
  );

  return stdout.trim();
}