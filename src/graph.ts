import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import { runRepoAgent } from "./agent.ts";
import { OWNER, rollout, WORKSPACE } from "./rollout.ts";
import {
  findOpenPullRequest,
  getDiff,
  listChangedFiles,
  listNewFiles,
  openPullRequest,
  prepareRepo,
  readRepoFile,
  runTypecheck,
} from "./tools.ts";

type RepoStatus = "pending" | "changed" | "skipped" | "stuck";

const RepoState = Annotation.Root({
  repoName: Annotation<string>,
  status: Annotation<RepoStatus>,
  modelCalls: Annotation<number>,
  reason: Annotation<string>,
  pullRequest: Annotation<string>,
});

type State = typeof RepoState.State;

function pathFor(state: State): string {
  return `${WORKSPACE}/${state.repoName}`;
}

function fullName(state: State): string {
  return `${OWNER}/${state.repoName}`;
}

async function cloneRepo(state: State): Promise<Partial<State>> {
  try {
    const existing = await findOpenPullRequest(fullName(state), rollout.branch);
    if (existing) {
      return { status: "skipped", reason: "Pull request already open", pullRequest: existing };
    }

    await prepareRepo(`https://github.com/${fullName(state)}.git`, pathFor(state), rollout.branch);
    return {};
  } catch (error) {
    return { status: "stuck", reason: `Could not prepare the repo: ${(error as Error).message}` };
  }
}

async function baselineCheck(state: State): Promise<Partial<State>> {
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
    changed.length === rollout.files.length &&
    rollout.files.every((file) => changed.includes(file));

  if (!expectedOnly) {
    return { status: "stuck", reason: `Wrong files changed: ${changed.join(", ")}` };
  }

  return {};
}

async function humanReview(state: State): Promise<Partial<State>> {
  const repoPath = pathFor(state);
  const diff = await getDiff(repoPath);

  // git diff leaves out files that did not exist before, so show those in full.
  const newFiles: { path: string; content: string }[] = [];
  for (const path of await listNewFiles(repoPath)) {
    newFiles.push({ path, content: await readRepoFile(repoPath, path) });
  }

  const decision = interrupt({ repo: state.repoName, diff, newFiles });

  if (decision === "approve") {
    return {};
  }

  return { status: "stuck", reason: "Rejected by a human, no pull request opened" };
}

async function publishChange(state: State): Promise<Partial<State>> {
  try {
    const pullRequest = await openPullRequest(
      pathFor(state),
      fullName(state),
      rollout.branch,
      rollout.files,
      rollout.title,
      rollout.body,
    );
    return { status: "changed", reason: "Pull request opened", pullRequest };
  } catch (error) {
    return { status: "stuck", reason: `Could not open the pull request: ${(error as Error).message}` };
  }
}

function continueUnlessStopped(state: State) {
  return state.status === "pending" ? "continue" : "stop";
}

export const workflow = new StateGraph(RepoState)
  .addNode("clone_repo", cloneRepo)
  .addNode("baseline_check", baselineCheck)
  .addNode("run_agent", agentStep)
  .addNode("final_check", finalCheck)
  .addNode("human_review", humanReview)
  .addNode("open_pull_request", publishChange)
  .addEdge(START, "clone_repo")
  .addConditionalEdges("clone_repo", continueUnlessStopped, { continue: "baseline_check", stop: END })
  .addConditionalEdges("baseline_check", continueUnlessStopped, { continue: "run_agent", stop: END })
  .addConditionalEdges("run_agent", continueUnlessStopped, { continue: "final_check", stop: END })
  .addConditionalEdges("final_check", continueUnlessStopped, { continue: "human_review", stop: END })
  .addConditionalEdges("human_review", continueUnlessStopped, { continue: "open_pull_request", stop: END })
  .addEdge("open_pull_request", END);

export const graph = workflow.compile();