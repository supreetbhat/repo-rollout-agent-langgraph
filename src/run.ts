import { Command, MemorySaver } from "@langchain/langgraph";
import { createInterface } from "node:readline/promises";
import { workflow } from "./graph.ts";

const REPOS = ["rollout-demo-app-one", "rollout-demo-app-two", "rollout-demo-app-three"];
const graph = workflow.compile({ checkpointer: new MemorySaver() });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const results = [];

for (const repoName of REPOS) {
  console.log(`\n=== ${repoName}`);
  const config = { configurable: { thread_id: repoName } };

  await graph.invoke({ repoName, status: "pending", modelCalls: 0, reason: "", pullRequest: "" }, config);
  let snapshot = await graph.getState(config);

  while (snapshot.next.length > 0) {
    const review = snapshot.tasks[0].interrupts[0].value as { diff: string; newFile: string };
    console.log(review.diff);
    console.log("New file src/tracking.ts:\n" + review.newFile);

    const answer = await terminal.question("Approve this change? (y/n) ");
    const decision = answer.trim().toLowerCase() === "y" ? "approve" : "reject";

    await graph.invoke(new Command({ resume: decision }), config);
    snapshot = await graph.getState(config);
  }

  results.push(snapshot.values);
}

terminal.close();
console.table(results);