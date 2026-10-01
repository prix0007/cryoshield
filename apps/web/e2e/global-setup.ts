import { startStack } from './stack/stack';

export default async function globalSetup() {
  const stack = await startStack();
  return async () => {
    await stack.stop();
  };
}
