import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { CreateOrderCdekDto } from './dto/order/create-order.dto';
import { UpdateOrderCdekDto } from './dto/order/update-order.dto';
import { SubscribeCdekDto } from './dto/webhook/subscribe-cdek.dto';
import { ResponseAuthCdek } from './types/cdek-auth.types';
import {
	ResponseCreateOrderCdek,
	ResponseRefusalOrderCdek,
	ResponseUpdateOrderCdek,
} from './types/cdek-order.types';
import {
	ResponseWebhookInfoCdek,
	ResponseWebhookSubscriptionCdek,
} from './types/cdek-webhook.types';

@Injectable()
export class CdekService {
	private readonly logger = new Logger(CdekService.name);
	private readonly TOKEN_CACHE_KEY = 'CDEK_ACCESS_TOKEN';
	// Дедуплицирует параллельные обращения к getAccessToken() при холодном кэше —
	// иначе пачка вебхуков, прилетевших разом, породила бы столько же одновременных
	// запросов токена у СДЕК.
	private accessTokenPromise: Promise<string> | null = null;

	constructor(
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly httpService: HttpService,
	) {}

	async getAccessToken(): Promise<string> {
		const cachedToken = await this.cacheManager.get<string>(this.TOKEN_CACHE_KEY);
		if (cachedToken) {
			return cachedToken;
		}

		if (!this.accessTokenPromise) {
			this.accessTokenPromise = this.fetchAccessToken().finally(() => {
				this.accessTokenPromise = null;
			});
		}

		return this.accessTokenPromise;
	}

	private async fetchAccessToken(): Promise<string> {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const CDEK_CLIENT_ID = this.configService.getOrThrow<string>('CDEK_CLIENT_ID');
		const CDEK_CLIENT_SECRET = this.configService.getOrThrow<string>('CDEK_CLIENT_SECRET');

		const response = await firstValueFrom(
			this.httpService.post<ResponseAuthCdek>(
				`${CDEK_URL}/oauth/token`,
				{},
				{
					params: {
						grant_type: 'client_credentials',
						client_id: CDEK_CLIENT_ID,
						client_secret: CDEK_CLIENT_SECRET,
					},
				},
			),
		);
		const data = response.data;

		if ('error' in data) {
			this.logger.error(`СДЕК не выдал токен: ${data.error_description}`);
			throw new Error(`Auth failed: ${data.error}`);
		}

		const newToken = data.access_token;
		// Токен живёт час — кэшируем на 55 минут, чтобы не ловить протухание впритык
		await this.cacheManager.set(this.TOKEN_CACHE_KEY, newToken, 55 * 60 * 1000);

		return newToken;
	}

	async getOrderInfo(cdekOrderUuid: string, isRetry = false): Promise<unknown> {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.get<unknown>(`${CDEK_URL}/orders/${cdekOrderUuid}`, {
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				}),
			);

			return response.data;
		} catch (error) {
			// Если СДЕК ответил 401 (токен недействителен) и это наша первая попытка —
			// сбрасываем кэш токена и пробуем один раз заново
			if (isAxiosError(error) && error.response?.status === 401 && !isRetry) {
				this.logger.warn(
					'Токен СДЕК недействителен (401). Сбрасываем кэш и пробуем снова...',
				);

				await this.cacheManager.del(this.TOKEN_CACHE_KEY);
				return this.getOrderInfo(cdekOrderUuid, true);
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`Ошибка при запросе к СДЕК: ${errorMessage}`);

			throw error;
		}
	}

	async createOrder(dto: CreateOrderCdekDto): Promise<ResponseCreateOrderCdek> {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.post<ResponseCreateOrderCdek>(`${CDEK_URL}/orders`, dto, {
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				}),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(
				error,
				`создание заказа (${dto.packages?.[0]?.number ?? dto.number ?? '?'})`,
			);
		}
	}

	// СДЕК принимает uuid не в пути, а в теле PATCH /v2/orders — докладываем его сюда
	// из :uuid нашего роута, чтобы для вызывающей стороны API оставалось REST-like.
	async updateOrder(
		cdekOrderUuid: string,
		dto: UpdateOrderCdekDto,
	): Promise<ResponseUpdateOrderCdek> {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.patch<ResponseUpdateOrderCdek>(
					`${CDEK_URL}/orders`,
					{ uuid: cdekOrderUuid, ...dto },
					{
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					},
				),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(error, `редактирование заказа ${cdekOrderUuid}`);
		}
	}

	/**
	 * Переводит заказ в статус NOT_DELIVERED (доп. статус 11 — «отказ от
	 * получения»). Удобно для проверки вебхуков СДЕК: реально меняет статус
	 * заказа, из-за чего СДЕК присылает вебхук на /cdek/webhook/:secret.
	 */
	async registerRefusal(cdekOrderUuid: string): Promise<ResponseRefusalOrderCdek> {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.post<ResponseRefusalOrderCdek>(
					`${CDEK_URL}/orders/${cdekOrderUuid}/refusal`,
					undefined,
					{
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					},
				),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(error, `регистрацию отказа по заказу ${cdekOrderUuid}`);
		}
	}

	async getWebhookInfo() {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.get<ResponseWebhookInfoCdek>(`${CDEK_URL}/webhooks`, {
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				}),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(error, 'получение списка подписок на вебхуки');
		}
	}

	async webhookSubscription({ type, url }: SubscribeCdekDto) {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		// url приходит "чистым" (например https://ваш-домен/cdek/webhook/), секрет
		// из CDEK_WEBHOOK_SECRET подставляем сюда сами — так его не нужно руками
		// дописывать при каждой подписке (особенно с localtunnel, где домен меняется).
		const callbackUrl = this.buildWebhookCallbackUrl(url);

		try {
			const response = await firstValueFrom(
				this.httpService.post<ResponseWebhookSubscriptionCdek>(
					`${CDEK_URL}/webhooks`,
					{ type, url: callbackUrl },
					{
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					},
				),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(error, `подписку на вебхук (${type} -> ${callbackUrl})`);
		}
	}

	/** Приклеивает секрет из CDEK_WEBHOOK_SECRET к базовому урлу вебхука. */
	private buildWebhookCallbackUrl(baseUrl: string): string {
		const webhookSecret = this.configService.getOrThrow<string>('CDEK_WEBHOOK_SECRET');
		return `${baseUrl.replace(/\/+$/, '')}/${webhookSecret}`;
	}

	async webhookUnsubscription(webhookUuid: string) {
		const CDEK_URL = this.configService.getOrThrow<string>('CDEK_URL');
		const token = await this.getAccessToken();

		try {
			const response = await firstValueFrom(
				this.httpService.delete<ResponseWebhookSubscriptionCdek>(
					`${CDEK_URL}/webhooks/${webhookUuid}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
					},
				),
			);

			return response.data;
		} catch (error) {
			throw this.wrapCdekError(error, `удаление вебхука ${webhookUuid}`);
		}
	}

	/**
	 * Общая обёртка ошибок для эндпоинтов /webhooks: СДЕК на 4xx отвечает телом вида
	 * { requests: [{ state: 'INVALID', errors: [{ code, message }] }] }, которое
	 * console.log по умолчанию обрезает до "[Object]" — логируем явным JSON.stringify
	 * и отдаём то же самое в HTTP-ответ, а не сырой AxiosError целиком.
	 */
	private wrapCdekError(error: unknown, action: string): Error {
		if (!isAxiosError(error)) {
			return error instanceof Error ? error : new Error(String(error));
		}

		// Форма ошибок одинаковая у /webhooks и /orders: {requests: [{errors: [...]}]} —
		// кастуем к минимальной общей форме вместо конкретного webhook-типа.
		const cdekErrors = (
			error.response?.data as { requests?: Array<{ errors?: unknown }> } | undefined
		)?.requests?.[0]?.errors;

		this.logger.error(
			`СДЕК отклонил ${action}: ${JSON.stringify(cdekErrors ?? error.response?.data ?? error.message)}`,
		);

		return new BadRequestException(cdekErrors ?? `СДЕК отклонил ${action}`);
	}
}
