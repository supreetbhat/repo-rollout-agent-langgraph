import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createInterface } from "node:readline/promises";
import { workflow } from "./graph.ts";

const REPOS = ["rollout-demo-app-one", "rollout-demo-app-two", "rollout-demo-app-three"];
const RUN_ID = process.argv[2] ?? "run-1";
const graph = workflow.compile({ checkpointer: SqliteSaver.fromConnString("rollout.sqlite") });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const results = [];

for (const repoName of REPOS) {
  console.log(`\n=== ${repoName}`);
  const config = { configurable: { thread_id: `${RUN_ID}:${repoName}` } };

  let snapshot = await graph.getState(config);
  const started = Object.keys(snapshot.values).length > 0;
  const paused = snapshot.tasks.some((task) => task.interrupts.length > 0);

  if (!started) {
    await graph.invoke({ repoName, status: "pending", modelCalls: 0, reason: "", pullRequest: "" }, config);
  } else if (snapshot.next.length > 0 && !paused) {
    console.log("Resuming after a crash");
    await graph.invoke(null, config);
  }

  snapshot = await graph.getState(config);

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