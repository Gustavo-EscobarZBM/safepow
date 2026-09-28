import { IsOptional, IsString, Length } from 'class-validator';

/** Corpo de POST /imports/:id/rollback (a justificativa só é pedida quando uma política do SP2 se aplica). */
export class RollbackImportDto {
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  justification?: string;
}
