import { Global, Module } from '@nestjs/common';
import { TelegramLogger } from './telegram.logger';
import { TelegramService } from './telegram.service';

@Global()
@Module({
	providers: [TelegramService, TelegramLogger],
	exports: [TelegramService, TelegramLogger],
})
export class TelegramModule {}
