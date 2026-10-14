import assert from "node:assert/strict";
import {test} from "node:test";
import {adminPeriodUrl} from "./admin-period";
test("admin queries carry explicit period and preserve pagination; student requests cannot select archive",()=>{
  assert.equal(adminPeriodUrl('/api/admin/users/2/history?beforeId=15','1'),'/api/admin/users/2/history?beforeId=15&period=1');
  assert.equal(adminPeriodUrl('/api/audit?offset=50','1'),'/api/audit?offset=50&period=1');
  assert.equal(adminPeriodUrl('/api/audit-summary/stats','2'),'/api/audit-summary/stats?period=2');
  assert.equal(adminPeriodUrl('/api/history','1'),'/api/history');
  assert.equal(adminPeriodUrl('/api/exam/attempts','1'),'/api/exam/attempts');
});
