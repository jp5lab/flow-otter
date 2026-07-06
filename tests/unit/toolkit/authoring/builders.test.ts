import { describe, expect, it } from 'vitest';

import {
  catchNode,
  completeNode,
  linkCall,
  linkIn,
  linkOut,
  mqttIn,
  mqttOut,
  statusNode,
  subflowInstance,
} from '../../../../src/toolkit/authoring/builders.js';
import { getOutputPortCount } from '../../../../src/toolkit/authoring/types.js';

const POS = { x: 0, y: 0 };

describe('node-type builders', () => {
  it('mqttIn emits type "mqtt in"', () => {
    expect(mqttIn({ key: 'k', position: POS }).type).toBe('mqtt in');
  });

  it('mqttOut emits type "mqtt out"', () => {
    expect(mqttOut({ key: 'k', position: POS }).type).toBe('mqtt out');
  });

  it('linkIn emits type "link in"', () => {
    expect(linkIn({ key: 'k', position: POS }).type).toBe('link in');
  });

  it('linkOut emits type "link out"', () => {
    expect(linkOut({ key: 'k', position: POS }).type).toBe('link out');
  });

  it('linkCall emits type "link call"', () => {
    expect(linkCall({ key: 'k', position: POS }).type).toBe('link call');
  });

  it('catchNode emits type "catch"', () => {
    expect(catchNode({ key: 'k', position: POS }).type).toBe('catch');
  });

  it('statusNode emits type "status"', () => {
    expect(statusNode({ key: 'k', position: POS }).type).toBe('status');
  });

  it('completeNode emits type "complete"', () => {
    expect(completeNode({ key: 'k', position: POS }).type).toBe('complete');
  });

  it('subflowInstance emits type "subflow:<defId>"', () => {
    expect(subflowInstance('abc123', { key: 'k', position: POS }).type).toBe('subflow:abc123');
  });

  it('builders propagate label, info, groupKey, passthrough', () => {
    const n = mqttIn({
      key: 'k',
      label: 'My MQTT',
      info: 'Documents the MQTT input.',
      position: POS,
      groupKey: 'g1',
      passthrough: { topic: 'foo/bar', broker: 'b1' },
    });
    expect(n.label).toBe('My MQTT');
    expect(n.info).toBe('Documents the MQTT input.');
    expect(n.groupKey).toBe('g1');
    expect(n.passthrough).toEqual({ topic: 'foo/bar', broker: 'b1' });
  });
});

describe('getOutputPortCount', () => {
  it('honors passthrough.outputs for function nodes', () => {
    expect(getOutputPortCount('function', { outputs: 3 })).toBe(3);
  });

  it('honors passthrough.outputs for switch / trigger / delay nodes', () => {
    expect(getOutputPortCount('switch', { outputs: 4 })).toBe(4);
    expect(getOutputPortCount('trigger', { outputs: 2 })).toBe(2);
    expect(getOutputPortCount('delay', { outputs: 2 })).toBe(2);
  });

  it('derives switch outputs from rules.length when outputs is absent', () => {
    expect(
      getOutputPortCount('switch', { rules: [{ t: 'eq' }, { t: 'neq' }, { t: 'else' }] }),
    ).toBe(3);
  });

  it('falls back to the per-type default when neither field is present', () => {
    expect(getOutputPortCount('inject')).toBe(1);
    expect(getOutputPortCount('debug')).toBe(0);
    expect(getOutputPortCount('mqtt out')).toBe(0);
    expect(getOutputPortCount('something-unknown')).toBe(1);
  });

  it('does not honor outputs on types not in the OUTPUTS_FIELD_TYPES set', () => {
    // mqtt in is single-output by convention; spec injecting `outputs` is ignored.
    expect(getOutputPortCount('mqtt in', { outputs: 5 })).toBe(1);
  });
});
