# Repo Rollout Agent

An agent that rolls out the same code change across several repositories and opens a pull request for each one. It is built in TypeScript with LangChain and LangGraph.

The example change adds app open tracking to small React apps. The apps are not identical, so the agent reads the code in each repository and decides where the change belongs. A fixed text replacement would not work on all of them.

This is a small demonstration of the pattern. It runs against three public test repositories, and the tracking function only writes to the console.

## How it works

Each repository goes through the same LangGraph workflow, one step at a time:

1. `clone_repo` stops if a pull request is already open. Otherwise it clones the repository, creates a branch and installs the packages.
2. `baseline_check` runs the type checker. A repository that already has type errors is skipped, so the agent is never blamed for an existing problem.
3. `run_agent` runs the LangChain agent, which reads files, writes the change and runs the type checker until it passes.
4. `final_check` runs the type checker again and confirms that only the expected files changed. The agent saying it is finished is not treated as proof.
5. `human_review` pauses the workflow and shows the diff for a person to approve or reject.
6. `open_pull_request` commits the expected files, pushes the branch and opens the pull request. It only runs after approval.

Every repository ends with one of three results:

* `changed`: the pull request was opened.
* `skipped`: there was nothing safe to do, such as when a type error already existed.
* `stuck`: something failed or the change was rejected, so a person needs to look at it.

## Safety rules

The rules are enforced in code and not left to the prompt:

* The file tools refuse any path outside the repository being worked on.
* The write tool can only change the files listed in `src/rollout.ts`.
* The model has no Git or GitHub tool, so it cannot push anything. Fixed code does that after a person approves.
* Middleware limits each agent run to 8 model calls and retries failed model calls.

## Recovering from a crash

Progress is saved to a local SQLite file by a LangGraph checkpointer. If the program stops, running it again with the same run name continues from the last saved step. Work that already finished is not repeated, including model calls.

A run stopped at the approval question goes straight back to that question. If the program stops during a step, that step starts again from its beginning.

## Project structure

* `src/rollout.ts` describes the rollout: the task for the model, the files it may change, the branch, the pull request text and the repositories.
* `src/graph.ts` defines the workflow and its checks.
* `src/agent.ts` creates the LangChain agent, its tools and its middleware.
* `src/tools.ts` holds the plain functions for files, the type checker, Git and GitHub.
* `src/run.ts` runs every repository, asks for approval and prints the results.

## Running it

You need Node, Git, the GitHub command line tool signed in to your account, and a Gemini API key.

1. Run `npm install`.
2. Create a `.env` file containing `GEMINI_API_KEY=your_key`, `GITHUB_OWNER=your_github_name` and `ROLLOUT_WORKSPACE=/folder/where/repos/are/cloned`.
3. Change the repository names in `src/rollout.ts` to repositories in your account.
4. Run `npm start`. Pass a run name as the first argument to `src/run.ts` to keep separate runs apart.

To roll out a different change, edit `src/rollout.ts` only. Give the new rollout its own branch name, because a repository with an open pull request on that branch is skipped.

To see traces in LangSmith, add `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` to `.env`. To open the workflow in LangGraph Studio, run `npm run studio`.

## Known limits

* The only automated code check is the type checker. It cannot prove that the tracking fires when an app runs. A real rollout would also rely on each repository's tests and CI.
* Repositories run one after another, which would be slow across hundreds of them.
* SQLite suits one computer. Several machines sharing a rollout would need a shared store such as Postgres.
* The rollout is a TypeScript file, so changing it means editing code. Loading it from a JSON file named on the command line would remove that step.
