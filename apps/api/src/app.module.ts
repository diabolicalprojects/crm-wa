import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AgentsController } from './agents.controller';
import { AiController } from './ai.controller';
import { AiGateway } from './ai-gateway';
import { AiToolsService } from './ai-tools.service';
import { AppointmentsController } from './appointments.controller';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { AuditController } from './audit.controller';
import { AuthController, AuthService, JwtGuard, RolesGuard } from './auth';
import { CalendarController, GoogleClientController } from './calendar.controller';
import { CalendarSyncService } from './calendar-sync.service';
import { FollowUpService } from './follow-up.service';
import { GoogleCalendarService } from './google-calendar.service';
import { AutomationService } from './automation.service';
import { ContactsController } from './contacts.controller';
import { ConversationsController } from './conversations.controller';
import { DashboardController } from './dashboard.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HealthController } from './health.controller';
import { ImportsController } from './imports.controller';
import { LeadsController } from './leads.controller';
import { MediaController } from './media.controller';
import { MediaFetchService } from './media-fetch.service';
import { MediaStorageService } from './media-storage.service';
import { OpenWaGateway } from './openwa.gateway';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OpenWaIngestService } from './openwa-ingest.service';
import { OpenWaWebhookController } from './openwa-webhook.controller';
import { OrganizationsController } from './organizations.controller';
import {
  PermissionsController,
  PermissionsGuard,
  PermissionsService,
} from './permissions';
import { PrismaService } from './prisma.service';
import { PropertiesController } from './properties.controller';
import { PublicPropertyController } from './public-property.controller';
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
    PublicPropertyController,
    LeadsController,
    ContactsController,
    ConversationsController,
    AssignmentController,
    PermissionsController,
    NotificationsController,
    MediaController,
    OpenWaWebhookController,
  ],
  providers: [
    PrismaService,
    SecretsService,
    EventsService,
    AuthService,
    OpenWaGateway,
    OpenWaIngestService,
    AssignmentService,
    PermissionsService,
    NotificationsService,
    MediaStorageService,
    MediaFetchService,
    FollowUpService,
    AiGateway,
    AiToolsService,
    AutomationService,
    GoogleCalendarService,
    CalendarSyncService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Después del de roles: el rol es el filtro grueso y el permiso el fino.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
