import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	ArrayMinSize,
	IsArray,
	IsInt,
	IsOptional,
	IsPositive,
	IsString,
	ValidateNested,
} from 'class-validator';
import { PackageDto, RecipientDto } from './create-order.dto';

/**
 * Тело PATCH /v2/orders в самом СДЕК не принимает uuid в пути — он передаётся в
 * теле запроса вместе с остальными полями. У нас же в контроллере uuid приходит
 * из :uuid пути (как и у GET/DELETE), поэтому здесь его нет — CdekService сам
 * докладывает uuid в тело перед отправкой в СДЕК.
 */
export class UpdateOrderCdekDto {
	@ApiProperty({
		example: 1,
		description: '1 - "интернет-магазин" (только для договора с ИМ), 2 - "доставка"',
	})
	@IsInt()
	@IsPositive()
	type: number;

	@ApiProperty({ type: RecipientDto })
	@ValidateNested()
	@Type(() => RecipientDto)
	recipient: RecipientDto;

	@ApiPropertyOptional({ description: 'Номер заказа в вашей системе' })
	@IsOptional()
	@IsString()
	number?: string;

	@ApiPropertyOptional({ example: 10, description: 'Код тарифа СДЕК' })
	@IsOptional()
	@IsInt()
	@IsPositive()
	tariff_code?: number;

	@ApiPropertyOptional({ description: 'Комментарий к заказу' })
	@IsOptional()
	@IsString()
	comment?: string;

	@ApiPropertyOptional({ example: 'MSK65', description: 'Код склада отправления СДЕК' })
	@IsOptional()
	@IsString()
	shipment_point?: string;

	@ApiPropertyOptional({ example: 'KST16', description: 'Код склада/ПВЗ доставки СДЕК' })
	@IsOptional()
	@IsString()
	delivery_point?: string;

	@ApiPropertyOptional({ type: [PackageDto] })
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => PackageDto)
	packages?: PackageDto[];
}
