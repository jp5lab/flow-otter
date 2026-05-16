export { type RetentionPolicy } from './store.js';

export const DEFAULT_RETENTION = {
  keepLast: 50,
  protectTags: ['pinned'],
} as const;
