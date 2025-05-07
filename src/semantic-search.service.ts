import OpenAI from "openai";
import { OpenAIService } from "./openai/openai-service";
import * as path from 'path';
import * as fs from 'fs/promises';
import { DatabaseService } from "./database.service";
import { FileParser } from "./file-parser";

export class SemanticSearchService {
  private readonly openAIService: OpenAIService;
  private readonly databaseService: DatabaseService;
  private readonly fileparser: FileParser;

  constructor(openAIService: OpenAIService, databaseService: DatabaseService){
    this.openAIService = openAIService
    this.databaseService = databaseService
    this.fileparser = new FileParser()
  }
  
  async generateEmbeddings(path: string){
    let allCodeFiles: string[] = []
    await fs.access(path);
    await this.findCodeFiles(path, allCodeFiles);
    const relevantFiles = allCodeFiles.filter(
      (f) =>
        !f.endsWith('.spec.ts') &&
        !f.endsWith('.d.ts') &&
        !f.includes('/node_modules/') &&
        !f.includes('/dist/') &&
        !f.includes('index.ts') &&
        f.includes('src/'),
    );

    for(const filepath of relevantFiles){
      const chunks = this.fileparser.extractCodeChunks(filepath) 
      console.log("code chunks", JSON.stringify(chunks, null, 2))
      if(!chunks.length) continue;
      for ( const chunk of chunks) {
        const embedding = await this.openAIService.getEmbedding(
          chunk.content.replace(/\s+/g, ' ').replace(/\n\s*/g, ' ').trim()
        )
        if(embedding){
          this.databaseService.insertVector({
            filepath,
            embedding,
            ...chunk
          })
        }
      }
    }
  }

  async semanticSearch(text: string){
    const embedding = await this.openAIService.getEmbedding(text)
    if(!embedding)return [];
    console.log('embedding', embedding)


    const files = this.databaseService.searchByEmbedding(embedding)
    console.log(files)
    return files
  }

  async readFileContent(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      return null;
    }
  }

  async findCodeFiles(currentDir: string, allCodeFiles: string[]){

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await this.findCodeFiles(fullPath, allCodeFiles); 
        } else if (
          entry.isFile() &&
          path.extname(entry.name) === '.ts'
        ) {
          allCodeFiles.push(fullPath);
        }
      }
    } catch (error) {
    }
  }
}
