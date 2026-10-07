-- Контакты и их пользовательские поля. Справочник полей теперь хранит поля и сделок, и контактов.

ALTER TABLE dim_userfield ADD COLUMN entity text NOT NULL DEFAULT 'deal';  -- deal | contact
ALTER TABLE dim_userfield DROP CONSTRAINT dim_userfield_pkey;
ALTER TABLE dim_userfield ADD PRIMARY KEY (entity, field_name);

-- Личные данные (имя, телефон, почта, адрес, дата рождения) по умолчанию не сохраняются:
-- для аналитики нужны источник, даты, ответственный и пользовательские поля.
CREATE TABLE fact_contact (
    id             bigint PRIMARY KEY,
    type_id        text,
    source_id      text,
    assigned_by_id integer,
    company_id     bigint,
    lead_id        bigint,
    date_create    timestamptz,
    date_modify    timestamptz,
    user_fields    jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw            jsonb NOT NULL,
    is_deleted     boolean NOT NULL DEFAULT false,
    deleted_at     timestamptz,
    synced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_contact_date_create_idx ON fact_contact (date_create);
CREATE INDEX fact_contact_date_modify_idx ON fact_contact (date_modify);
CREATE INDEX fact_contact_source_idx      ON fact_contact (source_id);
