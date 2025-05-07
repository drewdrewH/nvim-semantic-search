import { DatabaseService } from './database.service';
import { FilePreviewModal } from './file-modal';
import { OpenAIService } from './openai/openai-service';
import { SemanticSearchService } from './semantic-search.service';
import { Neovim, NvimPlugin } from 'neovim';

module.exports = (plugin: any) => {
  let openaiServiceInstance: OpenAIService;
  let semanticSearchService: SemanticSearchService;
  let databaseServiceInstance: DatabaseService;
  
  const logger = {
    error: (msg: string) => plugin.nvim.errWriteLine(`[semantic-search] ERROR: ${msg}`),
    log: (msg: string) => plugin.nvim.outWriteLine(`[semantic-search] INFO: ${msg}`)
  };

   const initialize = async () => {
    logger.log('*** INITIALIZING SEMANTIC SEARCH PLUGIN ***');
    try {
      const apiKey = await plugin.nvim.getVar('semantic_search_openai_api_key') as string | null;
      logger.log(`API Key: ${apiKey ? 'present' : 'missing'}`);
      
      if (!apiKey) {
        logger.error('Please set the "semantic_search_openai_api_key" Neovim variable.');
        return false;
      }
      
      openaiServiceInstance = new OpenAIService(apiKey, logger);
      logger.log('OpenAIService instantiated.');
      
      try {
        const dbConfig = {
          host: await plugin.nvim.getVar('semantic_search_db_host').catch(() => 'localhost'),
          port: await plugin.nvim.getVar('semantic_search_db_port').catch(() => 5432),
          user: await plugin.nvim.getVar('semantic_search_db_user').catch(() => ''),
          password: await plugin.nvim.getVar('semantic_search_db_password').catch(() => ''),
          database: await plugin.nvim.getVar('semantic_search_db_name').catch(() => 'semantic_search')
        };
        
        databaseServiceInstance = new DatabaseService(dbConfig, logger);
        await databaseServiceInstance.initialize();
        logger.log('DatabaseService instantiated and connected.');
      } catch (error) {
        logger.error(`Database connection error: ${error}`);
        return false;
      }
      
      semanticSearchService = new SemanticSearchService(openaiServiceInstance, databaseServiceInstance);


      logger.log('SemanticSearchService instantiated.');
      const cwd = await plugin.nvim.call('getcwd');
      logger.log(`Generating embeddings for ${cwd}.`);
      await semanticSearchService.generateEmbeddings(cwd)
      
      return true;
    } catch (error) {
      logger.error(`ERROR DURING INITIALIZATION: ${error}`);
      return false;
    }
  };

  plugin.registerCommand('SemanticSearch', async () => {
    if (!semanticSearchService && !(await initialize())) {
      return;
    }
    
    const searchQuery = await plugin.nvim.call('input', ['Enter search query: ']) as string;
    if (!searchQuery) return;
    
    try {
      const result = await semanticSearchService.semanticSearch(searchQuery);
      plugin.nvim.outWriteLine(`Search result: ${JSON.stringify(result)}`);
      const fileModal = new FilePreviewModal(plugin, result)
      await fileModal.show();
    } catch (error) {
      logger.error(`Search error: ${error}`);
    }
  }, { sync: false });

  initialize().then(() => {
    logger.log('Semantic search plugin loaded successfully.');
  });
};
