import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { DebugUpdateOrderStatusDto } from './dto/debug-update-order-status.dto';
import { MegagroupService } from './megagroup.service';

@ApiTags('megagroup')
@Controller('megagroup')
export class MegagroupController {
	constructor(private readonly megagroupService: MegagroupService) {}

	/**
	 * Debug-эндпоинт: принудительно прогнать логин + oauth-флоу и проверить,
	 * что сессия в CMS.S3 успешно устанавливается. Закрыт AdminAuthGuard'ом —
	 * тут отдаём только домен шарда и обрезанный mcsid, чтобы не светить куку целиком.
	 */
	@ApiOperation({
		summary: 'Debug: принудительно перелогиниться в Megagroup и проверить сессию',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Post('session/refresh')
	async refreshSession() {
		const session = await this.megagroupService.refreshSession();
		return { domain: session.domain, mcsid: `${session.mcsid.slice(0, 6)}...` };
	}

	/**
	 * Debug-эндпоинт: прогнать findOrderId + updateOrderStatus вручную, минуя
	 * реальный вебхук СДЕК — удобно, когда ждать статуса от СДЕК долго/не хочется.
	 */
	@ApiOperation({
		summary: 'Debug: обновить статус заказа в Megagroup вручную',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Post('debug/update-status')
	async debugUpdateOrderStatus(@Body() dto: DebugUpdateOrderStatusDto) {
		await this.megagroupService.updateOrderStatus('debug', dto.orderNumber, dto.statusCode);
		return { status: 'success' };
	}
}
