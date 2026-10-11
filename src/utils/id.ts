import { randomUUID } from 'expo-crypto';

let generator: () => string = () => randomUUID();

/** Collision-resistant client-generated ID (UUID v4). */
export function newId(): string {
  return generator();
}

/** Test hook: replace the ID generator (e.g. with node's crypto.randomUUID or a counter). */
export function setIdGenerator(fn: () => string): void {
  generator = fn;
}
