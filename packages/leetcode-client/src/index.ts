import { HttpLeetCodeClient } from './adapters/HttpLeetCodeClient';
import type { LeetCodeClient } from './adapters/LeetCodeClient';

export type { LeetCodeClient };

export const createLeetCodeClient = (userAgent: string): LeetCodeClient => {
  return new HttpLeetCodeClient(userAgent);
};

