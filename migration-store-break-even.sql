CREATE TABLE IF NOT EXISTS store_break_even_settings (
    store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    rent_won BIGINT NOT NULL CHECK (rent_won BETWEEN 0 AND 1000000000000),
    payroll_won BIGINT NOT NULL CHECK (payroll_won BETWEEN 0 AND 1000000000000),
    other_won BIGINT NOT NULL CHECK (other_won BETWEEN 0 AND 1000000000000),
    operating_days INTEGER NOT NULL CHECK (operating_days BETWEEN 1 AND 31),
    extra_variable_percent NUMERIC(5,2) NOT NULL CHECK (extra_variable_percent >= 0 AND extra_variable_percent < 100),
    ingredient_percent_override NUMERIC(5,2) CHECK (ingredient_percent_override >= 0 AND ingredient_percent_override < 100)
);
