import { describe, expect, it } from 'vitest';

import {
  getNodeSchema,
  hasNodeSchema,
  knownNodeTypes,
} from '../../../../src/toolkit/authoring/node-schemas.js';

describe('common-node schemas (eval finding #11: generic add_node had no schemas for these)', () => {
  const COMMON_TYPES = [
    'inject',
    'debug',
    'function',
    'mqtt in',
    'mqtt out',
    'link in',
    'link out',
    'link call',
    'catch',
    'status',
    'complete',
  ];

  it('every common type now has a registered schema', () => {
    for (const t of COMMON_TYPES) {
      expect(hasNodeSchema(t), `expected schema for '${t}'`).toBe(true);
    }
    expect(knownNodeTypes().length).toBeGreaterThanOrEqual(26);
  });

  it('inject defaults materialize runtime-required fields from an empty config', () => {
    const out = getNodeSchema('inject')!.parse({}) as Record<string, unknown>;
    expect(out['repeat']).toBe(''); // runtime rejects inject without `repeat`
    expect(out['props']).toEqual([]);
    expect(out['payloadType']).toBe('date');
  });

  it('complete defaults materialize a scope array (editor crashes without one)', () => {
    const out = getNodeSchema('complete')!.parse({}) as Record<string, unknown>;
    expect(out['scope']).toEqual([]);
  });

  it('link call rejects an invalid linkType but defaults to static', () => {
    expect(getNodeSchema('link call')!.safeParse({ linkType: 'telepathic' }).success).toBe(false);
    const out = getNodeSchema('link call')!.parse({}) as Record<string, unknown>;
    expect(out['linkType']).toBe('static');
    expect(out['links']).toEqual([]);
  });

  it('existing valid configs still parse (schemas are passthrough + optional)', () => {
    const mqtt = getNodeSchema('mqtt in')!.safeParse({
      topic: 'lab/in',
      qos: '0',
      datatype: 'auto',
      broker: 'b1',
      customField: 42,
    });
    expect(mqtt.success).toBe(true);
  });
});

describe('delay node schema (Node-RED 5.0 burst mode)', () => {
  const schema = getNodeSchema('delay')!;

  it('accepts pauseType "burst" (added in Node-RED 5.0.0-beta.2, PR #5391)', () => {
    const parsed = schema.safeParse({
      pauseType: 'burst',
      rate: 10,
      nbRateUnits: 1,
      rateUnits: 'second',
      drop: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts the pre-5.0 pauseType values', () => {
    for (const pauseType of [
      'delay',
      'random',
      'rate',
      'queue',
      'timed',
      'delayv',
      'randomFirst',
    ]) {
      expect(schema.safeParse({ pauseType }).success).toBe(true);
    }
  });

  it('rejects unknown pauseType values', () => {
    expect(schema.safeParse({ pauseType: 'surge' }).success).toBe(false);
  });

  it('delay has a registered schema', () => {
    expect(hasNodeSchema('delay')).toBe(true);
  });
});
