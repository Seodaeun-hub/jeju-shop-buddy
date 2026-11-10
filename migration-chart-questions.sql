BEGIN;

CREATE TABLE IF NOT EXISTS chart_question_conversations (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL UNIQUE REFERENCES sales_analyses(id) ON DELETE CASCADE
);

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
