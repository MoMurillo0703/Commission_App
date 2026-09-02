CREATE TRIGGER group_comp_agreements_validate_insert
BEFORE INSERT ON group_compensation_agreements
BEGIN
  SELECT CASE
    WHEN NEW.compensation_bps <= 0 OR NEW.compensation_bps > 10000
    THEN RAISE(ABORT, 'compensation agreement split must be greater than 0 and no more than 100 percent')
  END;

  SELECT CASE
    WHEN NEW.status = 'active' AND EXISTS (
      SELECT 1
      FROM group_compensation_agreements AS existing
      WHERE existing.status = 'active'
        AND existing.group_id = NEW.group_id
        AND existing.line_of_business_id = NEW.line_of_business_id
        AND NEW.effective_start <= COALESCE(existing.effective_end, '9999-12')
        AND existing.effective_start <= COALESCE(NEW.effective_end, '9999-12')
    )
    THEN RAISE(ABORT, 'overlapping active compensation agreement for group and line of business')
  END;
END;

CREATE TRIGGER group_comp_agreements_validate_update
BEFORE UPDATE ON group_compensation_agreements
BEGIN
  SELECT CASE
    WHEN NEW.compensation_bps <= 0 OR NEW.compensation_bps > 10000
    THEN RAISE(ABORT, 'compensation agreement split must be greater than 0 and no more than 100 percent')
  END;

  SELECT CASE
    WHEN NEW.status = 'active' AND EXISTS (
      SELECT 1
      FROM group_compensation_agreements AS existing
      WHERE existing.status = 'active'
        AND existing.id <> NEW.id
        AND existing.group_id = NEW.group_id
        AND existing.line_of_business_id = NEW.line_of_business_id
        AND NEW.effective_start <= COALESCE(existing.effective_end, '9999-12')
        AND existing.effective_start <= COALESCE(NEW.effective_end, '9999-12')
    )
    THEN RAISE(ABORT, 'overlapping active compensation agreement for group and line of business')
  END;
END;
