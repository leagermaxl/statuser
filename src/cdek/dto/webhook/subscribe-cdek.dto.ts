import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUrl } from 'class-validator';
import { CdekWebhookType } from './enums/cdek-webhook-type.enum';

export class SubscribeCdekDto {
	@ApiProperty({ enum: CdekWebhookType })
	@IsEnum(CdekWebhookType)
	type: CdekWebhookType;

	@ApiProperty({
		example: 'https://your-domain.com/cdek/webhook/',
		description: 'Базовый адрес без секрета — CDEK_WEBHOOK_SECRET подставляется автоматически',
	})
	@IsUrl({ require_tld: false })
	url: string;
}
