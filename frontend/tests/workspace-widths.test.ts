import assert from 'node:assert/strict'
import test from 'node:test'
import { fitWorkspace, initialWidths } from '../src/lib/control-room/workspace-widths.ts'

test('four visibility combinations allocate remaining space to Transcript', () => {
  for (const left of [false, true]) for (const right of [false, true]) {
    const result = fitWorkspace(1068, initialWidths, left, right)
    assert.equal(result.sessions, left ? 260 : 0)
    assert.equal(result.collection, right ? 300 : 0)
    assert.equal(result.sessions + result.collection + result.transcript + 8 * (+left + +right), 1068)
    assert.ok(result.transcript >= 360)
  }
})
test('temporary constraints shrink side panels proportionally without modifying preferred widths', () => {
  const preferred = { sessions: 500, collection: 500 }
  const small = fitWorkspace(1068, preferred, true, true)
  assert.ok(small.sessions >= 220 && small.collection >= 260)
  assert.equal(small.transcript, 360)
  assert.deepEqual(preferred, { sessions: 500, collection: 500 })
  assert.deepEqual(fitWorkspace(1408, preferred, true, true), { sessions: 500, collection: 500, transcript: 392 })
  assert.equal(fitWorkspace(1068, preferred, false, true).collection, 500)
})
test('minimum and fractional widths stay bounded', () => {
  const result = fitWorkspace(900, { sessions: 0, collection: 0 }, true, true)
  assert.deepEqual(result, { sessions: 220, collection: 260, transcript: 404 })
  const fraction = fitWorkspace(1067.5, { sessions: 800, collection: 900 }, true, true)
  assert.ok(Math.abs(fraction.transcript - 360) < 0.001)
})
