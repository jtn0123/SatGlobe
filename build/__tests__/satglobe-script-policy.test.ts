import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSatGlobeScriptPolicy, inspectSatGlobeScripts } from '../lib/satglobe-script-policy';

const temporaryDirs: string[] = [];

/** Creates an isolated production-like output tree for one policy test. */
function makeDistDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'satglobe-script-policy-'));

  temporaryDirs.push(dir);
  mkdirSync(join(dir, 'js'));

  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('SatGlobe emitted script policy', () => {
  it('finds executable eval calls recursively but ignores text and source maps', () => {
    const distDir = makeDistDir();

    mkdirSync(join(distDir, 'auth'));
    mkdirSync(join(distDir, 'wasm', 'runtime'), { recursive: true });
    mkdirSync(join(distDir, 'nested'));
    writeFileSync(
      join(distDir, 'js', 'main.js'),
      [
        'const note = "eval(only text)";',
        'const tool = { eval: () => 1 };',
        'tool.eval();',
        'const { eval: runTool } = tool;',
        'runTool();',
        'let runAssigned;',
        '({ eval: runAssigned } = tool);',
        'runAssigned(); // eval(comment)',
      ].join(' '),
    );
    writeFileSync(join(distDir, 'auth', 'callback.js'), 'eval("direct")');
    writeFileSync(join(distDir, 'nested', 'assigned.js'), 'let invoke; ({ eval: invoke } = self); invoke("assigned")');
    writeFileSync(join(distDir, 'nested', 'destructured.js'), 'const { eval: invoke } = globalThis; invoke("renamed")');
    writeFileSync(join(distDir, 'nested', 'indirect.js'), 'const invoke = eval; invoke("aliased")');
    writeFileSync(join(distDir, 'wasm', 'runtime', 'loader.js'), 'globalThis["eval"]("property")');
    writeFileSync(join(distDir, 'js', 'main.js.map'), 'eval("source map only")');

    expect(inspectSatGlobeScripts(distDir)).toEqual({
      assetCount: 6,
      evalOffenders: ['auth/callback.js', 'nested/assigned.js', 'nested/destructured.js', 'nested/indirect.js', 'wasm/runtime/loader.js'],
    });
    expect(() => assertSatGlobeScriptPolicy(distDir)).toThrow(
      'auth/callback.js, nested/assigned.js, nested/destructured.js, nested/indirect.js, wasm/runtime/loader.js',
    );
  });

  it('accepts a recursive production tree without executable eval', () => {
    const distDir = makeDistDir();

    mkdirSync(join(distDir, 'nested'));
    writeFileSync(join(distDir, 'js', 'main.js'), 'const evaluate = (value) => value; evaluate(1);');
    writeFileSync(join(distDir, 'nested', 'worker.js'), 'self.onmessage = () => undefined;');

    expect(assertSatGlobeScriptPolicy(distDir)).toEqual({ assetCount: 2, evalOffenders: [] });
  });

  it('finds escaped and global-alias eval without rejecting locally shadowed names', () => {
    const distDir = makeDistDir();

    mkdirSync(join(distDir, 'nested'));
    writeFileSync(join(distDir, 'js', 'escaped.js'), '\\u0065val("escaped identifier")');
    writeFileSync(
      join(distDir, 'nested', 'aliased.js'),
      'const root = globalThis; const runtime = root; runtime.\\u0065val("aliased global")',
    );
    writeFileSync(
      join(distDir, 'nested', 'destructured-alias.js'),
      'const root = self; const { eval: invoke } = root; invoke("aliased destructure")',
    );
    writeFileSync(
      join(distDir, 'js', 'shadowed.js'),
      [
        'function callLocal(eval) { return eval("local function"); }',
        'const tool = { eval: (value) => value };',
        'const localRoot = tool;',
        'localRoot.eval("local property");',
        'function callLocalWindow(window) { return window.eval("local object"); }',
      ].join(' '),
    );

    expect(inspectSatGlobeScripts(distDir)).toEqual({
      assetCount: 4,
      evalOffenders: ['js/escaped.js', 'nested/aliased.js', 'nested/destructured-alias.js'],
    });
  });
});
