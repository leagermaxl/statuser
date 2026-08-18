import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CdekOrderStatusCode } from '../../cdek/dto/webhook/enums/cdek-order-status-code.enum';

export class DebugUpdateOrderStatusDto {
	@ApiProperty({ description: 'Номер заказа в Megagroup — по нему ищется внутренний order_id' })
	@IsString()
	@IsNotEmpty()
	orderNumber: string;

	@ApiProperty({ enum: CdekOrderStatusCode })
	@IsEnum(CdekOrderStatusCode)
	statusCode: CdekOrderStatusCode;
}
