/**
 * Bundle verification: the served client.js must carry the rebuilt game's
 * load-bearing markers, and none of the old dead architecture.
 */
import fs from 'node:fs'
import assert from 'node:assert'

const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const MUST = [
  // Reference-faithful core
  ['precomputed bullet polyline', 'function bulletPath'],
  ['wall.py wall rects', 'function buildWalls'],
  ['Prim maze port', 'function generateMaze'],
  ['reference movement constants', 'const ROTATION_SPEED = 5;'],
  ['reference bullet constants', 'const BULLET_SPEED = 2.2;'],
  // Control scheme (locked)
  ['LMB forward / RMB back pedals', 'buttonsRef.current.l'],
  ['space fires', "event.code === 'Space'"],
  ['middle button mines', 'event.button === 1'],
  ['fixed barrel: aim is steer', 'aim IS steer'],
  // AI
  ['AI bank-shot scan', 'function findBankShot'],
  ['AI BFS hunt', 'function bfsPath'],
  ['simple stuck back-off', 'AI_BACK_TIME'],
  // Panel contract
  ['standard panel entry', "slots.inject('sidebar.panellist'"],
  ['main panel keyed to entry', "key: PANEL_ID"],
]

const BANNED = [
  ['old watchdog patch stack', 'watchStall'],
  ['old yield system', 'yieldUntil'],
  ['old patrol commit', 'AI_PATROL_TTL'],
  ['old solver cache', 'bankAim'],
  ['old turret slew', 'AI_TURRET_SLEW'],
  ['stale driver names', 'chaseIntent'],
]

for (const [label, needle] of MUST) {
  assert.ok(client.includes(needle), 'missing: ' + label)
}
for (const [label, needle] of BANNED) {
  assert.ok(!client.includes(needle), 'banned marker present: ' + label)
}
console.log('PASS ' + MUST.length + ' markers present, ' + BANNED.length + ' stale markers absent')