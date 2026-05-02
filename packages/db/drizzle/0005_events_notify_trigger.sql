-- Postgres NOTIFY hook for the realtime gateway.
--
-- Every INSERT into `events` fires NOTIFY on channel `munin_events` with
-- the row serialized as JSON. The DbListenerService (single LISTEN per
-- backend process) fans the payload out to subscribed websocket clients.
-- No application code needs to opt in — emitters keep using
-- WebhookDispatcher.emit() and the trigger handles propagation.

CREATE OR REPLACE FUNCTION events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('munin_events', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_notify_trigger
AFTER INSERT ON "events"
FOR EACH ROW EXECUTE FUNCTION events_notify();
