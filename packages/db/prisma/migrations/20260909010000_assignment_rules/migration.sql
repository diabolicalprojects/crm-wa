-- Reglas de asignación de prospectos.

DO $$
BEGIN
    CREATE TYPE "AssignmentMode" AS ENUM ('CHANNEL_RESPONSIBLE', 'ROUND_ROBIN', 'ON_DUTY', 'OWNER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'CHANNEL_RESPONSIBLE',
  ADD COLUMN IF NOT EXISTS "stickyAdvisor" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "dutySchedule" JSONB,
  ADD COLUMN IF NOT EXISTS "lastAssignedUserId" TEXT;
