import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { of, throwError } from 'rxjs';
import { MegagroupService } from './megagroup.service';

jest.mock('axios-cookiejar-support', () => ({
	// authenticate() оборачивает свой собственный axios-клиент через wrapper() —
	// нам достаточно вернуть его как есть, управляем поведением через axios.create().
	wrapper: jest.fn((client: unknown) => client),
}));

jest.mock('tough-cookie', () => ({
	CookieJar: jest.fn(),
}));

// resolveForDebug() дёргает реальный DNS — глушим, чтобы тесты не ходили в сеть.
jest.mock('node:dns/promises', () => ({
	lookup: jest.fn().mockResolvedValue({ address: '127.0.0.1', family: 4 }),
}));

const CONFIG: Record<string, string> = {
	MEGAGROUP_CABINET_URL: 'https://cabinet.megagroup.ru',
	MEGAGROUP_LOGIN: 'login',
	MEGAGROUP_PASSWORD: 'password',
	MEGAGROUP_SITE_ID: 'site-1',
	MEGAGROUP_SHOP_ID: 'shop-1',
};

const SESSION_CACHE_KEY = 'MEGAGROUP_SESSION';
const SESSION_TTL_MS = 358 * 24 * 60 * 60 * 1000;

/** Достаточно, чтобы пройти проверку axios.isAxiosError() и содержать response. */
function axiosError(status: number) {
	return Object.assign(new Error('Request failed'), {
		isAxiosError: true,
		response: { status },
	});
}

describe('MegagroupService', () => {
	let service: MegagroupService;
	let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
	let httpService: { request: jest.Mock };
	let authClient: { post: jest.Mock; get: jest.Mock };
	let jar: { getCookies: jest.Mock };

	beforeEach(async () => {
		cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
		httpService = { request: jest.fn() };

		authClient = { post: jest.fn().mockResolvedValue({}), get: jest.fn() };
		jest.spyOn(axios, 'create').mockReturnValue(authClient as never);

		jar = { getCookies: jest.fn() };
		(CookieJar as unknown as jest.Mock).mockImplementation(() => jar);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MegagroupService,
				{ provide: HttpService, useValue: httpService },
				{
					provide: ConfigService,
					useValue: { getOrThrow: jest.fn((key: string) => CONFIG[key]) },
				},
				{ provide: CACHE_MANAGER, useValue: cacheManager },
			],
		}).compile();

		service = module.get(MegagroupService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	/** Настраивает jar/get так, чтобы полный oauth-флоу логина прошёл успешно. */
	function mockSuccessfulLoginFlow(responseUrl: string) {
		jar.getCookies
			.mockResolvedValueOnce([{ key: 'mcmsid', value: 'mcmsid-value' }])
			.mockResolvedValueOnce([{ key: 'mcsid', value: 'mcsid-value' }]);
		authClient.get.mockResolvedValue({ request: { res: { responseUrl } } });
	}

	describe('refreshSession / authenticate', () => {
		it('проходит полный флоу логина и кэширует сессию на 358 дней', async () => {
			mockSuccessfulLoginFlow(
				'https://cp21.megagroup.ru/-/cms/v1/main/?ver_id=42&access=abc123',
			);

			const session = await service.refreshSession();

			expect(session).toEqual({
				domain: 'cp21.megagroup.ru',
				mcsid: 'mcsid-value',
				verId: '42',
				access: 'abc123',
			});
			expect(cacheManager.del).toHaveBeenCalledWith(SESSION_CACHE_KEY);
			expect(cacheManager.set).toHaveBeenCalledWith(
				SESSION_CACHE_KEY,
				session,
				SESSION_TTL_MS,
			);
		});

		it('падает, если после логина не появилась кука mcmsid', async () => {
			jar.getCookies.mockResolvedValueOnce([]);

			await expect(service.refreshSession()).rejects.toThrow(/mcmsid не получен/);
		});

		it('падает, если редирект-цепочка не раскрыла финальный url', async () => {
			jar.getCookies.mockResolvedValueOnce([{ key: 'mcmsid', value: 'x' }]);
			authClient.get.mockResolvedValue({ request: {} });

			await expect(service.refreshSession()).rejects.toThrow(/финальный домен/);
		});

		it('падает, если для финального домена не нашлась кука mcsid', async () => {
			jar.getCookies
				.mockResolvedValueOnce([{ key: 'mcmsid', value: 'x' }])
				.mockResolvedValueOnce([]);
			authClient.get.mockResolvedValue({
				request: {
					res: { responseUrl: 'https://cp21.megagroup.ru/main/?ver_id=1&access=a' },
				},
			});

			await expect(service.refreshSession()).rejects.toThrow(/mcsid не найден/);
		});

		it('падает, если в финальном url нет ver_id/access', async () => {
			jar.getCookies
				.mockResolvedValueOnce([{ key: 'mcmsid', value: 'x' }])
				.mockResolvedValueOnce([{ key: 'mcsid', value: 'y' }]);
			authClient.get.mockResolvedValue({
				request: { res: { responseUrl: 'https://cp21.megagroup.ru/main/' } },
			});

			await expect(service.refreshSession()).rejects.toThrow(/ver_id\/access/);
		});
	});

	describe('callAdminApi', () => {
		const session = {
			domain: 'cp21.megagroup.ru',
			mcsid: 'mcsid-value',
			verId: '1',
			access: 'a',
		};

		beforeEach(() => cacheManager.get.mockResolvedValue(session));

		it('вызывает CMS.S3 с ver_id/access и курой mcsid, без auto-редиректов', async () => {
			httpService.request.mockReturnValue(of({ data: { ok: true } }));

			await expect(service.callAdminApi('/-/cms/v1/shop2/order/')).resolves.toEqual({
				ok: true,
			});

			expect(httpService.request).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://cp21.megagroup.ru/-/cms/v1/shop2/order/',
					method: 'GET',
					params: { ver_id: '1', access: 'a' },
					headers: { Cookie: 'mcsid=mcsid-value' },
					maxRedirects: 0,
				}),
			);
		});

		it('на признак протухшей сессии (401) перелогинивается и повторяет запрос один раз', async () => {
			httpService.request
				.mockReturnValueOnce(throwError(() => axiosError(401)))
				.mockReturnValueOnce(of({ data: { ok: true } }));

			await expect(service.callAdminApi('/path')).resolves.toEqual({ ok: true });

			expect(cacheManager.del).toHaveBeenCalledWith(SESSION_CACHE_KEY);
			expect(httpService.request).toHaveBeenCalledTimes(2);
		});

		it('трактует редирект (3xx) как протухшую сессию и тоже повторяет запрос', async () => {
			httpService.request
				.mockReturnValueOnce(throwError(() => axiosError(302)))
				.mockReturnValueOnce(of({ data: { ok: true } }));

			await expect(service.callAdminApi('/path')).resolves.toEqual({ ok: true });
			expect(httpService.request).toHaveBeenCalledTimes(2);
		});

		it('не повторяет запрос на прочих ошибках', async () => {
			httpService.request.mockReturnValue(throwError(() => axiosError(500)));

			await expect(service.callAdminApi('/path')).rejects.toBeDefined();
			expect(httpService.request).toHaveBeenCalledTimes(1);
		});

		it('не повторяет запрос повторно, если 401 пришёл уже при повторной попытке', async () => {
			httpService.request.mockReturnValue(throwError(() => axiosError(401)));

			await expect(service.callAdminApi('/path', {}, true)).rejects.toBeDefined();
			expect(httpService.request).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateOrderStatus', () => {
		const session = {
			domain: 'cp21.megagroup.ru',
			mcsid: 'mcsid-value',
			verId: '1',
			access: 'a',
		};

		beforeEach(() => cacheManager.get.mockResolvedValue(session));

		it.each([
			['DELIVERED', 3],
			['POSTOMAT_RECEIVED', 3],
			['NOT_DELIVERED', 4],
			['INVALID', 4],
			['RECEIVED_AT_SHIPMENT_WAREHOUSE', 2],
		])('код СДЕК %s маппится в статус Megagroup %i', async (cdekCode, expectedStatusId) => {
			httpService.request
				.mockReturnValueOnce(of({ data: 'ORDER-42&nbsp;(555)' }))
				.mockReturnValueOnce(of({ data: 'ok' }));

			await service.updateOrderStatus('cdek-1', 'ORDER-42', cdekCode);

			expect(httpService.request).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					method: 'POST',
					params: {
						ver_id: '1',
						access: 'a',
						shop_id: 'shop-1',
						order_id: '555',
						act: 'updateStatus',
						status_id: expectedStatusId,
					},
				}),
			);
		});

		it('падает, если заказ с таким номером не найден в списке CMS', async () => {
			httpService.request.mockReturnValueOnce(of({ data: 'ORDER-1&nbsp;(1)' }));

			await expect(
				service.updateOrderStatus('cdek-1', 'ORDER-42', 'DELIVERED'),
			).rejects.toThrow(/не найден/);
		});

		it('не путает номер заказа с более длинным номером, содержащим его как подстроку', async () => {
			httpService.request
				.mockReturnValueOnce(of({ data: '9123&nbsp;(111) 123&nbsp;(222)' }))
				.mockReturnValueOnce(of({ data: 'ok' }));

			await service.updateOrderStatus('cdek-1', '123', 'DELIVERED');

			expect(httpService.request).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					params: {
						ver_id: '1',
						access: 'a',
						shop_id: 'shop-1',
						order_id: '222',
						act: 'updateStatus',
						status_id: 3,
					},
				}),
			);
		});
	});
});
