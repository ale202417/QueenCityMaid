CREATE INDEX customers_name_search_idx
  ON customers (organization_id, lower(name) text_pattern_ops);

CREATE INDEX customers_email_search_idx
  ON customers (organization_id, lower(email) text_pattern_ops);

CREATE INDEX customers_phone_search_idx
  ON customers (organization_id, lower(phone) text_pattern_ops);

CREATE INDEX properties_address_search_idx
  ON properties (organization_id, lower(address_line1) text_pattern_ops);

CREATE INDEX properties_city_search_idx
  ON properties (organization_id, lower(city) text_pattern_ops);

CREATE INDEX employees_name_search_idx
  ON employees (
    organization_id,
    lower(last_name) text_pattern_ops,
    lower(first_name) text_pattern_ops
  );

CREATE INDEX leads_name_search_idx
  ON leads (organization_id, lower(name) text_pattern_ops);

CREATE INDEX leads_phone_search_idx
  ON leads (organization_id, lower(phone) text_pattern_ops);
