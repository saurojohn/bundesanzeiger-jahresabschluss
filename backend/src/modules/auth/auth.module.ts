import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { EncryptionService } from './services/encryption.service';
import { TotpService } from './services/totp.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.get<string>('JWT_SECRET', 'change-me'),
        signOptions: {
          algorithm: 'HS256',
        },
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TotpService,
    EncryptionService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  // JwtModule wird exportiert, damit ApiModule (M4 Sprint 1, OAuth2
  // client_credentials) JwtService injizieren kann. Ohne diesen Export
  // schlug der DI-Container mit "UnknownDependenciesException: JwtService
  // at index [2] in ApiModule" fehl.
  exports: [AuthService, TotpService, EncryptionService, JwtModule],
})
export class AuthModule {}
