import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AgentsController } from './agents.controller';
import { OpenWaGateway } from './openwa.gateway';
import { WhatsappController } from './whatsapp.controller';
@Module({controllers:[HealthController,AgentsController,WhatsappController],providers:[OpenWaGateway]}) export class AppModule {}
