import { InjectQueue } from '@nestjs/bullmq';
import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Logger,
	Param,
	Patch,
	Post,
	UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { HttpStatusCode } from 'axios';
import { Queue } from 'bullmq';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CdekService } from './cdek.service';
import { CreateOrderCdekDto } from './dto/order/create-order.dto';
import { UpdateOrderCdekDto } from './dto/order/update-order.dto';
import { OrderStatusWebhookDto } from './dto/webhook/order-status-webhook.dto';
import { SubscribeCdekDto } from './dto/webhook/subscribe-cdek.dto';
import { CdekWebhookSignatureGuard } from './guards/cdek-webhook-signature.guard';

@ApiTags('cdek')
@Controller('cdek')
export class CdekController {
	private readonly logger = new Logger(CdekController.name);

	constructor(
		private readonly cdekService: CdekService,
		@InjectQueue('megagroup-sync') private readonly syncQueue: Queue,
	) {}

	@ApiOperation({
		summary: 'Создать заказ в СДЕК',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Post('/orders')
	async createOrder(@Body() dto: CreateOrderCdekDto) {
		return this.cdekService.createOrder(dto);
	}

	@ApiOperation({
		summary: 'Получить информацию о заказе в СДЕК по его uuid',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiParam({
		name: 'uuid',
		description: 'uuid заказа, возвращается в ответе на создание заказа',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Get('/orders/:uuid')
	async getOrder(@Param('uuid') uuid: string) {
		return this.cdekService.getOrderInfo(uuid);
	}

	@ApiOperation({
		summary: 'Отредактировать заказ в СДЕК',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiParam({
		name: 'uuid',
		description: 'uuid заказа, возвращается в ответе на создание заказа',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Patch('/orders/:uuid')
	async updateOrder(@Param('uuid') uuid: string, @Body() dto: UpdateOrderCdekDto) {
		return this.cdekService.updateOrder(uuid, dto);
	}

	@ApiOperation({
		summary: 'Зарегистрировать отказ по заказу (переводит его в статус NOT_DELIVERED)',
		description:
			'Требует заголовок x-admin-token. Реально меняет статус заказа в СДЕК, из-за чего ' +
			'СДЕК присылает вебхук на /cdek/webhook/:secret — удобно для проверки работы вебхуков.',
	})
	@ApiParam({
		name: 'uuid',
		description: 'uuid заказа, возвращается в ответе на создание заказа',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Post('/orders/:uuid/refusal')
	async registerRefusal(@Param('uuid') uuid: string) {
		return this.cdekService.registerRefusal(uuid);
	}

	@ApiOperation({
		summary: 'Посмотреть текущие подписки на вебхуки в СДЕК',
		description: 'Требует заголовок x-admin-token. Секрет в url маскируется в ответе.',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Get('/webhook/subscription')
	async getWebhookSubscriptions() {
		const info = await this.cdekService.getWebhookInfo();
		return this.maskWebhookSecret(info);
	}

	@ApiOperation({
		summary: 'Подписать вебхук в СДЕК на события по заказам',
		description:
			'Требует заголовок x-admin-token. В поле url достаточно базового адреса вида ' +
			'https://ваш-домен/cdek/webhook/ — секрет из CDEK_WEBHOOK_SECRET подставится автоматически на сервере.',
	})
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Post('/webhook/subscription')
	async webhookSubscription(@Body() dto: SubscribeCdekDto) {
		return this.cdekService.webhookSubscription(dto);
	}

	@ApiOperation({
		summary: 'Удалить подписку на вебхук в СДЕК по её uuid',
		description: 'Требует заголовок x-admin-token.',
	})
	@ApiParam({ name: 'uuid', description: 'uuid подписки, см. GET /cdek/webhook/subscription' })
	@ApiSecurity('admin-token')
	@UseGuards(AdminAuthGuard)
	@Delete('/webhook/subscription/:uuid')
	async webhookUnsubscription(@Param('uuid') uuid: string) {
		return this.cdekService.webhookUnsubscription(uuid);
	}

	@ApiOperation({ summary: 'Приём вебхука СДЕК об изменении статуса заказа' })
	@ApiParam({
		name: 'secret',
		description: 'Секретная часть пути — должна совпадать с CDEK_WEBHOOK_SECRET из .env',
	})
	@UseGuards(CdekWebhookSignatureGuard)
	@HttpCode(HttpStatusCode.Ok)
	@Post('/webhook/:secret')
	async webhookHandler(@Body() payload: OrderStatusWebhookDto) {
		const cdek_number = payload.attributes.cdek_number;
		const number = payload.attributes.number;
		const code = payload.attributes.code;

		await this.syncQueue.add(
			'update-status',
			{ cdek_number, number, code },
			{ attempts: 3, backoff: { type: 'exponential', delay: 60000 }, removeOnComplete: true },
		);

		this.logger.log(`Задача для заказа ${number} добавлена в очередь`);

		return { status: 'success' };
	}

	/**
	 * Даже за AdminAuthGuard'ом не отдаём секрет наружу в открытом виде — на случай
	 * если авторизация где-то отвалится/будет неверно настроена (defense in depth).
	 * Маскирует последний сегмент пути в url (там, где у нас CDEK_WEBHOOK_SECRET).
	 */
	private maskWebhookSecret(info: unknown): unknown {
		const maskUrl = (url: unknown): unknown => {
			if (typeof url !== 'string') return url;
			return url.replace(/\/[^/]+\/?$/, '/***');
		};

		const maskEntry = (entry: unknown): unknown => {
			if (entry && typeof entry === 'object' && 'url' in entry) {
				return { ...entry, url: maskUrl(entry.url) };
			}
			return entry;
		};

		return Array.isArray(info) ? info.map(maskEntry) : maskEntry(info);
	}
}
