BEGIN;

CREATE TABLE IF NOT EXISTS chart_question_conversations (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL REFERENCES sales_analyses(id) ON DELETE CASCADE,
    archived_at timestamptz
);

ALTER TABLE chart_question_conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS chart_question_active_conversation_idx
    ON chart_question_conversations (analysis_id) WHERE archived_at IS NULL;
ALTER TABLE chart_question_conversations DROP CONSTRAINT IF EXISTS chart_question_conversations_analysis_id_key;

CREATE INDEX IF NOT EXISTS chart_question_conversations_analysis_idx
    ON chart_question_conversations (analysis_id);

CREATE TABLE IF NOT EXISTS chart_question_turns (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES chart_question_conversations(id) ON DELETE CASCADE,
    client_message_id uuid NOT NULL,
    sequence_no bigint GENERATED ALWAYS AS IDENTITY,
    question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
    chart text NOT NULL CHECK (chart IN ('MONTHLY_SALES', 'MARKET_CARD_SALES', 'JEJU_BSI', 'TIME_SERIES')),
    requested_plan_id uuid,
    answer jsonb NOT NULL,
    UNIQUE (conversation_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS chart_question_turns_history_idx
    ON chart_question_turns (conversation_id, sequence_no);

COMMIT;
