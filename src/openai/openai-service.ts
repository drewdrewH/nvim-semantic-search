
import OpenAI from 'openai';

interface Logger {
  error: (msg: string) => void; 
  log: (msg: string) => void
}

export class OpenAIService {
  private readonly openai: OpenAI;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger){
    this.openai = new OpenAI({ apiKey })
    this.logger = logger
  }

  
  async getEmbedding(text: string) {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: text,
      });
      return response?.data?.[0]?.embedding;
    } catch (error) {
      this.logger.log(`Failed to generate embedding from OpenAI: ${error}`)
      return null
    }
  }
} 
