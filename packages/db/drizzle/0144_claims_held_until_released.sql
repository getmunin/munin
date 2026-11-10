-- A take-over now holds a conversation until someone releases it, closes it, or
-- takes it over, rather than lapsing after 30 minutes and handing the customer's
-- next message back to the agent. A null expires_at means "held until released";
-- the implicit claim a reply makes still carries a TTL.
ALTER TABLE "claims" ALTER COLUMN "expires_at" DROP NOT NULL;
