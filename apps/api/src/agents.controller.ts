import { Body, Controller, Get, Post } from '@nestjs/common';
class CreateAgentDto { name!: string; description?: string; operationMode?: 'AI'|'HUMAN'|'HYBRID'; responsibleUserId!: string; }
@Controller('agents') export class AgentsController { @Get() list(){return {data:[],meta:{total:0}}} @Post() create(@Body() dto:CreateAgentDto){return {data:{...dto,status:'DRAFT',aiEnabled:true}}} }
