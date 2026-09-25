import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { JustificationDto } from '../../approvals/dto/justification.dto';

// Edição manual pelo gerente — não inclui clientGeneratedId, reportedByUserId
// nem source, que são fixados no momento da criação e não fazem sentido mudar.
export class UpdateLossDto extends JustificationDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  quantity?: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  reasonId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
