CREATE OR REPLACE FUNCTION validate_compensation_allocation_activation()
RETURNS trigger AS $$
DECLARE
  total_bps INTEGER;
  direct_people INTEGER;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'compensation allocations must be created inactive and activated after entries are complete';
  END IF;
  SELECT COALESCE(SUM(compensation_bps), 0),
         COUNT(*) FILTER (WHERE recipient_type = 'person')
    INTO total_bps, direct_people
    FROM compensation_allocation_entries
   WHERE allocation_id = NEW.id;
  IF total_bps <> 10000 THEN
    RAISE EXCEPTION 'active compensation allocation must total exactly 10000 basis points';
  END IF;
  IF direct_people > 5 THEN
    RAISE EXCEPTION 'active compensation allocation may include at most 5 direct people';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
