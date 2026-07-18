import { parseSync } from '@babel/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BuildError, ErrorCodes } from './build-error';

export interface SatGlobeScriptInspection {
  assetCount: number;
  evalOffenders: string[];
}

const NONCOMPUTED_KEY_NODE_TYPES = new Set([
  'ClassAccessorProperty',
  'ClassMethod',
  'ClassProperty',
  'ObjectMethod',
  'ObjectProperty',
]);
const GLOBAL_OBJECT_NAMES = new Set(['globalThis', 'self', 'window']);

/** Lists every emitted JavaScript asset, including workers and copied runtime trees. */
const listJavaScriptAssets = (distDir: string, currentDir = distDir): string[] => readdirSync(currentDir, { withFileTypes: true })
  .flatMap((entry) => {
    const assetPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      return listJavaScriptAssets(distDir, assetPath);
    }

    return entry.isFile() && entry.name.endsWith('.js') ? [relative(distDir, assetPath)] : [];
  });

/** Returns whether an AST member property names the built-in evaluator. */
function isEvalProperty(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const property = value as Record<string, unknown>;

  switch (property.type) {
    case 'Identifier':
      return property.name === 'eval';
    case 'StringLiteral':
      return property.value === 'eval';
    default:
      return false;
  }
}

/** Returns whether an AST expression names a browser global object. */
function isGlobalObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const node = value as Record<string, unknown>;

  return node.type === 'Identifier' && GLOBAL_OBJECT_NAMES.has(String(node.name));
}

/** Returns whether an object pattern binds the global evaluator under any local name. */
function objectPatternSelectsEval(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const pattern = value as Record<string, unknown>;

  if (pattern.type !== 'ObjectPattern' || !Array.isArray(pattern.properties)) {
    return false;
  }

  return pattern.properties.some((property: unknown) => {
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      return false;
    }
    const member = property as Record<string, unknown>;

    return member.type === 'ObjectProperty' && isEvalProperty(member.key);
  });
}

/** Detects declarations and assignments that rename eval from a browser global. */
function destructuresGlobalEval(node: Record<string, unknown>): boolean {
  if (node.type === 'VariableDeclarator') {
    return isGlobalObject(node.init) && objectPatternSelectsEval(node.id);
  }
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    return isGlobalObject(node.right) && objectPatternSelectsEval(node.left);
  }

  return false;
}

/** Excludes property/method names while retaining shorthand values and computed expressions. */
function shouldSkipChild(node: Record<string, unknown>, key: string): boolean {
  if (['loc', 'start', 'end', 'extra'].includes(key)) {
    return true;
  }
  if (key === 'property' && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')) {
    return node.computed !== true;
  }
  if (key === 'key' && NONCOMPUTED_KEY_NODE_TYPES.has(String(node.type))) {
    return node.computed !== true;
  }

  return key === 'label' && ['BreakStatement', 'ContinueStatement', 'LabeledStatement'].includes(String(node.type));
}

/** Finds any executable reference to built-in eval, including an alias initializer. */
function containsEvalReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsEvalReference);
  }
  const node = value as Record<string, unknown>;

  if (destructuresGlobalEval(node)) {
    return true;
  }
  if (node.type === 'Identifier' && node.name === 'eval') {
    return true;
  }
  const isMember = node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression';

  if (isMember && isGlobalObject(node.object) && isEvalProperty(node.property)) {
    return true;
  }

  return Object.entries(node)
    .filter(([key]) => !shouldSkipChild(node, key))
    .some(([, child]) => containsEvalReference(child));
}

/** Parses JavaScript so strings and comments mentioning eval are not treated as executable calls. */
function containsExecutableEval(source: string, filename: string): boolean {
  if (!source.includes('eval')) {
    return false;
  }
  let ast: ReturnType<typeof parseSync>;

  try {
    ast = parseSync(source, {
      babelrc: false,
      configFile: false,
      filename,
      sourceType: 'unambiguous',
    });
  } catch (error) {
    throw new BuildError(
      `Could not parse emitted SatGlobe JavaScript ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCodes.BUNDLE_POLICY,
    );
  }
  if (!ast) {
    throw new BuildError(`Could not parse emitted SatGlobe JavaScript ${filename}`, ErrorCodes.BUNDLE_POLICY);
  }

  return containsEvalReference(ast);
}

/** Inspects all emitted SatGlobe JavaScript for calls forbidden by its strict CSP. */
export function inspectSatGlobeScripts(distDir: string): SatGlobeScriptInspection {
  const assets = listJavaScriptAssets(distDir).sort((left, right) => left.localeCompare(right, 'en'));
  const evalOffenders = assets.filter((name) => containsExecutableEval(readFileSync(join(distDir, name), 'utf8'), name));

  return { assetCount: assets.length, evalOffenders };
}

/** Fails a SatGlobe build if executable eval escapes into any emitted JavaScript tree. */
export function assertSatGlobeScriptPolicy(distDir: string): SatGlobeScriptInspection {
  const inspection = inspectSatGlobeScripts(distDir);

  if (inspection.evalOffenders.length > 0) {
    throw new BuildError(
      `SatGlobe's strict script policy found executable eval() in: ${inspection.evalOffenders.join(', ')}`,
      ErrorCodes.BUNDLE_POLICY,
    );
  }

  return inspection;
}
