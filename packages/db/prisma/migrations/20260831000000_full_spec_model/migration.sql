-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('LEAD', 'AI', 'HUMAN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACT', 'POLL', 'CALL', 'REVOKED', 'MASKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'GENERATING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageOrigin" AS ENUM ('CRM', 'WHATSAPP', 'WHATSAPP_PHONE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('WHATSAPP', 'UPLOAD', 'IMPORT');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'STORED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PropertySourceType" AS ENUM ('MANUAL', 'CSV', 'EXCEL', 'API', 'XML', 'JSON', 'GOOGLE_SHEETS');

-- CreateEnum
CREATE TYPE "PropertySourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- AlterEnum
ALTER TYPE "LeadStage" ADD VALUE 'QUALIFYING';

-- AlterEnum
ALTER TYPE "PropertyStatus" ADD VALUE 'DRAFT';

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_assignedUserId_fkey";

-- DropIndex
DROP INDEX "Message_conversationId_providerMessageId_key";

-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "businessHours" JSONB,
ADD COLUMN     "handoffRules" JSONB,
ADD COLUMN     "modelConfigId" TEXT;

-- AlterTable
ALTER TABLE "WhatsappSession" ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "engineType" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "lastProviderStatus" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'OPENWA',
ADD COLUMN     "waAccountId" TEXT,
ADD COLUMN     "webhookConfiguredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "lastContactAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "whatsappChatId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Message: de texto libre a enums, conservando los mensajes existentes.
-- ---------------------------------------------------------------------------

ALTER TABLE "Message"
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "mediaId" TEXT,
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "providerTimestamp" TIMESTAMP(3),
  ADD COLUMN "replyToMessageId" TEXT,
  ADD COLUMN "senderType" "MessageSenderType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "senderUserId" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- El tenant y la sesión se derivan de la conversación a la que pertenece
-- el mensaje; son columnas nuevas obligatorias.
UPDATE "Message" m
SET "organizationId" = c."organizationId", "sessionId" = c."sessionId"
FROM "Conversation" c
WHERE c."id" = m."conversationId";

-- Un mensaje sin conversación no es recuperable ni referenciable.
DELETE FROM "Message" WHERE "organizationId" IS NULL;
ALTER TABLE "Message" ALTER COLUMN "organizationId" SET NOT NULL;

UPDATE "Message"
SET "senderType" = (CASE upper("authorType")
  WHEN 'LEAD' THEN 'LEAD'
  WHEN 'AI' THEN 'AI'
  WHEN 'HUMAN' THEN 'HUMAN'
  ELSE 'SYSTEM' END)::"MessageSenderType";
ALTER TABLE "Message" DROP COLUMN "authorType";

ALTER TABLE "Message" ALTER COLUMN "direction" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "direction" TYPE "MessageDirection"
  USING (CASE upper("direction") WHEN 'INBOUND' THEN 'INBOUND' ELSE 'OUTBOUND' END)::"MessageDirection";

ALTER TABLE "Message" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType"
  USING (CASE upper("type")
    WHEN 'TEXT' THEN 'TEXT'
    WHEN 'IMAGE' THEN 'IMAGE'
    WHEN 'VIDEO' THEN 'VIDEO'
    WHEN 'AUDIO' THEN 'AUDIO'
    WHEN 'VOICE' THEN 'VOICE'
    WHEN 'DOCUMENT' THEN 'DOCUMENT'
    WHEN 'STICKER' THEN 'STICKER'
    WHEN 'LOCATION' THEN 'LOCATION'
    WHEN 'CONTACT' THEN 'CONTACT'
    WHEN 'POLL' THEN 'POLL'
    WHEN 'CALL' THEN 'CALL'
    WHEN 'REVOKED' THEN 'REVOKED'
    WHEN 'MASKED' THEN 'MASKED'
    ELSE 'UNKNOWN' END)::"MessageType";
ALTER TABLE "Message" ALTER COLUMN "type" SET DEFAULT 'TEXT';

ALTER TABLE "Message" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "status" TYPE "MessageStatus"
  USING (CASE upper("status")
    WHEN 'RECEIVED' THEN 'RECEIVED'
    WHEN 'QUEUED' THEN 'QUEUED'
    WHEN 'GENERATING' THEN 'GENERATING'
    WHEN 'SENT' THEN 'SENT'
    WHEN 'DELIVERED' THEN 'DELIVERED'
    WHEN 'READ' THEN 'READ'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'QUEUED' END)::"MessageStatus";
ALTER TABLE "Message" ALTER COLUMN "status" SET DEFAULT 'QUEUED';

ALTER TABLE "Message" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "origin" TYPE "MessageOrigin"
  USING (CASE upper("origin")
    WHEN 'CRM' THEN 'CRM'
    WHEN 'WHATSAPP' THEN 'WHATSAPP'
    WHEN 'WHATSAPP_PHONE' THEN 'WHATSAPP_PHONE'
    ELSE 'SYSTEM' END)::"MessageOrigin";
ALTER TABLE "Message" ALTER COLUMN "origin" SET DEFAULT 'CRM';

-- ---------------------------------------------------------------------------
-- Property: se separa la ubicación y se tipan operación y tipo. Los campos
-- antiguos se copian a su equivalente antes de eliminarse.
-- ---------------------------------------------------------------------------

ALTER TABLE "Property"
  ADD COLUMN "addressDisplay" TEXT,
  ADD COLUMN "availableFrom" DATE,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "constructionM2" DECIMAL(10,2),
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'México',
  ADD COLUMN "externalReference" TEXT,
  ADD COLUMN "landM2" DECIMAL(10,2),
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7),
  ADD COLUMN "neighborhood" TEXT,
  ADD COLUMN "parkingSpaces" INTEGER,
  ADD COLUMN "propertySourceId" TEXT,
  ADD COLUMN "publicUrl" TEXT,
  ADD COLUMN "state" TEXT;

UPDATE "Property" SET
  "city" = NULLIF(btrim("location"), ''),
  "publicUrl" = "url",
  "constructionM2" = "areaM2",
  "externalReference" = "externalId";

ALTER TABLE "Property"
  DROP COLUMN "areaM2",
  DROP COLUMN "externalId",
  DROP COLUMN "location",
  DROP COLUMN "url";

ALTER TABLE "Property" ALTER COLUMN "operationType" TYPE "OperationType"
  USING (CASE upper("operationType")
    WHEN 'VENTA' THEN 'SALE'
    WHEN 'SALE' THEN 'SALE'
    WHEN 'COMPRA' THEN 'SALE'
    WHEN 'RENTA' THEN 'RENT'
    WHEN 'RENT' THEN 'RENT'
    WHEN 'ALQUILER' THEN 'RENT'
    ELSE 'SALE' END)::"OperationType";

ALTER TABLE "Property" ALTER COLUMN "propertyType" TYPE "PropertyType"
  USING (CASE upper("propertyType")
    WHEN 'CASA' THEN 'HOUSE'
    WHEN 'HOUSE' THEN 'HOUSE'
    WHEN 'DEPARTAMENTO' THEN 'APARTMENT'
    WHEN 'DEPA' THEN 'APARTMENT'
    WHEN 'DEPTO' THEN 'APARTMENT'
    WHEN 'APARTMENT' THEN 'APARTMENT'
    WHEN 'TERRENO' THEN 'LAND'
    WHEN 'LOTE' THEN 'LAND'
    WHEN 'LAND' THEN 'LAND'
    WHEN 'COMERCIAL' THEN 'COMMERCIAL'
    WHEN 'LOCAL' THEN 'COMMERCIAL'
    WHEN 'COMMERCIAL' THEN 'COMMERCIAL'
    WHEN 'OFICINA' THEN 'OFFICE'
    WHEN 'OFFICE' THEN 'OFFICE'
    ELSE 'OTHER' END)::"PropertyType";

ALTER TABLE "Property" ALTER COLUMN "bathrooms" SET DATA TYPE DECIMAL(4,1);
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "revokedAt" TIMESTAMP(3);


-- CreateTable
CREATE TABLE "AgentSessionAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "whatsappSessionId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "AgentSessionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMedia" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "altText" TEXT,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PropertySourceType" NOT NULL,
    "url" TEXT,
    "encryptedCredentials" TEXT,
    "mappingConfig" JSONB,
    "frequencyMinutes" INTEGER,
    "deactivatePolicy" TEXT NOT NULL DEFAULT 'MARK_INACTIVE',
    "cursor" TEXT,
    "status" "PropertySourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySyncRun" (
    "id" TEXT NOT NULL,
    "propertySourceId" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsRead" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "reportKey" TEXT,

    CONSTRAINT "PropertySyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadPropertyMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "matchReasons" JSONB,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadFeedback" TEXT,

    CONSTRAINT "LeadPropertyMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "originalFilename" TEXT,
    "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CRM',
    "personalEventId" TEXT,
    "sharedEventId" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "scope" "CalendarScope" NOT NULL DEFAULT 'PERSONAL',
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "externalAccountEmail" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "calendarId" TEXT,
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL,
    "aiProviderId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 1024,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "maxToolIterations" INTEGER NOT NULL DEFAULT 4,
    "monthlyTokenLimit" INTEGER,
    "costPerMillionIn" DECIMAL(10,4),
    "costPerMillionOut" DECIMAL(10,4),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "agentId" TEXT,
    "triggerMessageId" TEXT,
    "aiProviderId" TEXT,
    "aiModelConfigId" TEXT,
    "model" TEXT,
    "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "estimatedCost" DECIMAL(12,6),
    "toolsInvoked" JSONB,
    "instructionsVersion" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "sessionId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'OPENWA',
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSessionAssignment_organizationId_agentId_idx" ON "AgentSessionAssignment"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "AgentSessionAssignment_organizationId_whatsappSessionId_idx" ON "AgentSessionAssignment"("organizationId", "whatsappSessionId");

-- CreateIndex
CREATE INDEX "PropertyMedia_propertyId_position_idx" ON "PropertyMedia"("propertyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyMedia_propertyId_mediaAssetId_key" ON "PropertyMedia"("propertyId", "mediaAssetId");

-- CreateIndex
CREATE INDEX "PropertySource_organizationId_status_idx" ON "PropertySource"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PropertySyncRun_propertySourceId_startedAt_idx" ON "PropertySyncRun"("propertySourceId", "startedAt");

-- CreateIndex
CREATE INDEX "LeadPropertyMatch_organizationId_leadId_shownAt_idx" ON "LeadPropertyMatch"("organizationId", "leadId", "shownAt");

-- CreateIndex
CREATE INDEX "LeadPropertyMatch_propertyId_idx" ON "LeadPropertyMatch"("propertyId");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_status_idx" ON "MediaAsset"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_sha256_idx" ON "MediaAsset"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_startsAt_idx" ON "Appointment"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_syncStatus_idx" ON "Appointment"("organizationId", "syncStatus");

-- CreateIndex
CREATE INDEX "Appointment_assignedUserId_startsAt_idx" ON "Appointment"("assignedUserId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarConnection_organizationId_status_idx" ON "CalendarConnection"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_organizationId_userId_scope_key" ON "CalendarConnection"("organizationId", "userId", "scope");

-- CreateIndex
CREATE INDEX "AiModelConfig_organizationId_enabled_idx" ON "AiModelConfig"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "AiRun_organizationId_createdAt_idx" ON "AiRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_conversationId_createdAt_idx" ON "AiRun"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_organizationId_status_idx" ON "AiRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_receivedAt_idx" ON "WebhookEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE INDEX "Agent_organizationId_status_idx" ON "Agent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Agent_responsibleUserId_idx" ON "Agent"("responsibleUserId");

-- CreateIndex
CREATE INDEX "WhatsappSession_organizationId_status_idx" ON "WhatsappSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Lead_organizationId_stage_idx" ON "Lead"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_status_lastMessageAt_idx" ON "Conversation"("organizationId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_assignedUserId_idx" ON "Conversation"("assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_leadId_sessionId_key" ON "Conversation"("organizationId", "leadId", "sessionId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_status_idx" ON "Message"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Message_sessionId_providerMessageId_key" ON "Message"("sessionId", "providerMessageId");

-- CreateIndex
CREATE INDEX "Property_organizationId_status_operationType_idx" ON "Property"("organizationId", "status", "operationType");

-- CreateIndex
CREATE INDEX "Property_organizationId_city_idx" ON "Property"("organizationId", "city");

-- CreateIndex
CREATE INDEX "Property_organizationId_price_idx" ON "Property"("organizationId", "price");

-- CreateIndex
CREATE UNIQUE INDEX "Property_organizationId_propertySourceId_externalReference_key" ON "Property"("organizationId", "propertySourceId", "externalReference");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "AiModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSessionAssignment" ADD CONSTRAINT "AgentSessionAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSessionAssignment" ADD CONSTRAINT "AgentSessionAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSessionAssignment" ADD CONSTRAINT "AgentSessionAssignment_whatsappSessionId_fkey" FOREIGN KEY ("whatsappSessionId") REFERENCES "WhatsappSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSessionAssignment" ADD CONSTRAINT "AgentSessionAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsappSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_propertySourceId_fkey" FOREIGN KEY ("propertySourceId") REFERENCES "PropertySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMedia" ADD CONSTRAINT "PropertyMedia_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMedia" ADD CONSTRAINT "PropertyMedia_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertySource" ADD CONSTRAINT "PropertySource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertySyncRun" ADD CONSTRAINT "PropertySyncRun_propertySourceId_fkey" FOREIGN KEY ("propertySourceId") REFERENCES "PropertySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPropertyMatch" ADD CONSTRAINT "LeadPropertyMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPropertyMatch" ADD CONSTRAINT "LeadPropertyMatch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPropertyMatch" ADD CONSTRAINT "LeadPropertyMatch_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPropertyMatch" ADD CONSTRAINT "LeadPropertyMatch_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPropertyMatch" ADD CONSTRAINT "LeadPropertyMatch_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelConfig" ADD CONSTRAINT "AiModelConfig_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelConfig" ADD CONSTRAINT "AiModelConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_triggerMessageId_fkey" FOREIGN KEY ("triggerMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "AiProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_aiModelConfigId_fkey" FOREIGN KEY ("aiModelConfigId") REFERENCES "AiModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsappSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Traslado de datos de las tablas que cambiaron de nombre, y solo entonces
-- se eliminan las antiguas. La migración generada las borraba de entrada, lo
-- que habría perdido las visitas y las credenciales de IA ya configuradas.
-- ---------------------------------------------------------------------------

INSERT INTO "Appointment" (
  "id", "organizationId", "leadId", "propertyId", "assignedUserId",
  "startsAt", "endsAt", "timezone", "status", "notes", "source",
  "syncStatus", "syncVersion", "createdAt", "updatedAt"
)
SELECT
  v."id", v."organizationId", v."leadId",
  -- La cita nueva sí tiene llave foránea hacia la propiedad; una referencia
  -- rota se conserva como cita sin propiedad en vez de perder la visita.
  (SELECT p."id" FROM "Property" p WHERE p."id" = v."propertyId"),
  v."assignedUserId", v."startsAt", v."endsAt", 'America/Mexico_City',
  (CASE upper(v."status")
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'CONFIRMED' THEN 'CONFIRMED'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'NO_SHOW' THEN 'NO_SHOW'
    ELSE 'SCHEDULED' END)::"AppointmentStatus",
  v."notes", 'CRM', 'PENDING'::"SyncStatus", 0, v."createdAt", v."updatedAt"
FROM "Visit" v
WHERE EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = v."leadId")
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = v."assignedUserId");

-- Los proveedores LLM pasan al catálogo nuevo conservando la clave cifrada:
-- volver a capturarlas obligaría al superadministrador a tenerlas a la mano.
INSERT INTO "AiProvider" (
  "id", "name", "kind", "baseUrl", "encryptedApiKey",
  "supportsTools", "supportsStreaming", "enabled", "createdAt", "updatedAt"
)
SELECT
  p."id", p."name",
  (CASE upper(p."provider")
    WHEN 'ANTHROPIC' THEN 'ANTHROPIC'
    WHEN 'CLAUDE' THEN 'ANTHROPIC'
    WHEN 'GEMINI' THEN 'GEMINI'
    WHEN 'GOOGLE' THEN 'GEMINI'
    WHEN 'OPENAI' THEN 'OPENAI'
    ELSE 'OPENAI_COMPATIBLE' END)::"AiProviderKind",
  p."baseUrl", p."encryptedApiKey", true, true, p."enabled", p."createdAt", p."updatedAt"
FROM "LlmProvider" p;

INSERT INTO "AiModelConfig" (
  "id", "aiProviderId", "name", "model", "temperature", "maxTokens",
  "promptVersion", "maxToolIterations", "isDefault", "enabled", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), p."id", p."name" || ' · ' || p."model", p."model", 0.3, 1024, 'v1', 4,
  (row_number() OVER (ORDER BY p."createdAt") = 1),
  p."enabled", now(), now()
FROM "LlmProvider" p;

DROP TABLE "Visit";
DROP TABLE "LlmProvider";

-- ---------------------------------------------------------------------------
-- Índices únicos parciales que Prisma no puede declarar (spec §11.6): impiden
-- que un agente o una sesión tengan más de una asignación activa a la vez.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "AgentSessionAssignment_agent_active_key"
  ON "AgentSessionAssignment" ("agentId")
  WHERE "unassignedAt" IS NULL;

CREATE UNIQUE INDEX "AgentSessionAssignment_session_active_key"
  ON "AgentSessionAssignment" ("whatsappSessionId")
  WHERE "unassignedAt" IS NULL;
