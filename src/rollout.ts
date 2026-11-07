// Everything that describes one rollout lives here. To roll out a different
// change, edit this file only.

export const rollout = {
  task: `Add app open tracking to this React app.
1. Read src/main.tsx first, because the code may differ between repos.
2. Create src/tracking.ts exporting a function trackAppOpened(): void that calls console.log("app_opened").
3. Update src/main.tsx to import it from "./tracking.ts" and call it once when the app starts. Keep everything else as it is.
4. Run run_typecheck. If there are errors, fix them and run it again.
5. When the type check passes, stop and summarise what you changed.`,

  // The only files the agent may write, and exactly the files that must change.
  files: ["src/main.tsx", "src/tracking.ts"],

  branch: "add-app-open-tracking",
  title: "Add app open tracking",
  body: "Adds src/tracking.ts and calls trackAppOpened once at startup. Opened by a rollout agent after automated checks and human review.",

  repos: ["rollout-demo-app-one", "rollout-demo-app-two", "rollout-demo-app-three"],
};

// These describe your machine and account, not the change, so they come from .env.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

export const OWNER = required("GITHUB_OWNER");
export const WORKSPACE = required("ROLLOUT_WORKSPACE");
