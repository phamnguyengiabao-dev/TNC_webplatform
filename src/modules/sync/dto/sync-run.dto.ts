import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SyncRunDto {
  @IsIn(['affiliate'])
  provider!: 'affiliate';

  @IsIn(['full', 'incremental'])
  mode!: 'full' | 'incremental';
}

export class SyncRunQueryDto {
  @IsOptional()
  @IsIn(['CSV', 'AFFILIATE', 'OPEN_PLATFORM', 'META'])
  provider?: 'CSV' | 'AFFILIATE' | 'OPEN_PLATFORM' | 'META';

  @IsOptional()
  @IsIn(['RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL'])
  status?: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL';

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
