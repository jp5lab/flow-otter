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

  it('builders propagate label, groupKey, passthrough', () => {
    const n = mqttIn({
      key: 'k',
      label: 'My MQTT',
      position: POS,
      groupKey: 'g1',
      passthrough: { topic: 'foo/bar', broker: 'b1' },
    });
    expect(n.label).toBe('My MQTT');
    expect(n.groupKey).toBe('g1');
    expect(n.passthrough).toEqual({ topic: 'foo/bar', broker: 'b1' });
  });
});
