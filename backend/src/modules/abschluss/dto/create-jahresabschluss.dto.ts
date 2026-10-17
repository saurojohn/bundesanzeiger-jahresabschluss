import { IsInt, IsUUID, Max, Min } from 'class-validator';

/**
 * Body für POST /api/jahresabschluss.
 *
 * NUR Mandant und Geschäftsjahr — die drei Bestandteile werden vom Service
 * **selbst ermittelt**, nie vom Aufrufer benannt.
 *
 * Warum: Ein Jahresabschluss ist per Definition die Verknüpfung *der*
 * Bilanz, *der* GuV und *des* Anhangs dieses Mandanten und Jahres. Würde der
 * Aufrufer die IDs mitgeben, könnte er einen Abschluss zusammensetzen, der
 * zu einem anderen Mandant gehört — und der `MandantGuard` prüft nur den
 * Mandanten, nicht die Zusammengehörigkeit der drei Sätze.
 */
export class CreateJahresabschlussDto {
  @IsUUID('4', { message: 'mandantId muss eine gültige UUID sein' })
  mandantId!: string;

  @IsInt({ message: 'geschaeftsjahr muss eine Ganzzahl sein' })
  @Min(2000)
  @Max(2100)
  geschaeftsjahr!: number;
}
