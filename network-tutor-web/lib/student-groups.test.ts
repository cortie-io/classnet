import assert from "node:assert/strict";
import { test } from "node:test";
import { groupMatches, rankingScopeQuery } from "./student-groups";
test("group filters distinguish grade1 sections, other grades, unassigned and overall", () => {
  const classes = [
    { code: "1-A", grade: 1, label: "A" },
    { code: "1-B", grade: 1, label: "B" },
    { code: "2", grade: 2, label: "2" },
  ];
  assert.ok(groupMatches("1-B", "grade:1", classes));
  assert.ok(!groupMatches("2", "grade:1", classes));
  assert.ok(!groupMatches("1-B", "class:1-A", classes));
  assert.ok(groupMatches(null, "class:unassigned", classes));
  assert.ok(groupMatches(null, "all", classes));
  assert.equal(rankingScopeQuery("grade:1"), "?grade=1");
  assert.equal(rankingScopeQuery("class:1-A"), "?classCode=1-A");
});
