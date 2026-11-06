import { graph } from "./graph.ts";

const REPOS = ["app-one", "app-two", "app-three"];
const results = [];

for (const repoName of REPOS) {
  console.log(`=== ${repoName}`);
  results.push(await graph.invoke({ repoName, status: "pending", modelCalls: 0, reason: "" }));
}

console.table(results);