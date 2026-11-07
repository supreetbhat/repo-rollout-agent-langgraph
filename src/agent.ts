import { tool } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent, modelCallLimitMiddleware, modelRetryMiddleware } from "langchain";
import { z } from "zod";
import { rollout } from "./rollout.ts";
import { readRepoFile, runTypecheck, writeRepoFile } from "./tools.ts";

async function safely(action: () => Promise<string>): Promise<string> {
  try {
    return await action();
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

function createRepoTools(repo: string) {
  const readFileTool = tool(
    ({ path }) => safely(() => readRepoFile(repo, path)),
    {
      name: "read_file",
      description: "Read a text file from the current repo and return its contents.",
      schema: z.object({ path: z.string().describe("File path inside the repo") }),
    },
  );

  const writeFileTool = tool(
    ({ path, content }) => safely(() => writeRepoFile(repo, path, content, rollout.files)),
    {
      name: "write_file",
      description: `Replace the full contents of a file. Only ${rollout.files.join(" and ")} can be written.`,
      schema: z.object({
        path: z.string().describe("File path inside the repo"),
        content: z.string().describe("The complete new contents of the file"),
      }),
    },
  );

  const typecheckTool = tool(
    () => safely(async () => (await runTypecheck(repo)).output),
    {
      name: "run_typecheck",
      description: "Run the TypeScript type checker on the repo and return the result.",
      schema: z.object({}),
    },
  );

  return [readFileTool, writeFileTool, typecheckTool];
}

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
});

export async function runRepoAgent(repoPath: string): Promise<number> {
  const agent = createAgent({
    model,
    tools: createRepoTools(repoPath),
    middleware: [
      modelCallLimitMiddleware({ runLimit: 8, exitBehavior: "error" }),
      modelRetryMiddleware({ maxRetries: 2, onFailure: "error" }),
    ],
  });

  const result = await agent.invoke({ messages: [{ role: "user", content: rollout.task }] });

  return result.messages.filter((message) => message.getType() === "ai").length;
}