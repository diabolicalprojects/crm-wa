import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AgentsController } from './agents.controller';
import { OpenWaGateway } from './openwa.gateway';
import { WhatsappController } from './whatsapp.controller';
import { PrismaService } from './prisma.service';
import { PropertiesController } from './properties.controller';
import { LeadsController } from './leads.controller';
import { ConversationsController } from './conversations.controller';
import { OpenWaWebhookController } from './openwa-webhook.controller';
@Module({controllers:[HealthController,AgentsController,WhatsappController,PropertiesController,LeadsController,ConversationsController,OpenWaWebhookController],providers:[OpenWaGateway,PrismaService]}) export class AppModule {}
