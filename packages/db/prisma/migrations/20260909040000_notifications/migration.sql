-- Avisos. Se guardan siempre, aunque además salgan por WhatsApp: un aviso que
-- solo existió como mensaje no se puede volver a leer desde la consola.

DO $$
BEGIN
    CREATE TYPE "NotificationKind" AS ENUM
      ('LEAD_NUEVO', 'HANDOFF', 'VISITA_SOLICITADA', 'CONVERSACION_ASIGNADA', 'CANAL_CAIDO');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationPhone" TEXT;
ALTER TABLE "OrganizationMember" ADD COLUMN IF NOT EXISTS "notificationPrefs" JSONB;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx"
  ON "Notification" ("userId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_createdAt_idx"
  ON "Notification" ("organizationId", "createdAt");

DO $$
BEGIN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
