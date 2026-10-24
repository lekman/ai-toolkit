-- item_log and item_history are append only. UPDATE is always refused.
-- DELETE is refused unless it comes from deleting the parent item: the
-- ON DELETE CASCADE runs inside a referential-integrity trigger, so the
-- trigger depth is above 1 there and exactly 1 for a direct DELETE.
CREATE FUNCTION refuse_append_only_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER item_log_append_only BEFORE UPDATE OR DELETE ON item_log
  FOR EACH ROW EXECUTE FUNCTION refuse_append_only_change();
--> statement-breakpoint
CREATE TRIGGER item_history_append_only BEFORE UPDATE OR DELETE ON item_history
  FOR EACH ROW EXECUTE FUNCTION refuse_append_only_change();
