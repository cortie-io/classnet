export interface ClassDefinition {
  code: string;
  grade: number;
  label: string;
}
export function groupMatches(
  classCode: string | null | undefined,
  scope: string,
  classes: ClassDefinition[]
) {
  if (scope === "all") return true;
  if (scope === "class:unassigned") return !classCode;
  if (scope.startsWith("class:")) return classCode === scope.slice(6);
  if (scope.startsWith("grade:"))
    return (
      classes.find((c) => c.code === classCode)?.grade ===
      Number(scope.slice(6))
    );
  return false;
}
export function rankingScopeQuery(scope: string) {
  if (scope.startsWith("class:"))
    return "?" + new URLSearchParams({ classCode: scope.slice(6) });
  if (scope.startsWith("grade:"))
    return "?" + new URLSearchParams({ grade: scope.slice(6) });
  return "";
}
