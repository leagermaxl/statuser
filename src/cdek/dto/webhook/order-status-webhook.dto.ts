import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsString, ValidateNested } from 'class-validator';
import { CdekWebhookType } from './enums/cdek-webhook-type.enum';
import { OrderStatusAttributesDto } from './order-status-attributes.dto';

export class OrderStatusWebhookDto {
	@ApiProperty({ enum: CdekWebhookType })
	@IsEnum(CdekWebhookType)
	type: CdekWebhookType;

	@ApiProperty()
	@IsString()
	date_time: string;

	@ApiProperty()
	@IsString()
	uuid: string;

	@ApiProperty({ type: OrderStatusAttributesDto })
	@ValidateNested()
	@Type(() => OrderStatusAttributesDto)
	attributes: OrderStatusAttributesDto;
}
