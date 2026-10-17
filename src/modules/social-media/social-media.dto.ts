import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsUrl } from 'class-validator';
import { SocialMediaVisibility } from '@prisma/client';

export class SetSocialMediaVisibilityDto {
  @IsEnum(SocialMediaVisibility)
  visibility!: SocialMediaVisibility;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  selectedMediaUrls?: string[];
}
