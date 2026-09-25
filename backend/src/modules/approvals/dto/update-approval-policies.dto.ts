import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsNumber, Max, Min, ValidateNested } from 'class-validator';

class PolicyToggleDto {
  @IsBoolean()
  enabled: boolean;
}

class PriceChangePolicyDto extends PolicyToggleDto {
  @IsNumber()
  @Min(1)
  @Max(1000)
  thresholdPercent: number;
}

/** As 4 políticas, sempre completas (o painel envia o formulário inteiro). */
export class UpdateApprovalPoliciesDto {
  @IsDefined() @ValidateNested() @Type(() => PriceChangePolicyDto) price_change: PriceChangePolicyDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) retro_fix: PolicyToggleDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) loss_edit: PolicyToggleDto;
  @IsDefined() @ValidateNested() @Type(() => PolicyToggleDto) archive_with_history: PolicyToggleDto;
}
