import { Controller, Get, Param, Post } from '@nestjs/common';
import { OpenWaGateway } from './openwa.gateway';
@Controller('whatsapp/sessions') export class WhatsappController { constructor(private readonly openwa:OpenWaGateway){} @Post() create(){return this.openwa.createSession(`crm-${Date.now()}`)} @Post(':id/start') start(@Param('id') id:string){return this.openwa.startSession(id)} @Get(':id/qr') qr(@Param('id') id:string){return this.openwa.getQr(id)} @Get(':id/status') status(@Param('id') id:string){return this.openwa.getStatus(id)} }
