import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
	@ApiOperation({
		summary: 'Проверка живости сервиса (в т.ч. для self-ping и Render health check)',
	})
	@Get()
	check() {
		return { status: 'ok' };
	}
}
