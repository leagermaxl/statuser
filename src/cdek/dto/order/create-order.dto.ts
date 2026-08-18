import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	ArrayMinSize,
	IsArray,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsPositive,
	IsString,
	Min,
	ValidateNested,
} from 'class-validator';

export class PhoneDto {
	@ApiProperty({ example: '7985123123', description: 'Номер телефона получателя' })
	@IsString()
	@IsNotEmpty()
	number: string;
}

export class RecipientDto {
	@ApiProperty({ example: 'Кирито Горило', description: 'ФИО получателя' })
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiProperty({ type: [PhoneDto] })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => PhoneDto)
	phones: PhoneDto[];
}

export class PackagePaymentDto {
	@ApiProperty({ example: 5000, description: 'Сумма наложенного платежа за товар' })
	@IsNumber()
	@Min(0)
	value: number;
}

export class PackageItemDto {
	@ApiProperty({ example: 'Мишка Мамбаснейк', description: 'Название товара' })
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiProperty({ example: 'black-mamba', description: 'Артикул товара' })
	@IsString()
	@IsNotEmpty()
	ware_key: string;

	@ApiProperty({ type: PackagePaymentDto })
	@ValidateNested()
	@Type(() => PackagePaymentDto)
	payment: PackagePaymentDto;

	@ApiProperty({ example: 700, description: 'Вес товара, г' })
	@IsInt()
	@IsPositive()
	weight: number;

	@ApiProperty({ example: 1, description: 'Количество товара' })
	@IsInt()
	@IsPositive()
	amount: number;

	@ApiProperty({ example: 5000, description: 'Стоимость товара (для таможни/страховки)' })
	@IsNumber()
	@Min(0)
	cost: number;
}

export class PackageDto {
	@ApiProperty({
		example: '1488228',
		description: 'Номер упаковки (произвольный, для идентификации)',
	})
	@IsString()
	@IsNotEmpty()
	number: string;

	@ApiProperty({ example: 1000, description: 'Общий вес упаковки, г' })
	@IsInt()
	@IsPositive()
	weight: number;

	@ApiProperty({ type: [PackageItemDto] })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => PackageItemDto)
	items: PackageItemDto[];
}

export class CreateOrderCdekDto {
	@ApiProperty({ example: 'MSK65', description: 'Код склада отправления СДЕК' })
	@IsString()
	@IsNotEmpty()
	shipment_point: string;

	@ApiProperty({ example: 'KST16', description: 'Код склада/ПВЗ доставки СДЕК' })
	@IsString()
	@IsNotEmpty()
	delivery_point: string;

	@ApiProperty({ example: 10, description: 'Код тарифа СДЕК' })
	@IsInt()
	@IsPositive()
	tariff_code: number;

	@ApiPropertyOptional({ description: 'Номер заказа в вашей системе (если нужен)' })
	@IsOptional()
	@IsString()
	number?: string;

	@ApiProperty({ type: RecipientDto })
	@ValidateNested()
	@Type(() => RecipientDto)
	recipient: RecipientDto;

	@ApiProperty({ type: [PackageDto] })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => PackageDto)
	packages: PackageDto[];
}
