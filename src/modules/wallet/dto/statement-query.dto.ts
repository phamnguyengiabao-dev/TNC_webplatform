import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Query contract for GET /wallet/statement (docs 11.7.2). */
export class StatementQueryDto {
  /** Id of the last entry of the previous page (keyset pagination). */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
