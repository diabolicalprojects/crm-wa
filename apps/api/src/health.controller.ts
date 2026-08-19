import { Controller, Get } from '@nestjs/common';
import { Public } from './auth';
@Public() @Controller('health') export class HealthController { @Get() check(){return {status:'ok',service:'crm-api',timestamp:new Date().toISOString()}} }
