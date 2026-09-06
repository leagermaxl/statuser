import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { CdekService } from './cdek.service';
import { CdekWebhookType } from './dto/webhook/enums/cdek-webhook-type.enum';

const CONFIG: Record<string, string> = {
	CDEK_URL: 'https://api.cdek.test/v2',
	CDEK_CLIENT_ID: 'client-id',
	CDEK_CLIENT_SECRET: 'client-secret',
	CDEK_WEBHOOK_SECRET: 'wh-secret',
};

/** Достаточно, чтобы пройти проверку axios.isAxiosError() и содержать response. */
function axiosError(status: number, data?: unknown) {
	return Object.assign(new Error('Request failed'), {
		isAxiosError: true,
		response: { status, data },
	});
}

describe('CdekService', () => {
	let service: CdekService;
	let httpService: {
		post: jest.Mock;
		get: jest.Mock;
		patch: jest.Mock;
		delete: jest.Mock;
	};
	let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

	beforeEach(async () => {
		httpService = { post: jest.fn(), get: jest.fn(), patch: jest.fn(), delete: jest.fn() };
		cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CdekService,
				{ provide: HttpService, useValue: httpService },
				{
					provide: ConfigService,
					useValue: { getOrThrow: jest.fn((key: string) => CONFIG[key]) },
				},
				{ provide: CACHE_MANAGER, useValue: cacheManager },
			],
		}).compile();

		service = module.get(CdekService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('getAccessToken', () => {
		it('возвращает токен из кэша, не обращаясь к СДЕК', async () => {
			cacheManager.get.mockResolvedValue('cached-token');

			await expect(service.getAccessToken()).resolves.toBe('cached-token');
			expect(httpService.post).not.toHaveBeenCalled();
		});

		it('запрашивает новый токен и кэширует его на 55 минут', async () => {
			cacheManager.get.mockResolvedValue(undefined);
			httpService.post.mockReturnValue(
				of({
					data: {
						access_token: 'new-token',
						token_type: 'bearer',
						expires_in: 3600,
						scope: '',
						jti: '1',
					},
				}),
			);

			await expect(service.getAccessToken()).resolves.toBe('new-token');

			expect(httpService.post).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/oauth/token',
				{},
				expect.objectContaining({
					params: {
						grant_type: 'client_credentials',
						client_id: 'client-id',
						client_secret: 'client-secret',
					},
				}),
			);
			expect(cacheManager.set).toHaveBeenCalledWith(
				'CDEK_ACCESS_TOKEN',
				'new-token',
				55 * 60 * 1000,
			);
		});

		it('бросает ошибку, если СДЕК не выдал токен', async () => {
			cacheManager.get.mockResolvedValue(undefined);
			httpService.post.mockReturnValue(
				of({ data: { error: 'invalid_client', error_description: 'bad creds' } }),
			);

			await expect(service.getAccessToken()).rejects.toThrow('Auth failed: invalid_client');
		});

		it('дедуплицирует параллельные вызовы при холодном кэше', async () => {
			cacheManager.get.mockResolvedValue(undefined);
			httpService.post.mockReturnValue(
				of({
					data: {
						access_token: 'shared-token',
						token_type: 'bearer',
						expires_in: 3600,
						scope: '',
						jti: '1',
					},
				}),
			);

			const [first, second] = await Promise.all([
				service.getAccessToken(),
				service.getAccessToken(),
			]);

			expect(first).toBe('shared-token');
			expect(second).toBe('shared-token');
			expect(httpService.post).toHaveBeenCalledTimes(1);
		});
	});

	describe('getOrderInfo', () => {
		beforeEach(() => cacheManager.get.mockResolvedValue('token'));

		it('возвращает данные заказа при успехе', async () => {
			httpService.get.mockReturnValue(of({ data: { uuid: 'order-uuid' } }));

			await expect(service.getOrderInfo('order-uuid')).resolves.toEqual({
				uuid: 'order-uuid',
			});
			expect(httpService.get).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/orders/order-uuid',
				{
					headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
				},
			);
		});

		it('на 401 сбрасывает кэш токена и повторяет запрос один раз', async () => {
			httpService.get
				.mockReturnValueOnce(throwError(() => axiosError(401)))
				.mockReturnValueOnce(of({ data: { uuid: 'order-uuid' } }));

			await expect(service.getOrderInfo('order-uuid')).resolves.toEqual({
				uuid: 'order-uuid',
			});

			expect(cacheManager.del).toHaveBeenCalledWith('CDEK_ACCESS_TOKEN');
			expect(httpService.get).toHaveBeenCalledTimes(2);
		});

		it('пробрасывает ошибку без повтора, если это не 401', async () => {
			httpService.get.mockReturnValue(throwError(() => axiosError(500)));

			await expect(service.getOrderInfo('order-uuid')).rejects.toBeDefined();
			expect(httpService.get).toHaveBeenCalledTimes(1);
			expect(cacheManager.del).not.toHaveBeenCalled();
		});

		it('не повторяет запрос повторно, если 401 пришёл уже при повторной попытке', async () => {
			httpService.get.mockReturnValue(throwError(() => axiosError(401)));

			await expect(service.getOrderInfo('order-uuid', true)).rejects.toBeDefined();
			expect(httpService.get).toHaveBeenCalledTimes(1);
		});
	});

	describe('createOrder', () => {
		const dto = {
			shipment_point: 'MSK65',
			delivery_point: 'KST16',
			tariff_code: 10,
			number: 'ORDER-1',
			recipient: { name: 'Тест Тестов', phones: [{ number: '79999999999' }] },
			packages: [
				{
					number: '1',
					weight: 500,
					items: [
						{
							name: 'Товар',
							ware_key: 'sku-1',
							payment: { value: 0 },
							weight: 500,
							amount: 1,
							cost: 100,
						},
					],
				},
			],
		} as Parameters<CdekService['createOrder']>[0];

		beforeEach(() => cacheManager.get.mockResolvedValue('token'));

		it('создаёт заказ и возвращает ответ СДЕК', async () => {
			httpService.post.mockReturnValue(
				of({ data: { entity: { uuid: 'new-uuid' }, requests: [] } }),
			);

			await expect(service.createOrder(dto)).resolves.toEqual({
				entity: { uuid: 'new-uuid' },
				requests: [],
			});
			expect(httpService.post).toHaveBeenCalledWith('https://api.cdek.test/v2/orders', dto, {
				headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
			});
		});

		it('оборачивает отказ СДЕК в BadRequestException с деталями ошибок', async () => {
			httpService.post.mockReturnValue(
				throwError(() =>
					axiosError(400, { requests: [{ errors: [{ code: 'X', message: 'bad' }] }] }),
				),
			);

			await expect(service.createOrder(dto)).rejects.toBeInstanceOf(BadRequestException);
			await expect(service.createOrder(dto)).rejects.toMatchObject({
				response: { message: [{ code: 'X', message: 'bad' }] },
			});
		});

		it('пробрасывает не-axios ошибки как есть', async () => {
			httpService.post.mockReturnValue(throwError(() => new Error('boom')));

			await expect(service.createOrder(dto)).rejects.toThrow('boom');
		});
	});

	describe('updateOrder', () => {
		beforeEach(() => cacheManager.get.mockResolvedValue('token'));

		it('подставляет uuid в тело PATCH-запроса', async () => {
			httpService.patch.mockReturnValue(
				of({ data: { entity: { uuid: 'u' }, requests: [] } }),
			);

			await service.updateOrder('u', { tariff_code: 11 } as Parameters<
				CdekService['updateOrder']
			>[1]);

			expect(httpService.patch).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/orders',
				{ uuid: 'u', tariff_code: 11 },
				expect.anything(),
			);
		});
	});

	describe('registerRefusal', () => {
		beforeEach(() => cacheManager.get.mockResolvedValue('token'));

		it('отправляет запрос на регистрацию отказа по uuid заказа', async () => {
			httpService.post.mockReturnValue(of({ data: { entity: { uuid: 'u' }, requests: [] } }));

			await service.registerRefusal('u');

			expect(httpService.post).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/orders/u/refusal',
				undefined,
				expect.anything(),
			);
		});
	});

	describe('вебхуки', () => {
		beforeEach(() => cacheManager.get.mockResolvedValue('token'));

		it('getWebhookInfo возвращает список подписок', async () => {
			httpService.get.mockReturnValue(of({ data: [{ uuid: 'w1' }] }));

			await expect(service.getWebhookInfo()).resolves.toEqual([{ uuid: 'w1' }]);
		});

		it('webhookSubscription дописывает секрет к базовому url', async () => {
			httpService.post.mockReturnValue(of({ data: { uuid: 'w1' } }));

			await service.webhookSubscription({
				type: CdekWebhookType.ORDER_STATUS,
				url: 'https://example.com/cdek/webhook/',
			});

			expect(httpService.post).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/webhooks',
				{
					type: CdekWebhookType.ORDER_STATUS,
					url: 'https://example.com/cdek/webhook/wh-secret',
				},
				expect.anything(),
			);
		});

		it('webhookUnsubscription удаляет подписку по uuid', async () => {
			httpService.delete.mockReturnValue(of({ data: { uuid: 'w1' } }));

			await service.webhookUnsubscription('w1');

			expect(httpService.delete).toHaveBeenCalledWith(
				'https://api.cdek.test/v2/webhooks/w1',
				expect.anything(),
			);
		});

		it('оборачивает ошибки вебхуков так же, как ошибки заказов', async () => {
			httpService.get.mockReturnValue(
				throwError(() => axiosError(400, { requests: [{ errors: [{ code: 'Y' }] }] })),
			);

			await expect(service.getWebhookInfo()).rejects.toMatchObject({
				response: { message: [{ code: 'Y' }] },
			});
		});
	});
});
