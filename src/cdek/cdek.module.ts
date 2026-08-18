import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { MegagroupModule } from '../megagroup/megagroup.module';
import { CdekController } from './cdek.controller';
import { CdekService } from './cdek.service';
import { CdekWebhookSignatureGuard } from './guards/cdek-webhook-signature.guard';
import { MegagroupSyncProcessor } from './megagroup-sync.processor';

@Module({
	imports: [
		HttpModule,
		MegagroupModule,
		BullModule.registerQueue({
			name: 'megagroup-sync',
		}),
	],
	controllers: [CdekController],
	providers: [CdekService, MegagroupSyncProcessor, CdekWebhookSignatureGuard, AdminAuthGuard],
})
export class CdekModule {}
