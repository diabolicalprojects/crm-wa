-- Multimedia en la conversación.
--
-- Los bytes viven en PostgreSQL: no hay S3 ni MinIO en esta infraestructura y
-- un volumen local no sobrevive a la recreación del contenedor. `storageKey`
-- lleva el prefijo del backend para que migrar a otro sea cambiar una clase.

ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "MediaBlob" (
    "mediaAssetId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("mediaAssetId")
);

DO $$
BEGIN
    ALTER TABLE "MediaBlob"
      ADD CONSTRAINT "MediaBlob_mediaAssetId_fkey"
      FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
