-- Excepciones de permisos por miembro, encima del rol.
ALTER TABLE "OrganizationMember" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
