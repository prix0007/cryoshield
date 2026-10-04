import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach } from 'vitest';

// jsdom has no Web Animations: Motion animations complete instantly in unit tests (app-motion-ux design, Risks).
// Real end states, reduced motion and timing are covered in E2E (12-motion.spec.ts).
MotionGlobalConfig.skipAnimations = true;

afterEach(() => cleanup());
