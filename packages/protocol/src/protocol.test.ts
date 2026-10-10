import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from './index.ts';

const input = { type: 'input', version: 1, sessionId: '12345678-1234-1234-1234-123456789abc', sequence: 0, movement: { x: 1, y: 1 } };
describe('strict input protocol', () => {
  it('accepts intent and diagonals', () => expect(parseClientMessage(JSON.stringify(input))).toEqual(input));
  it.each(['{}', 'null', '[]', 'invalid', '{"type":"input"}', 'x'.repeat(8193)])('rejects malformed data', raw => expect(parseClientMessage(raw)).toBeNull());
  it.each([
    { ...input, position: { x: 500, y: 500 } },
    { ...input, playerId: 'someone-else' },
    { ...input, score: 999999 },
    { ...input, coreId: 'core-1' },
    { ...input, multiplier: 3 },
    { ...input, type: 'collect', coreId: 'core-1' },
    { ...input, version: 2 },
    { ...input, sequence: -1 },
    { ...input, sequence: 1.5 },
    { ...input, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, sessionId: 'fake' },
    { ...input, movement: { x: 2, y: 0 } },
    { ...input, movement: { x: null, y: 0 } },
    { ...input, movement: { x: '1', y: 0 } },
    { ...input, movement: { x: 1, y: 0, dt: 100 } },
  ])('rejects invalid or extra fields', value => expect(parseClientMessage(JSON.stringify(value))).toBeNull());
  it('rejects overflowing numeric values', () => expect(parseClientMessage(JSON.stringify(input).replace('"x":1', '"x":1e999'))).toBeNull());
  it('validates authentication envelope', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 't'.repeat(40) }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'authenticate', version: 1, accessToken: 'short' }))).toBeNull();
  });
  it('rejects malformed snapshots', () => {
    expect(parseServerMessage('{"type":"snapshot","version":1,"players":[]}')).toBeNull();
    expect(parseServerMessage('not json')).toBeNull();
  });
});

it('validates gameplay snapshots and rejects malformed scores, cores and event ordering', () => {
  const snapshot = { type: 'snapshot', version: 1, epoch: input.sessionId, tick: 10, players: [],
    gameplay: { tick: 10, cores: [{ id: 'core-1', position: { x: 20, y: 20 }, active: false }],
      scores: [{ id: input.sessionId, score: 100, combo: 1, multiplier: 1, comboExpiresAtTick: 160 }],
      events: [{ sequence: 1, tick: 10, coreId: 'core-1', playerId: input.sessionId, position: { x: 20, y: 20 }, points: 100, multiplier: 1 }] } };
  expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  for (const gameplay of [
    { ...snapshot.gameplay, scores: [{ ...snapshot.gameplay.scores[0], score: -1 }] },
    { ...snapshot.gameplay, scores: [{ ...snapshot.gameplay.scores[0], multiplier: 4 }] },
    { ...snapshot.gameplay, cores: [...snapshot.gameplay.cores, ...snapshot.gameplay.cores] },
    { ...snapshot.gameplay, events: [...snapshot.gameplay.events, ...snapshot.gameplay.events] },
    { ...snapshot.gameplay, events: [{ ...snapshot.gameplay.events[0], points: 99999 }] },
  ]) expect(parseServerMessage(JSON.stringify({ ...snapshot, gameplay }))).toBeNull();
});
