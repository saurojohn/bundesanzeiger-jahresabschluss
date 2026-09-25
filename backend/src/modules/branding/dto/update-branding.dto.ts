import {
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Body für PATCH /api/branding/:kanzleiId.
 *
 * Alle Felder sind optional — der User aktualisiert nur die Properties,
 * die er ändern möchte. Validierung:
 *
 *   - Hex-Color: #rrggbb Format (6-stellig, kleingeschrieben oder
 *     großgeschrieben; PDFKit akzeptiert beides).
 *   - Custom-Domain: FQDN-Format (mindestens 2 durch Punkte getrennte
 *     Labels; keine IP-Adressen, keine Unterstriche).
 *
 * Logo wird über einen separaten Endpunkt hochgeladen
 * (POST /api/branding/:kanzleiId/logo).
 */
export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @Length(4, 7, { message: 'primaryColor muss ein Hex-String sein (#rrggbb)' })
  @Matches(/^#[a-fA-F0-9]{6}$/, {
    message: 'primaryColor muss das Format #rrggbb haben (z.B. "#2563eb")',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Length(4, 7, { message: 'accentColor muss ein Hex-String sein (#rrggbb)' })
  @Matches(/^#[a-fA-F0-9]{6}$/, {
    message: 'accentColor muss das Format #rrggbb haben (z.B. "#0ea5e9")',
  })
  accentColor?: string;

  @IsOptional()
  @IsString()
  @Length(4, 253, {
    message: 'customDomain muss zwischen 4 und 253 Zeichen lang sein',
  })
  @Matches(
    /^(?=.{4,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
    {
      message:
        'customDomain muss ein gültiger FQDN sein (z.B. "rechnungen.kanzlei.de")',
    },
  )
  customDomain?: string;
}