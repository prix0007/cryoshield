import { startStack, type Stack } from '../e2e/stack/stack';

let stack: Stack | undefined;
export async function setup() {
  stack = await startStack();
}
export async function teardown() {
  await stack?.stop();
}
