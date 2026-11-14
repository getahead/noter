import { storyIds } from "./stories";

interface CoverageTask {
  name: string;
  mode: string;
  result?: { errors?: unknown[] };
  suite?: CoverageTask;
}

export function storiesForCoverage(task: CoverageTask): string[] {
  if (task.result?.errors?.length) return [];

  const names: string[] = [];
  for (let current: CoverageTask | undefined = task; current; current = current.suite) {
    if (current.mode !== "run") return [];
    names.push(current.name);
  }
  return storyIds(names.join(" "));
}
