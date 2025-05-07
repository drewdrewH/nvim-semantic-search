import * as ts from 'typescript';
import * as fs from 'fs';

export class FileParser {
  extractCodeChunks(filePath: string) {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );
    
    const chunks: {
      type: string;
      name: string;
      content: string;
      startLine: number;
      endLine: number;
    }[] = [];
    
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        chunks.push({
          type: 'function',
          name: node.name.text,
          content: sourceCode.slice(node.getStart(), node.getEnd()),
          startLine: this.getLineNumber(node, sourceCode),
          endLine: this.getLineNumber(node, sourceCode, false)
        });
      }
      
      if (ts.isClassDeclaration(node) && node.name) {
        chunks.push({
          type: 'class',
          name: node.name.text,
          content: sourceCode.slice(node.getStart(), node.getEnd()),
          startLine: this.getLineNumber(node, sourceCode),
          endLine: this.getLineNumber(node, sourceCode, false)
        });

        if (node.members) {
          node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
              const methodName = member.name.getText(sourceFile);
              chunks.push({
                type: 'method',
                name: `${node.name?.text}.${methodName}`,
                content: sourceCode.slice(member.getStart(), member.getEnd()),
                startLine: this.getLineNumber(member, sourceCode),
                endLine: this.getLineNumber(member, sourceCode, false)
              });
            }
          });
        }
      }
      
      ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);
    return chunks;
  }
  
  private getLineNumber(node: ts.Node, sourceCode: string, isStart: boolean = true): number {
    const position = isStart ? node.getStart() : node.getEnd();
    const { line } = ts.getLineAndCharacterOfPosition(
      ts.createSourceFile('', sourceCode, ts.ScriptTarget.Latest),
      position
    );
    return line + 1; 
  }
}
