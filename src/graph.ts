import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import { runRepoAgent } from "./agent.ts";
import { getDiff, listChangedFiles, readRepoFile, runTypecheck } from "./tools.ts";

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

   return {};
}

async function humanReview(state: State): Promise<Partial<State>> {
  const repoPath = pathFor(state);
  const diff = await getDiff(repoPath);
  const newFile = await readRepoFile(repoPath, "src/tracking.ts");

  const decision = interrupt({ repo: state.repoName, diff, newFile });

  if (decision === "approve") {
    return { status: "changed", reason: "Approved by a human" };
  }

  return { status: "stuck", reason: "Rejected by a human, changes left for inspection" };
}

function continueUnlessStopped(state: State) {
  return state.status === "pending" ? "continue" : "stop";
}

export const workflow = new StateGraph(RepoState)
  .addNode("baseline_check", baselineCheck)
  .addNode("run_agent", agentStep)
  .addNode("final_check", finalCheck)
  .addNode("human_review", humanReview)
  .addEdge(START, "baseline_check")
  .addConditionalEdges("baseline_check", continueUnlessStopped, { continue: "run_agent", stop: END })
  .addConditionalEdges("run_agent", continueUnlessStopped, { continue: "final_check", stop: END })
  .addConditionalEdges("final_check", continueUnlessStopped, { continue: "human_review", stop: END })
  .addEdge("human_review", END);

export const graph = workflow.compile();

