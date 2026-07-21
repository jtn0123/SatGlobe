import * as ts from 'typescript';

/** Extract literal static, re-export, and dynamic-import module specifiers from TypeScript source. */
export function extractModuleSpecifiers(source: string, fileName = 'source.ts'): string[] {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifiers;
}
