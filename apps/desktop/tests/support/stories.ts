// Story IDs from DESIGN.md (`cpt-noter-seq-…`) found in a test's title path.
export function storyIds(text: string): string[] {
  return [...text.matchAll(/cpt-noter-seq-[a-z0-9-]*[a-z0-9]/g)].map((m) => m[0]);
}
