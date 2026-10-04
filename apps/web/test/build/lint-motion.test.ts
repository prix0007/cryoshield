/** app-motion-ux 1.2 / guardrail (c): the full `motion` component and framer-motion are lint errors in /app. */
import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: resolve(__dirname, '../..') });
const errorsFor = async (code: string) =>
  (await eslint.lintText(code, { filePath: resolve(__dirname, '../../src/ui/Fixture.tsx') }))[0]!.messages.filter((m) => m.ruleId === 'no-restricted-imports');

describe('motion import ban', () => {
  it('rejects `motion` from motion/react', async () => expect(await errorsFor("import { motion } from 'motion/react';\nexport const X = motion.div;\n")).toHaveLength(1));
  it('rejects framer-motion', async () => expect(await errorsFor("import { m } from 'framer-motion';\nexport const X = m.div;\n")).toHaveLength(1));
  it('allows m + LazyMotion', async () =>
    expect(await errorsFor("import { LazyMotion, domAnimation } from 'motion/react';\nimport * as m from 'motion/react-m';\nexport const X = [LazyMotion, domAnimation, m.div];\n")).toHaveLength(0));
});
