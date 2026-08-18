import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsNumberString,
	IsString,
	ValidateNested,
} from 'class-validator';
import { CdekOrderStatusCode } from './enums/cdek-order-status-code.enum';
import { RelatedEntityDto } from './related-entity.dto';

export class OrderStatusAttributesDto {
	@ApiProperty()
	@IsBoolean()
	is_return: boolean;

	@ApiProperty()
	@IsBoolean()
	is_reverse: boolean;

	@ApiProperty()
	@IsBoolean()
	is_client_return: boolean;

	@ApiProperty({ description: 'Номер накладной СДЕК' })
	@IsString()
	cdek_number: string;

	@ApiProperty({ description: 'Номер заказа в вашем магазине' })
	@IsString()
	number: string;

	@ApiProperty({ type: [RelatedEntityDto] })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => RelatedEntityDto)
	related_entities: RelatedEntityDto[];

	@ApiProperty({ enum: CdekOrderStatusCode })
	@IsEnum(CdekOrderStatusCode)
	code: CdekOrderStatusCode;

	// Приходит строкой, например "3"
	@ApiProperty({ example: '3' })
	@IsNumberString()
	status_code: string;

	// Формат "+0000" без двоеточия — стандартный @IsDateString()
	// не всегда его валидирует строго, поэтому оставляем как строку.
	@ApiProperty({ example: '2023-11-28T07:44:45+0000' })
	@IsString()
	status_date_time: string;

	@ApiProperty()
	@IsString()
	city_name: string;

	@ApiProperty()
	@IsNumberString()
	city_code: string;

	@ApiProperty()
	@IsBoolean()
	deleted: boolean;
}
