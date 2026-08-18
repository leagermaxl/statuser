import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RelatedEntityDto {
	@ApiProperty()
	@IsString()
	type: string;

	@ApiProperty()
	@IsString()
	uuid: string;
}
