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

describe('mqtt in node schema (Node-RED 5.0 MQTT v5 fields)', () => {
  const schema = getNodeSchema('mqtt in')!;

  it('accepts MQTT v5 subscription booleans', () => {
    const out = schema.parse({ nl: true, rap: false }) as Record<string, unknown>;

    expect(out['nl']).toBe(true);
    expect(out['rap']).toBe(false);
  });

  it('accepts retain-handling number/string values and rejects unknown values', () => {
    expect(schema.safeParse({ rh: 0 }).success).toBe(true);
    expect(schema.safeParse({ rh: '1' }).success).toBe(true);
    expect(schema.safeParse({ rh: 3 }).success).toBe(false);
    expect(schema.safeParse({ rh: '3' }).success).toBe(false);
  });

  it('accepts only persisted dynamic-subscription input counts', () => {
    expect(schema.safeParse({ inputs: 0 }).success).toBe(true);
    expect(schema.safeParse({ inputs: 1 }).success).toBe(true);
    expect(schema.safeParse({ inputs: 2 }).success).toBe(false);
  });

  it('materializes MQTT v5 defaults without subscriptionIdentifier', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    expect(out).toMatchObject({
      nl: false,
      rap: true,
      rh: 0,
      inputs: 0,
    });
    expect(out['subscriptionIdentifier']).toBeUndefined();
  });
});

describe('mqtt out node schema (Node-RED 5.0 MQTT v5 fields)', () => {
  const schema = getNodeSchema('mqtt out')!;

  it('accepts MQTT v5 publish fields', () => {
    const out = schema.parse({
      respTopic: 'reply/topic',
      contentType: 'application/json',
      correl: 'abc123',
      expiry: '60',
      userProps: '{"source":"unit"}',
    }) as Record<string, unknown>;

    expect(out).toMatchObject({
      respTopic: 'reply/topic',
      contentType: 'application/json',
      correl: 'abc123',
      expiry: '60',
      userProps: '{"source":"unit"}',
    });
  });

  it('materializes MQTT v5 publish defaults', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    expect(out).toMatchObject({
      respTopic: '',
      contentType: '',
      correl: '',
      expiry: '',
      userProps: '',
    });
  });
});

describe('mqtt-broker config-node schema', () => {
  const schema = getNodeSchema('mqtt-broker')!;

  it('has a registered schema', () => {
    expect(hasNodeSchema('mqtt-broker')).toBe(true);
  });

  it('accepts MQTT 5 protocolVersion values and rejects unknown versions', () => {
    expect(schema.safeParse({ protocolVersion: 5 }).success).toBe(true);
    expect(schema.safeParse({ protocolVersion: '5' }).success).toBe(true);
    expect(schema.safeParse({ protocolVersion: 6 }).success).toBe(false);
  });

  it('materializes birth, close, and will defaults', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    expect(out).toMatchObject({
      birthTopic: '',
      birthQos: '0',
      birthRetain: 'false',
      birthPayload: '',
      birthMsg: {},
      closeTopic: '',
      closeQos: '0',
      closeRetain: 'false',
      closePayload: '',
      closeMsg: {},
      willTopic: '',
      willQos: '0',
      willRetain: 'false',
      willPayload: '',
      willMsg: {},
    });
  });

  it('does not materialize MQTT credential fields', () => {
    const out = schema.parse({}) as Record<string, unknown>;

    expect(out['user']).toBeUndefined();
    expect(out['password']).toBeUndefined();
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
