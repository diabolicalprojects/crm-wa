-- El agente puede confirmar una visita cuando pudo comprobar que la hora está
-- libre. Apagado por omisión: sin calendario vinculado no hay qué comprobar.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "autoConfirmVisits" BOOLEAN NOT NULL DEFAULT false;
