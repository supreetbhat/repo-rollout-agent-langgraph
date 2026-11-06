import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { runRepoAgent } from "./agent.ts";
import { listChangedFiles, runTypecheck } from "./tools.ts";

const TARGETS = "/Users/supreetbhat/Code/TypeScriptAgents/repo-rollout-targets";
const EXPECTED_CHANGES = ["src/main.tsx", "src/tracking.ts"];

type RepoStatus = "pending" | "changed" | "skipped" | "stuck";

const RepoState = Annotation.Root({
  repoName: Annotation<string>,
  status: Annotation<RepoStatus>,
  modelCalls: Annotation<number>,
  reason: Annotation<string>,
});

type State = typeof RepoState.State;

function pathFor(state: State): string {
  return `${TARGETS}/${state.repoName}`;
}

async function baselineCheck(state: State): Promise<Partial<State>> {
  const startingChanges = await listChangedFiles(pathFor(state));
  if (startingChanges.length > 0) {
    return { status: "skipped", reason: "Already has uncommitted changes" };
  }

  const check = await runTypecheck(pathFor(state));
  if (!check.passed) {
    return { status: "skipped", reason: "Type errors before the agent started" };
  }

  return {};
}

async function agentStep(state: State): Promise<Partial<State>> {
  try {
    const modelCalls = await runRepoAgent(pathFor(state));
    return { modelCalls };
  } catch (error) {
    return { status: "stuck", reason: (error as Error).message };
  }
}

async function finalCheck(state: State): Promise<Partial<State>> {
  const check = await runTypecheck(pathFor(state));
  if (!check.passed) {
    return { status: "stuck", reason: "Type errors after the agent finished" };
  }

  const changed = await listChangedFiles(pathFor(state));
  const expectedOnly =
    changed.length === EXPECTED_CHANGES.length &&
    EXPECTED_CHANGES.every((file) => changed.includes(file));

  if (!expectedOnly) {
    return { status: "stuck", reason: `Wrong files changed: ${changed.join(", ")}` };
  }

  return { status: "changed", reason: "Passed the final checks" };
}

function continueUnlessStopped(state: State) {
  return state.status === "pending" ? "continue" : "stop";
}

export const graph = new StateGraph(RepoState)
  .addNode("baseline_check", baselineCheck)
  .addNode("run_agent", agentStep)
  .addNode("final_check", finalCheck)
  .addEdge(START, "baseline_check")
  .addConditionalEdges("baseline_check", continueUnlessStopped, { continue: "run_agent", stop: END })
  .addConditionalEdges("run_agent", continueUnlessStopped, { continue: "final_check", stop: END })
  .addEdge("final_check", END)
  .compile();

