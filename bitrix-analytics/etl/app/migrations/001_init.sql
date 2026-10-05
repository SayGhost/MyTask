-- Начальная схема хранилища: служебные таблицы, справочники (dim_*) и факты (fact_*).

CREATE TABLE sync_state (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_log (
    id             bigserial PRIMARY KEY,
    entity         text NOT NULL,
    mode           text NOT NULL,
    status         text NOT NULL DEFAULT 'running',  -- running | ok | error
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    rows_processed integer NOT NULL DEFAULT 0,
    error          text
);
CREATE INDEX sync_log_started_idx ON sync_log (started_at DESC);

-- Воронки сделок (id = 0 — «Общая»)
CREATE TABLE dim_category (
    id         integer PRIMARY KEY,
    name       text NOT NULL,
    sort       integer,
    is_default boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Стадии сделок. stage_id вида 'NEW' или 'C1:NEW'; semantics: 'S' успех, 'F' провал, NULL в работе
CREATE TABLE dim_stage (
    stage_id    text PRIMARY KEY,
    category_id integer NOT NULL,
    name        text NOT NULL,
    sort        integer,
    semantics   text,
    color       text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dim_source (
    source_id  text PRIMARY KEY,
    name       text NOT NULL,
    sort       integer,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dim_deal_type (
    type_id    text PRIMARY KEY,
    name       text NOT NULL,
    sort       integer,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dim_user (
    id            integer PRIMARY KEY,
    full_name     text NOT NULL,
    name          text,
    last_name     text,
    email         text,
    is_active     boolean NOT NULL DEFAULT true,
    work_position text,
    department_ids jsonb,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Пользовательские поля сделок (UF_CRM_*) с подписями и значениями списков
CREATE TABLE dim_userfield (
    field_name  text PRIMARY KEY,
    label       text,
    user_type   text,
    enum_values jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fact_deal (
    id                 bigint PRIMARY KEY,
    title              text,
    category_id        integer NOT NULL DEFAULT 0,
    stage_id           text,
    stage_semantic_id  text,           -- P в работе, S успех, F провал
    is_closed          boolean NOT NULL DEFAULT false,
    opportunity        numeric(18, 2),
    currency_id        text,
    assigned_by_id     integer,
    created_by_id      integer,
    source_id          text,
    type_id            text,
    company_id         bigint,
    contact_id         bigint,
    lead_id            bigint,
    begin_date         timestamptz,
    date_create        timestamptz,
    date_modify        timestamptz,
    close_date         timestamptz,    -- у открытых сделок это плановая дата, не фактическая
    utm_source         text,
    utm_medium         text,
    utm_campaign       text,
    utm_content        text,
    utm_term           text,
    user_fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw                jsonb NOT NULL,
    is_deleted         boolean NOT NULL DEFAULT false,
    deleted_at         timestamptz,
    synced_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_deal_date_create_idx ON fact_deal (date_create);
CREATE INDEX fact_deal_close_date_idx  ON fact_deal (close_date);
CREATE INDEX fact_deal_date_modify_idx ON fact_deal (date_modify);
CREATE INDEX fact_deal_stage_idx       ON fact_deal (category_id, stage_id);
CREATE INDEX fact_deal_assigned_idx    ON fact_deal (assigned_by_id);
CREATE INDEX fact_deal_source_idx      ON fact_deal (source_id);

-- История переходов сделок по стадиям (только дописывается)
CREATE TABLE fact_stage_history (
    id                bigint PRIMARY KEY,
    deal_id           bigint NOT NULL,
    category_id       integer,
    stage_id          text,
    stage_semantic_id text,
    type_id           integer,
    created_time      timestamptz,
    synced_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_stage_history_deal_idx  ON fact_stage_history (deal_id);
CREATE INDEX fact_stage_history_time_idx  ON fact_stage_history (created_time);
CREATE INDEX fact_stage_history_stage_idx ON fact_stage_history (stage_id, created_time);
