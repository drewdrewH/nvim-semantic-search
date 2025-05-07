
import pg from 'pg';
import pgvector from 'pgvector/pg';

export class DatabaseService {
  private pgClient: any;
  private readonly logger;
  private readonly config;

  constructor(databaseConfig: any, logger: any) {
    this.config = databaseConfig;
    this.logger = logger;
  }

  async initialize() {
    await this.ensureDatabaseExists();
    
    try {
      await this.pgClient.connect();
      
      await this.pgClient.query('CREATE EXTENSION IF NOT EXISTS vector');
      await pgvector.registerTypes(this.pgClient);

      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS code_chunks (
          id BIGSERIAL PRIMARY KEY,
          filepath TEXT,
          type TEXT,
          name TEXT,
          startLine INTEGER,
          endLine INTEGER,
          content TEXT,
          embedding VECTOR(3072)
        )`
      );

      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx 
          ON code_chunks USING hnsw ((embedding::halfvec(3072)) halfvec_ip_ops)
          WITH (m = 32, ef_construction = 128)
        `);
      this.logger.log('Database initialized successfully');
    } catch (error: any) {
      this.logger.error(`Error initializing database: ${error.message}`);
      throw error;
    }

    try {
      await this.pgClient.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'unique_code_chunk' AND conrelid = 'code_chunks'::regclass
          ) THEN
            ALTER TABLE code_chunks 
            ADD CONSTRAINT unique_code_chunk 
            UNIQUE (filepath, type, name);
          END IF;
        END
        $$;
      `);
      this.logger.log('Unique constraint created or verified');
    } catch (error) {
      this.logger.error(`Error creating constraint: ${error}`);
    }
  }

  async insertVector(chunk: {filepath: string, type: string, name: string, startLine: number, endLine: number, content: string, embedding: number[]}) {
  const query = `
    INSERT INTO code_chunks(filepath, type, name, startLine, endLine, content, embedding) 
    VALUES($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (filepath, type, name)
    DO UPDATE SET
      startLine = $4,
      endLine = $5,
      content = $6,
      embedding = $7
    RETURNING id
  `;
  
  const result = await this.pgClient.query(query, [
    chunk.filepath,
    chunk.type,
    chunk.name,
    chunk.startLine,
    chunk.endLine,
    chunk.content,
    pgvector.toSql(chunk.embedding)
  ]);
  
  return result.rows[0].id;
}
  async searchByEmbedding(queryEmbedding: number[], limit: number = 10) {
    try {
      const results = await this.pgClient.query(`
        SELECT 
          id, 
          filepath,
          type,
          name,
          startLine,
          endLine,
          content,
          embedding <#> $1 AS similarity
        FROM 
          code_chunks
        ORDER BY 
          similarity ASC
        LIMIT $2
      `, [pgvector.toSql(queryEmbedding), limit]);
      
      return results.rows;
    } catch (error) {
      this.logger.error(`Error searching by embedding: ${error}`);
      throw error;
    }
  }
  
  async ensureDatabaseExists() {
    const dbName = this.config.database;
    const userName = this.config.user;
    
    const adminClient = new pg.Client({
      ...this.config,
      database: 'postgres' 
    });
    
    try {
      await adminClient.connect();
      
      const dbExists = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname = $1", 
        [dbName]
      );
      
      if (dbExists.rows.length === 0) {
        try {
          // 1. First ensure user has CREATEDB privilege
          await adminClient.query(`ALTER ROLE "${userName}" CREATEDB`);
          
          // 2. Create the database
          await adminClient.query(`CREATE DATABASE "${dbName}" OWNER "${userName}"`);
          
          this.logger.log(`Created database "${dbName}" with owner "${userName}"`);
        } catch (err: any) {
          if (err.code === '42501') { // Permission denied
            this.logger.error(`Insufficient privileges to create database or alter role.`);
            this.logger.log(`Please manually create the database "${dbName}" or connect with a superuser`);
          }
          throw err;
        }
      } else {
        try {
          await adminClient.query(`ALTER DATABASE "${dbName}" OWNER TO "${userName}"`);
        } catch (err: any) {
          this.logger.error(`Could not change database owner: ${err.message}`);
        }
      }
    } catch (error: any) {
      if (error.code === '42501') { // Permission denied 
        this.logger.error(`Insufficient privileges to create database.`);
        this.logger.log(`Try connecting with a superuser or manually create the database "${dbName}"`);
      } else {
        this.logger.error(`Database error: ${error.message}`);
      }
      throw error;
    } finally {
      await adminClient.end();
    }
    
    this.pgClient = new pg.Client(this.config);
  }
  
  async query(text: string, params?: any[]) {
    return this.pgClient.query(text, params);
  }
  
  async close() {
    if (this.pgClient) {
      await this.pgClient.end();
    }
  }
}
