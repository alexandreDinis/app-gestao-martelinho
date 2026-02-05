// src/services/database/migrations.ts
// Esquema SQL para banco de dados offline

export const MIGRATIONS = [
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

      -- Catálogo de Tipos de Peça (cache read-only)
      CREATE TABLE IF NOT EXISTS tipos_peca (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        preco_sugerido REAL,
        updated_at INTEGER
      );

      -- Tabela de Despesas
      CREATE TABLE IF NOT EXISTS despesas (
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

      -- Fila de Sincronização
      CREATE TABLE IF NOT EXISTS sync_queue (
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
      CREATE TABLE IF NOT EXISTS audit_log (
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
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `
    }
];

export const CURRENT_DB_VERSION = 1;
