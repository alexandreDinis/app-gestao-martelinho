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
      -- Adicionar coluna uuid se não existir (SQLite não suporta IF NOT EXISTS em ADD COLUMN, então ignoramos erro no código ou usamos bloco seguro se possível, mas aqui vamos direto)
      -- Como é migration versionada, assume-se que roda uma vez.
      -- ALTER TABLE clientes ADD COLUMN uuid TEXT; -- Comentado para evitar erro se já existir (check manual recomendado ou script catch)
      -- Melhor: Tentar adicionar e ignorar erro, mas SQLite nativo não facilita isso em script batch puro sem procedure.
      -- Assumindo que V3 roda após V1/V2 limpo:
      
      -- Hack para SQLite: ler meta-info ou apenas adicionar. Vamos tentar 'ADD COLUMN' direto. Se falhar, a migração falha.
      -- Mas como estamos resetando o banco, vai funcionar.
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
      -- Garantir existência da tabela users (para quem rodou migration V1 quebrada)
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );

      -- Garantir colunas em tipos_peca sem falhar se já existirem
      -- SQLite não tem ADD COLUMN IF NOT EXISTS, então fazemos recreate ou try/catch no código?
      -- Truque: adicionar coluna via script separado ou ignorar erro na migration runner?
      -- Como o runner roda em transação, erro aborta tudo.
      -- Abordagem melhor: Tentar criar tabela temporária e copiar se precisar? 
      -- Simplificação: DROP e RECREATE tipos_peca se estivermos em ambiente dev/repair? Não, perde dados.
      
      -- Como valor_padrao é crítico, vamos tentar adicionar. Se falhar, o app crasha?
      -- Vamos usar um bloco seguro se o driver suportar, mas aqui é string SQL bruta.
      -- O DatabaseService divide por ';'.
      
      -- Tabela tipos_peca (recriar para garantir estrutura se estiver faltando colunas críticas é uma opção, 
      -- mas 'valor_padrao' foi adicionado. Vamos assumir que se falhar é pq já existe)
      
      -- ALTER TABLE tipos_peca ADD COLUMN valor_padrao REAL DEFAULT 0; -- Perigoso se já existe

      -- Garantir colunas de responsavel na OS
      -- usuario_id, usuario_nome, usuario_email
      -- Também adicionaremos via safeAddColumn no código para segurança
    `
    // NOTA: Para colunas, melhor fazer no código ou uma migration que aceite falha. 
    // Vou deixar o 'users' aqui. A coluna valor_padrao e campos de usuario vou tratar no código de inicialização.
  },
  {
    version: 5,
    sql: `
      -- V5: Garantir colunas de responsável na OS (caso V4 já tenha rodado antes da alteração)
      ALTER TABLE ordens_servico ADD COLUMN usuario_id INTEGER;
      ALTER TABLE ordens_servico ADD COLUMN usuario_nome TEXT;
      ALTER TABLE ordens_servico ADD COLUMN usuario_email TEXT;
    `
  }
];

export const CURRENT_DB_VERSION = 3;
