import { parseSync, traverse } from '@babel/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BuildError, ErrorCodes } from './build-error';

export interface SatGlobeScriptInspection {
  assetCount: number;
  evalOffenders: string[];
}

const GLOBAL_OBJECT_NAMES = new Set(['globalThis', 'self', 'window']);

interface AstBinding {
  constant: boolean;
  path: AstPath;
}

interface AstPath {
  get: (key: string) => AstPath | AstPath[];
  isReferencedIdentifier: (options?: { name?: string }) => boolean;
  node: unknown;
  scope: { getBinding: (name: string) => AstBinding | undefined };
  stop: () => void;
}

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

/** Returns the singular AST child for a named field. */
function getChildPath(path: AstPath, key: string): AstPath | null {
  const child = path.get(key);

  return Array.isArray(child) ? null : child;
}

/** Resolves direct browser globals and immutable aliases such as `const root = globalThis`. */
function resolvesGlobalObject(path: AstPath, seenBindings = new Set<AstBinding>()): boolean {
  if (!path.node || typeof path.node !== 'object' || Array.isArray(path.node)) {
    return false;
  }
  const node = path.node as Record<string, unknown>;

  if (node.type !== 'Identifier') {
    return false;
  }
  const name = String(node.name);
  const binding = path.scope.getBinding(name);

  if (!binding) {
    return GLOBAL_OBJECT_NAMES.has(name);
  }
  if (!binding.constant || seenBindings.has(binding)) {
    return false;
  }
  const declaration = binding.path.node;

  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return false;
  }
  if ((declaration as Record<string, unknown>).type !== 'VariableDeclarator') {
    return false;
  }
  const initializer = getChildPath(binding.path, 'init');

  if (!initializer?.node) {
    return false;
  }
  seenBindings.add(binding);

  return resolvesGlobalObject(initializer, seenBindings);
}

/** Detects declarations and assignments that rename eval from a browser global or alias. */
function destructuresGlobalEval(path: AstPath, node: Record<string, unknown>): boolean {
  if (node.type === 'VariableDeclarator' && objectPatternSelectsEval(node.id)) {
    const initializer = getChildPath(path, 'init');

    return initializer !== null && resolvesGlobalObject(initializer);
  }
  if (node.type === 'AssignmentExpression' && node.operator === '=' && objectPatternSelectsEval(node.left)) {
    const value = getChildPath(path, 'right');

    return value !== null && resolvesGlobalObject(value);
  }

  return false;
}

/** Finds executable references to built-in eval while respecting lexical shadowing. */
function containsEvalReference(ast: NonNullable<ReturnType<typeof parseSync>>): boolean {
  let found = false;

  traverse(ast, {
    enter(path: AstPath) {
      if (!path.node || typeof path.node !== 'object' || Array.isArray(path.node)) {
        return;
      }
      const node = path.node as Record<string, unknown>;

      if (
        node.type === 'Identifier'
        && node.name === 'eval'
        && path.isReferencedIdentifier({ name: 'eval' })
        && !path.scope.getBinding('eval')
      ) {
        found = true;
        path.stop();

        return;
      }
      if (destructuresGlobalEval(path, node)) {
        found = true;
        path.stop();

        return;
      }
      const isMember = node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression';

      if (isMember && isEvalProperty(node.property)) {
        const object = getChildPath(path, 'object');

        if (object && resolvesGlobalObject(object)) {
          found = true;
          path.stop();
        }
      }
    },
  });

  return found;
}

/** Parses JavaScript so strings, comments, and locally shadowed eval names remain allowed. */
function containsExecutableEval(source: string, filename: string): boolean {
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
