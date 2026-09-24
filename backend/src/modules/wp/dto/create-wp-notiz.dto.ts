import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/**
 * Body für POST /api/wp/notizen.
 *
 * Genau eine der optionalen IDs (bilanzId, guvId, bilanzPositionId,
 * guvPositionId) muss gesetzt sein — Validierung im Service.
 */
export class CreateWPNotizDto {
  @IsOptional()
  @IsUUID('4', { message: 'bilanzId muss eine gültige UUID sein' })
  bilanzId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'guvId muss eine gültige UUID sein' })
  guvId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'bilanzPositionId muss eine gültige UUID sein' })
  bilanzPositionId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'guvPositionId muss eine gültige UUID sein' })
  guvPositionId?: string;

  @IsString({ message: 'notizText muss ein String sein' })
  @Length(1, 500, {
    message: 'notizText muss zwischen 1 und 500 Zeichen lang sein',
  })
  notizText!: string;
}

/**
 * Body für PATCH /api/wp/notizen/:id/status.
 */
export class UpdateWPNotizStatusDto {
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_REVISION'], {
    message: 'status muss APPROVED, REJECTED oder NEEDS_REVISION sein',
  })
  status!: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
}