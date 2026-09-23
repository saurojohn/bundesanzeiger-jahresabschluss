import { IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @IsString({ message: 'refreshToken muss ein String sein' })
  @Length(10, 500, { message: 'refreshToken hat ungültige Länge' })
  refreshToken!: string;
}
