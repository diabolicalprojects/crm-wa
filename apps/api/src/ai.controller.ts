import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AiProviderKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AI_PROVIDER_CATALOG, defaultBaseUrlFor, defaultModelFor } from './ai-catalog';
import { AiGateway } from './ai-gateway';
import { Roles } from './auth';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';

class CreateProviderDto {
  @IsString() @Length(2, 80) name!: string;
  @IsEnum(AiProviderKind) kind!: AiProviderKind;
  @IsString() @Length(8, 400) apiKey!: string;
  @IsOptional() @IsUrl({ require_tld: false }) baseUrl?: string;
  /** Modelo inicial; si se omite se usa el recomendado del catálogo. */
  @IsOptional() @IsString() model?: string;
}

class UpdateProviderDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() @Length(8, 400) apiKey?: string;
  @IsOptional() @IsUrl({ require_tld: false }) baseUrl?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class CreateModelConfigDto {
  @IsString() aiProviderId!: string;
  @IsString() @Length(2, 80) name!: string;
  @IsString() @Length(1, 120) model!: string;
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(2) temperature?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(64) @Max(32000) maxTokens?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateModelConfigDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() @Length(1, 120) model?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(2) temperature?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(64) @Max(32000) maxTokens?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

/**
 * Administración global de IA. Solo `SUPER_ADMIN`: las agencias consumen
 * configuraciones autorizadas y nunca ven ni administran credenciales
 * (spec §11.15 y §13.0).
 */
@Roles('SUPER_ADMIN')
@Controller('admin/ai')
export class AiController {
  constructor(
    private db: PrismaService,
    private secrets: SecretsService,
    private gateway: AiGateway,
  ) {}

  /** Catálogo que alimenta los selectores de proveedor y modelo. */
  @Get('catalog')
  catalog() {
    return AI_PROVIDER_CATALOG;
  }

  @Get('providers')
  async listProviders() {
    const providers = await this.db.aiProvider.findMany({
      include: { _count: { select: { modelConfigs: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return providers.map((provider) => this.mask(provider));
  }

  @Post('providers')
  async createProvider(@Body() dto: CreateProviderDto) {
    const model = dto.model ?? defaultModelFor(dto.kind);
    if (!model) {
      throw new BadRequestException('Este proveedor requiere que especifiques un modelo');
    }
    const baseUrl = dto.baseUrl ?? defaultBaseUrlFor(dto.kind);
    if (dto.kind === 'OPENAI_COMPATIBLE' && !baseUrl) {
      throw new BadRequestException('Un proveedor compatible requiere la URL base');
    }

    // Verificar la credencial antes de guardarla evita descubrir el error
    // cuando un prospecto real está esperando respuesta.
    const check = await this.gateway.test({ kind: dto.kind, apiKey: dto.apiKey, baseUrl }, model);
    if (!check.ok) throw new BadRequestException(`El proveedor rechazó la credencial: ${check.error}`);

    const provider = await this.db.aiProvider.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        baseUrl,
        encryptedApiKey: this.secrets.encrypt(dto.apiKey),
        modelConfigs: {
          create: {
            name: `${dto.name} · ${model}`,
            model,
            isDefault: (await this.db.aiModelConfig.count()) === 0,
          },
        },
      },
      include: { _count: { select: { modelConfigs: true } } },
    });
    return this.mask(provider);
  }

  @Patch('providers/:id')
  async updateProvider(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    const provider = await this.db.aiProvider.update({
      where: { id },
      data: {
        name: dto.name,
        baseUrl: dto.baseUrl,
        enabled: dto.enabled,
        ...(dto.apiKey ? { encryptedApiKey: this.secrets.encrypt(dto.apiKey) } : {}),
      },
      include: { _count: { select: { modelConfigs: true } } },
    });
    return this.mask(provider);
  }

  @Post('providers/:id/test')
  async testProvider(@Param('id') id: string, @Body() body: { model?: string }) {
    const provider = await this.db.aiProvider.findUnique({
      where: { id },
      include: { modelConfigs: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    if (!provider) throw new NotFoundException('Proveedor no encontrado');
    const model = body.model ?? provider.modelConfigs[0]?.model ?? defaultModelFor(provider.kind);
    if (!model) throw new BadRequestException('Indica un modelo para probar');
    return this.gateway.test(
      {
        kind: provider.kind,
        apiKey: this.secrets.decrypt(provider.encryptedApiKey),
        baseUrl: provider.baseUrl ?? undefined,
      },
      model,
    );
  }

  @Delete('providers/:id')
  removeProvider(@Param('id') id: string) {
    return this.db.aiProvider.delete({ where: { id } });
  }

  @Get('models')
  listModels() {
    return this.db.aiModelConfig.findMany({
      include: {
        provider: { select: { id: true, name: true, kind: true, enabled: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('models')
  async createModel(@Body() dto: CreateModelConfigDto) {
    if (dto.isDefault) await this.clearDefault();
    return this.db.aiModelConfig.create({ data: { ...dto }, include: { provider: true } });
  }

  @Patch('models/:id')
  async updateModel(@Param('id') id: string, @Body() dto: UpdateModelConfigDto) {
    if (dto.isDefault) await this.clearDefault();
    return this.db.aiModelConfig.update({ where: { id }, data: { ...dto }, include: { provider: true } });
  }

  @Delete('models/:id')
  removeModel(@Param('id') id: string) {
    return this.db.aiModelConfig.delete({ where: { id } });
  }

  /** Consumo por agencia, para la vista de superadministración (spec §14.1.1). */
  @Get('usage')
  async usage() {
    const runs = await this.db.aiRun.groupBy({
      by: ['organizationId', 'status'],
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true },
    });
    const organizations = await this.db.organization.findMany({ select: { id: true, name: true } });
    const byId = new Map(organizations.map((item) => [item.id, item.name]));
    return runs.map((row) => ({
      organizationId: row.organizationId,
      organization: byId.get(row.organizationId) ?? 'Desconocida',
      status: row.status,
      runs: row._count._all,
      promptTokens: row._sum.promptTokens ?? 0,
      completionTokens: row._sum.completionTokens ?? 0,
    }));
  }

  private clearDefault() {
    return this.db.aiModelConfig.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  /** La clave cifrada nunca sale del backend, ni siquiera enmascarada a medias. */
  private mask<T extends { encryptedApiKey: string }>(provider: T): Omit<T, 'encryptedApiKey'> & {
    hasApiKey: boolean;
  } {
    const { encryptedApiKey, ...rest } = provider;
    return { ...rest, hasApiKey: Boolean(encryptedApiKey) };
  }
}
