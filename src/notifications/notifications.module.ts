import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsCronService } from './notifications.cron';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsCronService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  private readonly logger = new Logger(NotificationsModule.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (admin.apps.length > 0) return; // Already initialized

    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );
    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );

    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.logger.log(
        'Firebase Admin initialized with service account (from env var)',
      );
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, 'utf8'),
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.logger.log(
        'Firebase Admin initialized with service account (from file)',
      );
    } else {
      // Initialize without credentials — FCM sends will fail gracefully
      try {
        admin.initializeApp();
        this.logger.warn(
          'Firebase Admin initialized without service account — FCM pushes will not work',
        );
      } catch {
        this.logger.warn(
          'Firebase Admin could not be initialized — FCM pushes will not work',
        );
      }
    }
  }
}
