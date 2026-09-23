import type { GlobalRole, MandantRole } from '../constants/auth.constants';

export interface AuthMandantDto {
  id: string;
  firmenname: string;
  rolle: MandantRole;
}

export interface AuthUserDto {
  id: string;
  email: string;
  vorname: string;
  nachname: string;
  globalRole: GlobalRole;
  mandanten: AuthMandantDto[];
  totpEnabled: boolean;
}

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
  tokenType: string = 'Bearer';
  user!: AuthUserDto;
}
