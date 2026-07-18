import { spawnSync } from 'node:child_process';
import { fixedGitExecutable } from '../../../build/lib/fixed-executables';
import { CliError } from './log';

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a git command from a fixed system location rather than caller-controlled PATH.
 * Captures output by default; pass `inherit: true` to stream clone/fetch progress.
 */
export function git(args: string[], opts: { cwd?: string; inherit?: boolean; allowFail?: boolean } = {}): GitResult {
  const res = spawnSync(fixedGitExecutable(), args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    stdio: opts.inherit ? ['ignore', 'inherit', 'inherit'] : 'pipe',
  });

  const ok = res.status === 0;

  if (!ok && !opts.allowFail) {
    const detail = opts.inherit ? '' : `: ${(res.stderr || res.stdout || '').trim()}`;

    throw new CliError(`git ${args.join(' ')} failed${detail}`);
  }

  return { ok, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
}

/** Clone a repo into `dest`, streaming progress. */
export function clone(url: string, dest: string): void {
  git(['clone', url, dest], { inherit: true });
}

/** Check out a specific ref (branch, tag, or SHA) in `cwd`. */
export function checkout(cwd: string, ref: string): void {
  git(['checkout', ref], { cwd, inherit: true });
}

/** Resolve the current HEAD commit SHA in `cwd`. */
export function headCommit(cwd: string): string {
  return git(['rev-parse', 'HEAD'], { cwd }).stdout;
}

/** Fetch all refs + tags. */
export function fetch(cwd: string): void {
  git(['fetch', '--tags', '--prune', 'origin'], { cwd, inherit: true });
}

/** Fast-forward the current branch to origin/<ref>; throws if not fast-forwardable. */
export function fastForward(cwd: string, ref: string): void {
  git(['merge', '--ff-only', `origin/${ref}`], { cwd, inherit: true });
}

/** The remote's default branch name (e.g. "main"), falling back to "main". */
export function remoteDefaultBranch(cwd: string): string {
  const res = git(['rev-parse', '--abbrev-ref', 'origin/HEAD'], { cwd, allowFail: true });
  const match = (/^origin\/(?<branch>.+)$/u).exec(res.stdout);

  return match?.groups?.branch ?? 'main';
}

/** Initialize a new git repo in `cwd` (used by the scaffolder). */
export function init(cwd: string): void {
  git(['init'], { cwd });
}
