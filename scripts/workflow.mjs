// npm entry point: find Python without relying on a machine-specific PATH.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const programs = join(process.env.LOCALAPPDATA || '', 'Programs', 'Python');
const candidates = [
  process.env.PYTHON,
  ...(process.platform === 'win32' && existsSync(programs)
    ? readdirSync(programs)
        .sort()
        .reverse()
        .map((dir) => join(programs, dir, 'python.exe'))
    : []),
  'python3',
  'python'
].filter(Boolean);
const python = candidates.find(
  (exe) =>
    spawnSync(exe, ['-c', 'import sys; sys.exit(sys.version_info < (3, 10))'], {
      windowsHide: true
    }).status === 0
);
if (!python) throw new Error('Python 3.10+ is required. Set PYTHON to its executable path.');
const result = spawnSync(
  python,
  [fileURLToPath(new URL('workflow.py', import.meta.url)), ...process.argv.slice(2)],
  { stdio: 'inherit', windowsHide: true }
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
