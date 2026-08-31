import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AgentsController } from './agents.controller';
import { AiController } from './ai.controller';
import { AiGateway } from './ai-gateway';
import { AiToolsService } from './ai-tools.service';
import { AppointmentsController } from './appointments.controller';
import { AuditController } from './audit.controller';
import { AuthController, AuthService, JwtGuard, RolesGuard } from './auth';
import { CalendarController, GoogleClientController } from './calendar.controller';
import { CalendarSyncService } from './calendar-sync.service';
import { GoogleCalendarService } from './google-calendar.service';
import { AutomationService } from './automation.service';
import { ConversationsController } from './conversations.controller';
import { DashboardController } from './dashboard.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HealthController } from './health.controller';
import { ImportsController } from './imports.controller';
import { LeadsController } from './leads.controller';
import { OpenWaGateway } from './openwa.gateway';
import { OpenWaIngestService } from './openwa-ingest.service';
import { OpenWaWebhookController } from './openwa-webhook.controller';
import { OrganizationsController } from './organizations.controller';
import { PrismaService } from './prisma.service';
import { PropertiesController } from './properties.controller';
import { SecretsService } from './secrets.service';
import { SystemController } from './system.controller';
import { WhatsappController } from './whatsapp.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    OrganizationsController,
    DashboardController,
    AuditController,
    EventsController,
    SystemController,
    ImportsController,
    AiController,
    AppointmentsController,
    CalendarController,
    GoogleClientController,
    AgentsController,
    WhatsappController,
    PropertiesController,
    LeadsController,
    ConversationsController,
    OpenWaWebhookController,
  ],
  providers: [
    PrismaService,
    SecretsService,
    EventsService,
    AuthService,
    OpenWaGateway,
    OpenWaIngestService,
    AiGateway,
    AiToolsService,
    AutomationService,
    GoogleCalendarService,
    CalendarSyncService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
