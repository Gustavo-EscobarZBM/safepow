import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { LossSource } from '../loss.entity';

export class CreateLossDto {
  // Gerado no próprio celular no momento do registro (Seção 4.2 do documento).
  // É o que permite reenviar com segurança quando a conexão volta, sem duplicar.
  @IsUUID()
  clientGeneratedId: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  quantity?: number;

  // Seleção obrigatória (sem texto livre) — referencia o catálogo cadastrado
  // em Cadastros > Local da Perda.
  @IsUUID()
  locationId: string;

  // Referencia o catálogo cadastrado em Cadastros > Motivo da Perda.
  @IsUUID()
  reasonId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsDateString()
  occurredAt: string;

  // Enviado explicitamente por cada cliente (app mobile ou painel web) — não
  // dá pra inferir com segurança a partir do papel do usuário, já que um
  // funcionário também pode acessar o formulário simplificado do painel.
  @IsOptional()
  @IsEnum(LossSource)
  source?: LossSource;
}
