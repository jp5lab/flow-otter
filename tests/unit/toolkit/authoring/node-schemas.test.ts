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

describe('tls-config node schema (Node-RED 5.0 certificate modes)', () => {
  const schema = getNodeSchema('tls-config')!;

  it('has a registered schema', () => {
    expect(hasNodeSchema('tls-config')).toBe(true);
  });

  it('accepts pfx certificate config', () => {
    const parsed = schema.safeParse({
      certType: 'pfx',
      p12: '/certs/client.p12',
      p12name: 'client.p12',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts env-var certificate config', () => {
    const parsed = schema.safeParse({
      certType: 'env',
      certEnv: 'TLS_CERT',
      keyEnv: 'TLS_KEY',
      caEnv: 'TLS_CA',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts SNI, server certificate verification, and ALPN fields', () => {
    const out = schema.parse({
      servername: 'mqtt.example.test',
      verifyservercert: false,
      alpnprotocol: 'h2,http/1.1',
    }) as Record<string, unknown>;

    expect(out['servername']).toBe('mqtt.example.test');
    expect(out['verifyservercert']).toBe(false);
    expect(out['alpnprotocol']).toBe('h2,http/1.1');
  });

  it('rejects invalid certType values', () => {
    for (const certType of ['file', 'pkcs12']) {
      expect(schema.safeParse({ certType }).success, certType).toBe(false);
    }
  });

  it('materializes editor defaults from an empty config', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    expect(out).toMatchObject({
      name: '',
      certType: 'files',
      cert: '',
      key: '',
      ca: '',
      certname: '',
      keyname: '',
      caname: '',
      p12: '',
      p12name: '',
      certEnv: '',
      keyEnv: '',
      caEnv: '',
      servername: '',
      verifyservercert: true,
      alpnprotocol: '',
    });
  });

  it('does not materialize credential fields', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    for (const field of ['certdata', 'keydata', 'cadata', 'p12data', 'passphrase']) {
      expect(out[field], field).toBeUndefined();
    }
  });
});
