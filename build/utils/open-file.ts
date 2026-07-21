import { spawn } from 'node:child_process';
import { fixedOpenExecutable } from '../lib/fixed-executables';

export const openFile = (filePath: string): void => {
  const child = spawn(fixedOpenExecutable(), [filePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.on('error', () => { /* Opening is best effort. */ });
  child.unref();
};
