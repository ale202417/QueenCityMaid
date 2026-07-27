INSERT INTO service_types
  (id, organization_id, name, category, default_duration_minutes, reference_checklist)
SELECT
  gen_random_uuid(), id, 'Regular Cleaning', 'residential', 180,
  '["Kitchen","Bathrooms","Bedrooms","Floors"]'::jsonb
FROM organizations
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO service_types
  (id, organization_id, name, category, default_duration_minutes, reference_checklist)
SELECT
  gen_random_uuid(), id, 'Deep Cleaning', 'residential', 300,
  '["Kitchen","Bathrooms","Baseboards","Fixtures","Floors"]'::jsonb
FROM organizations
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO service_types
  (id, organization_id, name, category, default_duration_minutes, reference_checklist)
SELECT
  gen_random_uuid(), id, 'Move In Cleaning', 'residential', 300,
  '["Kitchen","Bathrooms","Cabinets","Closets","Floors"]'::jsonb
FROM organizations
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO service_types
  (id, organization_id, name, category, default_duration_minutes, reference_checklist)
SELECT
  gen_random_uuid(), id, 'Move Out Cleaning', 'residential', 300,
  '["Kitchen","Bathrooms","Cabinets","Closets","Floors"]'::jsonb
FROM organizations
ON CONFLICT (organization_id, name) DO NOTHING;
