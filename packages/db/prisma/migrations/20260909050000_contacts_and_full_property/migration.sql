-- Contactos separados de oportunidades, y la ficha de propiedad completa.

-- Las cuatro operaciones que faltaban. PostgreSQL 16 admite ADD VALUE dentro de
-- una transacción siempre que el valor nuevo no se use en la misma; aquí no se
-- usa, solo se declara.
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'PRESALE';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'DEVELOPMENT';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'TEMPORARY';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'AUCTION';

DO $$
BEGIN
    CREATE TYPE "LegalStatus" AS ENUM
      ('ESCRITURADO', 'EJIDAL', 'CESION_DERECHOS', 'INFONAVIT_FOVISSSTE', 'POSESION', 'EN_TRAMITE', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "ContactKind" AS ENUM ('OWNER', 'BUYER', 'BROKER', 'NOTARY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "kind" "ContactKind" NOT NULL DEFAULT 'OTHER',
    "company" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_organizationId_phone_key" ON "Contact" ("organizationId", "phone");
CREATE INDEX IF NOT EXISTS "Contact_organizationId_kind_idx" ON "Contact" ("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "Contact_organizationId_name_idx" ON "Contact" ("organizationId", "name");

DO $$
BEGIN
    ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "Contact" ADD CONSTRAINT "Contact_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "ownerContactId" TEXT,
  ADD COLUMN IF NOT EXISTS "internalCode" TEXT,
  ADD COLUMN IF NOT EXISTS "halfBathrooms" INTEGER,
  ADD COLUMN IF NOT EXISTS "levels" INTEGER,
  ADD COLUMN IF NOT EXISTS "yearBuilt" INTEGER,
  ADD COLUMN IF NOT EXISTS "maintenanceFee" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "legalStatus" "LegalStatus",
  ADD COLUMN IF NOT EXISTS "videoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "tourUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "privateNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionPercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "sharedCommission" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "exclusivity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exclusivityUntil" DATE,
  ADD COLUMN IF NOT EXISTS "showExactAddress" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shareToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Property_shareToken_key" ON "Property" ("shareToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Property_organizationId_internalCode_key" ON "Property" ("organizationId", "internalCode");
CREATE INDEX IF NOT EXISTS "Property_organizationId_responsibleUserId_idx" ON "Property" ("organizationId", "responsibleUserId");

DO $$
BEGIN
    ALTER TABLE "Property" ADD CONSTRAINT "Property_responsibleUserId_fkey"
      FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerContactId_fkey"
      FOREIGN KEY ("ownerContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
