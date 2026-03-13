import { vi } from 'vitest';

// Global test setup — runs before each test file
// The obsidian module mock is auto-resolved from src/__mocks__/obsidian.ts
vi.mock('obsidian');
