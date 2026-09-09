-- Seguimiento proactivo. Apagado por omisión: mandar mensajes no solicitados
-- en nombre de una agencia es su decisión, no la nuestra.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "followUpDelayHours" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "followUpMaxAttempts" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "followUpCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastFollowUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "followUpOptOut" BOOLEAN NOT NULL DEFAULT false;

-- El barrido busca conversaciones calladas: sin este índice recorre la tabla
-- entera cada minuto.
CREATE INDEX IF NOT EXISTS "Conversation_followup_idx"
  ON "Conversation" ("status", "mode", "lastOutboundAt");
