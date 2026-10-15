export interface PracticeSelection {
  subject: string;
  count: number;
}
const prefix = "classnet:phase2:practice:";
export function savePracticeSelection(
  attemptId: number,
  selection: PracticeSelection
) {
  try {
    sessionStorage.setItem(prefix + attemptId, JSON.stringify(selection));
  } catch {
    /* Practice still works when browser storage is unavailable. */
  }
}
export function readPracticeSelection(
  attemptId: string
): PracticeSelection | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(prefix + attemptId) ?? "null"
    );
    return value &&
      typeof value.subject === "string" &&
      value.subject.length < 100 &&
      [5, 10, 20].includes(value.count)
      ? { subject: value.subject, count: value.count }
      : null;
  } catch {
    return null;
  }
}
