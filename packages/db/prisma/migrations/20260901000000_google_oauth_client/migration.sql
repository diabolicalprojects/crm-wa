-- CreateTable
CREATE TABLE "GoogleOAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedClientSecret" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthClient_pkey" PRIMARY KEY ("id")
);


-- ---------------------------------------------------------------------------
-- El índice único de CalendarConnection incluye `userId`, y en Postgres dos
-- NULL no colisionan: una agencia podría acabar con varios calendarios
-- compartidos y la sincronización no sabría a cuál escribir. Este índice
-- parcial impone uno solo por agencia.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_shared_unique"
  ON "CalendarConnection" ("organizationId")
  WHERE "userId" IS NULL;
