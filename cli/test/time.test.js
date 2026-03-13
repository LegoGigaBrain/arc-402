const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration } = require('../dist/utils/time');

test('parseDuration supports hours and days', () => {
  const now = Math.floor(Date.now() / 1000);
  const twoHours = parseDuration('2h');
  const sevenDays = parseDuration('7d');
  assert.ok(twoHours > now + 7100 && twoHours < now + 7300);
  assert.ok(sevenDays > now + 604000 && sevenDays < now + 605000);
});
