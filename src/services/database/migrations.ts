// src/services/database/migrations.ts
// Esquema SQL para banco de dados offline
import * as SQLite from 'expo-sqlite';

// Define the type for the database object compatible with expo-sqlite
type SQLiteDatabase = SQLite.SQLiteDatabase;

export type Migration = {
  version: number;
  name: string;
  sql?: string;
  up?: (db: SQLiteDatabase) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- Tabela de Clientes
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        server_id INTEGER,
        version INTEGER DEFAULT 1,
        razao_social TEXT NOT NULL,
        nome_fantasia TEXT,
        cnpj TEXT,
        cpf TEXT,
        tipo_pessoa TEXT,
        contato TEXT,
        email TEXT,
        status TEXT DEFAULT 'ATIVO',
        logradouro TEXT,
        numero TEXT,
        complemento TEXT,
        bairro TEXT,
        cidade TEXT,
        estado TEXT,
        cep TEXT,
        sync_status TEXT DEFAULT 'SYNCED',
        last_synced_at INTEGER,
        updated_at INTEGER,
        created_at INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_clientes_busca ON clientes(razao_social COLLATE NOCASE, nome_fantasia COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_clientes_sync ON clientes(sync_status);
      CREATE INDEX IF NOT EXISTS idx_clientes_server_id ON clientes(server_id);

      -- Tabela de Ordens de Serviço
      CREATE TABLE IF NOT EXISTS ordens_servico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        server_id INTEGER,
        version INTEGER DEFAULT 1,
        cliente_id INTEGER,
        cliente_local_id TEXT,
        data TEXT NOT NULL,
        data_vencimento TEXT,
        status TEXT DEFAULT 'ABERTA',
        valor_total REAL DEFAULT 0,
        tipo_desconto TEXT,
        valor_desconto REAL,
        sync_status TEXT DEFAULT 'SYNCED',
        last_synced_at INTEGER,
        updated_at INTEGER,
        created_at INTEGER,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
      CREATE INDEX IF NOT EXISTS idx_os_sync ON ordens_servico(sync_status);
      CREATE INDEX IF NOT EXISTS idx_os_server_id ON ordens_servico(server_id);

      -- Tabela de Veículos por OS
      CREATE TABLE IF NOT EXISTS veiculos_os (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        server_id INTEGER,
        version INTEGER DEFAULT 1,
        os_id INTEGER,
        os_local_id TEXT,
        placa TEXT NOT NULL,
        modelo TEXT,
        cor TEXT,
        valor_total REAL DEFAULT 0,
        sync_status TEXT DEFAULT 'SYNCED',
        updated_at INTEGER,
        created_at INTEGER,
        FOREIGN KEY (os_id) REFERENCES ordens_servico(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_veiculos_placa ON veiculos_os(placa);
      CREATE INDEX IF NOT EXISTS idx_veiculos_sync ON veiculos_os(sync_status);

      -- Tabela de Peças/Serviços
      CREATE TABLE IF NOT EXISTS pecas_os (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        server_id INTEGER,
        version INTEGER DEFAULT 1,
        veiculo_id INTEGER,
        veiculo_local_id TEXT,
        tipo_peca_id INTEGER,
        nome_peca TEXT,
        valor_cobrado REAL,
        descricao TEXT,
        sync_status TEXT DEFAULT 'SYNCED',
        updated_at INTEGER,
        created_at INTEGER,
        FOREIGN KEY (veiculo_id) REFERENCES veiculos_os(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_pecas_sync ON pecas_os(sync_status);

      -- Tabela de Despesas
      CREATE TABLE IF NOT EXISTS despesas(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        server_id INTEGER,
        version INTEGER DEFAULT 1,
        data_despesa TEXT,
        data_vencimento TEXT,
        valor REAL,
        categoria TEXT,
        descricao TEXT,
        pago_agora INTEGER DEFAULT 0,
        meio_pagamento TEXT,
        cartao_id INTEGER,
        sync_status TEXT DEFAULT 'PENDING_CREATE',
        last_synced_at INTEGER,
        updated_at INTEGER,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_despesas_sync ON despesas(sync_status);

      -- Fila de Sincronização (Legacy V1)
      CREATE TABLE IF NOT EXISTS sync_queue(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_local_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        priority INTEGER DEFAULT 5,
        attempts INTEGER DEFAULT 0,
        last_attempt INTEGER,
        error_message TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sync_priority ON sync_queue(priority ASC, attempts ASC, created_at ASC);

      -- Tabela de Auditoria
      CREATE TABLE IF NOT EXISTS audit_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        conflict_detected INTEGER DEFAULT 0,
        conflict_resolution TEXT,
        user_id INTEGER,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

      -- Metadados de Sincronização
      CREATE TABLE IF NOT EXISTS sync_metadata(
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `
  },
  {
    version: 2,
    name: 'offline_catalogs',
    sql: `
        -- Catálogo de Tipos de Peça (cache read-only)
        CREATE TABLE IF NOT EXISTS tipos_peca (
            id INTEGER PRIMARY KEY,
            nome TEXT,
            valor_padrao REAL,
            updated_at INTEGER
        );

        -- Catálogo de Usuários (cache read-only)
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT,
            email TEXT,
            role TEXT,
            updated_at INTEGER
        );
      `
  },
  {
    version: 3,
    name: 'sync_queue_refactor_and_uuids',
    sql: `
      -- 1. Criar nova tabela sync_queue com schema atualizado
      CREATE TABLE IF NOT EXISTS sync_queue_v2(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource TEXT NOT NULL, -- antigo entity_type
        action TEXT NOT NULL, -- antigo operation
        payload TEXT,
        temp_id TEXT, -- antigo entity_local_id
        status TEXT DEFAULT 'PENDING', -- status de processamento(PENDING, PROCESSED, ERROR)
        created_at INTEGER,
        attempts INTEGER DEFAULT 0,
        last_attempt INTEGER,
        error_message TEXT
      );

      -- 2. Tentar migrar dados da antiga sync_queue se existir
      -- Mapeamento: entity_type -> resource, operation -> action, entity_local_id -> temp_id
      INSERT INTO sync_queue_v2(resource, action, payload, temp_id, status, created_at, attempts, last_attempt, error_message)
      SELECT
        entity_type,
        operation,
        payload,
        entity_local_id,
        'PENDING', -- Resetando status para garantir processamento ou manter estado
        created_at,
        attempts,
        last_attempt,
        error_message
      FROM sync_queue;

      -- 3. Substituir a tabela antiga pela nova
      DROP TABLE IF EXISTS sync_queue;
      ALTER TABLE sync_queue_v2 RENAME TO sync_queue;

      -- Recriar índices para sync_queue
      CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_sync_resource_temp_id ON sync_queue(resource, temp_id);

      -- 4. Atualizar Tabela de Clientes com UUID
      ALTER TABLE clientes ADD COLUMN uuid TEXT;
      UPDATE clientes SET uuid = local_id WHERE uuid IS NULL AND local_id IS NOT NULL;

      -- 5. Atualizar Tabela de Ordens de Serviço com UUID
      ALTER TABLE ordens_servico ADD COLUMN uuid TEXT;
      UPDATE ordens_servico SET uuid = local_id WHERE uuid IS NULL AND local_id IS NOT NULL;
    `
  },
  {
    version: 4,
    name: 'repair_schema_v4',
    sql: `
      -- Garantir existência da tabela users
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `
  },
  {
    version: 5,
    name: 'add_os_responsible_columns',
    sql: `
      -- V5: Garantir colunas de responsável na OS
      ALTER TABLE ordens_servico ADD COLUMN usuario_id INTEGER;
      ALTER TABLE ordens_servico ADD COLUMN usuario_nome TEXT;
      ALTER TABLE ordens_servico ADD COLUMN usuario_email TEXT;
    `
  },
  {
    version: 6,
    name: 'make_users_name_nullable',
    sql: `
      -- V6: Tornar o nome do usuário opcional (SQLite workaround para DROP NOT NULL)
      PRAGMA foreign_keys=OFF;
      
      CREATE TABLE IF NOT EXISTS users_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER,
        name TEXT, -- Agora pode ser nulo
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );

      INSERT OR IGNORE INTO users_v6 (id, name, email, role)
      SELECT id, name, email, role FROM users;

      DROP TABLE IF EXISTS users;
      ALTER TABLE users_v6 RENAME TO users;
      
      PRAGMA foreign_keys=ON;
    `
  },
  {
    version: 7,
    name: 'cliente_sync_patch',
    sql: `
      -- V7: Cliente sync patch — columns + indexes
      ALTER TABLE clientes ADD COLUMN empresa_id INTEGER DEFAULT 0;
      ALTER TABLE clientes ADD COLUMN deleted_at TEXT;
      ALTER TABLE clientes ADD COLUMN server_updated_at TEXT;

      -- Garante que (empresa_id, local_id) seja único → impede replay/skew duplicar
      CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_local_id
        ON clientes(empresa_id, local_id);

      -- Índice para lookup por (empresa_id, server_id)
      CREATE INDEX IF NOT EXISTS idx_clientes_empresa_server_id
        ON clientes(empresa_id, server_id);

      -- Índice para replay protection por (empresa_id, server_updated_at)
      CREATE INDEX IF NOT EXISTS idx_clientes_empresa_server_updated_at
        ON clientes(empresa_id, server_updated_at);
    `
  },
  {
    version: 8,
    name: 'os_sync_patch',
    sql: `
        -- V8: OS sync patch - adicionar suporte a multi-tenancy e replay protection
        ALTER TABLE ordens_servico ADD COLUMN empresa_id INTEGER DEFAULT 0;
        ALTER TABLE ordens_servico ADD COLUMN server_updated_at TEXT;
        ALTER TABLE ordens_servico ADD COLUMN deleted_at TEXT;

        -- Índices para performance e unicidade
        CREATE UNIQUE INDEX IF NOT EXISTS uq_os_empresa_local_id ON ordens_servico(empresa_id, local_id);

        -- Lookup rápido por empresa
        CREATE INDEX IF NOT EXISTS idx_os_empresa_id ON ordens_servico(empresa_id);

        -- Replay protection
        CREATE INDEX IF NOT EXISTS idx_os_empresa_server_updated_at ON ordens_servico(empresa_id, server_updated_at);
    `
  },
  {
    version: 9,
    name: 'definitive_duplicate_cleanup',
    up: async (db: SQLiteDatabase) => {
      // Phase 0: Normalização
      await db.execAsync(`
          UPDATE clientes SET cnpj = REPLACE(REPLACE(REPLACE(TRIM(cnpj), '.', ''), '-', ''), '/', '');
          UPDATE clientes SET cpf = REPLACE(REPLACE(TRIM(cpf), '.', ''), '-', '');
        `);

      // Phase 0.5: Adicionar correlation_id se não existir
      try {
        await db.execAsync(`ALTER TABLE clientes ADD COLUMN correlation_id TEXT;`);
        await db.execAsync(`UPDATE clientes SET correlation_id = local_id WHERE correlation_id IS NULL;`);
      } catch (e) {
        // Se falhar (coluna já existe), segue o baile
      }

      // Phase 1: Deduplication (merge FKs em ordens_servico)
      const dupesServer = await db.getAllAsync<{ server_id: number; qtd: number }>(`
          SELECT server_id, COUNT(*) as qtd
          FROM clientes
          WHERE server_id IS NOT NULL
          GROUP BY server_id
          HAVING COUNT(*) > 1
        `);

      for (const dupe of dupesServer) {
        const winner = await db.getFirstAsync<{ local_id: string }>(`
            SELECT local_id FROM clientes
            WHERE server_id = ?
            ORDER BY updated_at DESC, sync_status DESC
            LIMIT 1
          `, [dupe.server_id]);

        if (winner) {
          const winnerFull = await db.getFirstAsync<{ id: number, local_id: string }>(`
                SELECT id, local_id FROM clientes WHERE local_id = ?
              `, [winner.local_id]);

          if (winnerFull) {
            const losers = await db.getAllAsync<{ id: number, local_id: string }>(`
                    SELECT id, local_id FROM clientes WHERE server_id = ? AND local_id != ?
                  `, [dupe.server_id, winner.local_id]);

            for (const loser of losers) {
              await db.runAsync(`
                        UPDATE ordens_servico SET cliente_id = ?, cliente_local_id = ? 
                        WHERE cliente_id = ?
                     `, [winnerFull.id, winnerFull.local_id, loser.id]);

              await db.runAsync(`
                        UPDATE ordens_servico SET cliente_local_id = ? 
                        WHERE cliente_local_id = ?
                     `, [winnerFull.local_id, loser.local_id]);
            }
          }

          await db.runAsync(`
                DELETE FROM clientes WHERE server_id = ? AND local_id != ?
              `, [dupe.server_id, winner.local_id]);
        }
      }

      // Phase 2: Constraints
      // Importante: SQLite não deixa criar UNIQUE index se já tiver duplicatas.
      // O código acima limpa as duplicatas. 
      // Se falhar (ainda tiver duplicata), o index vai falhar e o app pode crashar no next start.
      // Vamos engolir exceção aqui para não travar boot, mas logar seria ideal.
      try {
        await db.execAsync(`
              CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_server_id_unique ON clientes(server_id) WHERE server_id IS NOT NULL;
            `);
      } catch (e) { }

      try {
        await db.execAsync(`
              CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_cnpj_unique ON clientes(cnpj) WHERE cnpj IS NOT NULL AND TRIM(cnpj) <> '';
            `);
      } catch (e) { }

      try {
        await db.execAsync(`
              CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_cpf_unique ON clientes(cpf) WHERE cpf IS NOT NULL AND TRIM(cpf) <> '';
            `);
      } catch (e) { }

      try {
        await db.execAsync(`
              CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_correlation_unique ON clientes(correlation_id) WHERE correlation_id IS NOT NULL AND TRIM(correlation_id) <> '';
            `);
      } catch (e) { }
    },
  }
];

export const CURRENT_DB_VERSION = 9;
