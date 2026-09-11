import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import type { Cache } from 'cache-manager';
import FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { CookieJar } from 'tough-cookie';

interface MegagroupSession {
	domain: string;
	mcsid: string;
	verId: string;
	access: string;
}

/** 4 статуса заказа в модуле "Заказы" (shop2) CMS.S3 — задаются в настройках магазина. */
enum MegagroupOrderStatusId {
	NEW = 1,
	IN_PROGRESS = 2,
	COMPLETED = 3,
	REFUSED = 4,
}

/** Статусы СДЕК, означающие, что заказ успешно доставлен. */
const CDEK_DELIVERED_CODES = new Set(['DELIVERED', 'POSTOMAT_RECEIVED']);

/** Статусы СДЕК, означающие отказ/возврат/отмену заказа. */
const CDEK_REFUSED_CODES = new Set([
	'NOT_DELIVERED',
	'REMOVED',
	'RETURNED_TO_SENDER_CITY_WAREHOUSE',
	'RETURNED_TO_TRANSIT_WAREHOUSE',
	'RETURNED_TO_RECIPIENT_CITY_WAREHOUSE',
	'INVALID',
]);

/**
 * СДЕК шлёт вебхук на каждую смену статуса (в пути, принят на складе и т.п.),
 * а Megagroup интересуют только финальные (доставлен/отказ) — остальные
 * MegagroupService.updateOrderStatus и так молча пропускает. Экспортируем
 * отдельной функцией, чтобы CdekController мог отфильтровать нефинальные
 * вебхуки ДО постановки в очередь BullMQ, а не гонять их через полный цикл
 * джобы (добавили -> воркер прочитал -> обработал -> удалил) впустую.
 */
export function isFinalCdekStatus(cdekStatusCode: string): boolean {
	return CDEK_DELIVERED_CODES.has(cdekStatusCode) || CDEK_REFUSED_CODES.has(cdekStatusCode);
}

/**
 * Сессия в CMS.S3 (cp21.megagroup.ru и т.п.) устроена так:
 *
 * 1. POST {MEGAGROUP_CABINET_URL}/user/login (email/password) -> ставит куку mcmsid
 *    на домене cabinet.megagroup.ru. Живёт ~30 дней.
 * 2. GET {MEGAGROUP_CABINET_URL}/users/{MEGAGROUP_SITE_ID}/enter -> цепочка из
 *    ~8 редиректов (oauth-обмен code между cabinet.megagroup.ru и конкретным
 *    шардом CMS, например cp21.megagroup.ru), в конце которой шард выставляет
 *    свою собственную куку mcsid. Живёт около года (Max-Age=31536000).
 *
 * Дальше все запросы к самой админке (заказы, статусы и т.д.) идут на домен
 * шарда с заголовком `Cookie: mcsid=...` — без mcmsid. Домен шарда (cp21,
 * cp22...) не хардкодим, а определяем динамически по финальному URL после
 * редиректов, т.к. megagroup может перекидывать сайт на другой шард.
 */
@Injectable()
export class MegagroupService {
	private readonly logger = new Logger(MegagroupService.name);
	private readonly SESSION_CACHE_KEY = 'MEGAGROUP_SESSION';
	// mcsid живёт ~365 дней, обновляем заранее, за неделю до реального протухания
	private readonly SESSION_TTL_MS = 358 * 24 * 60 * 60 * 1000;
	// Дедуплицирует параллельные обращения к getSession() при холодном кэше —
	// иначе пачка вебхуков, прилетевших разом, породила бы столько же одновременных
	// логинов в Megagroup.
	private authenticatePromise: Promise<MegagroupSession> | null = null;

	constructor(
		@Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly httpService: HttpService,
	) {}

	/** Достаёт code/syscall/address/port из низкоуровневой сетевой ошибки под AxiosError, если они есть. */
	private describeNetworkError(error: unknown): string {
		if (!isAxiosError(error) || !(error.cause instanceof Error)) return '';

		// Error не объявляет code/syscall/address/port в типах, но Node реально
		// кладёт их в объект ошибки для сетевых сбоев (ECONNREFUSED/ETIMEDOUT/...).
		const cause = error.cause as unknown as {
			code?: string;
			syscall?: string;
			address?: string;
			port?: number;
		};
		const parts = [
			cause.code && `code=${cause.code}`,
			cause.syscall && `syscall=${cause.syscall}`,
			cause.address && `address=${cause.address}`,
			cause.port && `port=${cause.port}`,
		].filter(Boolean);

		return parts.length ? ` [${parts.join(' ')}]` : '';
	}

	/** Полный цикл: логин в cabinet -> oauth-редирект в CMS шарда -> достаём mcsid. */
	private async authenticate(): Promise<MegagroupSession> {
		const cabinetUrl = this.configService.getOrThrow<string>('MEGAGROUP_CABINET_URL');
		const login = this.configService.getOrThrow<string>('MEGAGROUP_LOGIN');
		const password = this.configService.getOrThrow<string>('MEGAGROUP_PASSWORD');
		const siteId = this.configService.getOrThrow<string>('MEGAGROUP_SITE_ID');

		const jar = new CookieJar();
		const client: AxiosInstance = wrapper(axios.create({ jar, maxRedirects: 15 }));

		// 1. Логин в общий кабинет -> mcmsid
		const form = new FormData();
		form.append('_form', 'login_form');
		form.append('email', login);
		form.append('password', password);

		await client.post(`${cabinetUrl}/user/login`, form, { headers: form.getHeaders() });

		const hasMcmsid = (await jar.getCookies(cabinetUrl)).some((c) => c.key === 'mcmsid');
		if (!hasMcmsid) {
			throw new Error(
				'Megagroup: логин не удался — mcmsid не получен (неверный логин/пароль?)',
			);
		}

		// 2. Проходим oauth-редирект-цепочку в CMS нужного сайта -> mcsid шарда
		const enterResponse = await client.get(`${cabinetUrl}/users/${siteId}/enter`);

		// follow-redirects (используется под капотом axios) простявляет реальный
		// финальный URL после всех хопов сюда
		const finalUrl: string | undefined = (
			enterResponse.request as { res?: { responseUrl?: string } }
		)?.res?.responseUrl;

		if (!finalUrl) {
			throw new Error(
				'Megagroup: не удалось определить финальный домен CMS после редиректов',
			);
		}

		const finalUrlParsed = new URL(finalUrl);
		const domain = finalUrlParsed.hostname;
		const cookiesForFinalDomain = await jar.getCookies(finalUrl);
		const mcsidCookie = cookiesForFinalDomain.find((c) => c.key === 'mcsid');

		if (!mcsidCookie) {
			throw new Error(`Megagroup: mcsid не найден для домена ${domain} после oauth-флоу`);
		}

		// Финальная страница редирект-цепочки — админский дашборд (/-/cms/v1/main/),
		// и её URL содержит ver_id/access — те же значения, которые CMS ожидает
		// в query-параметрах всех последующих запросов к её API в рамках этой сессии.
		const verId = finalUrlParsed.searchParams.get('ver_id');
		const access = finalUrlParsed.searchParams.get('access');

		if (!verId || !access) {
			throw new Error(
				`Megagroup: не удалось получить ver_id/access из финального URL (${finalUrl}) после oauth-флоу`,
			);
		}

		const session: MegagroupSession = { domain, mcsid: mcsidCookie.value, verId, access };
		await this.cacheManager.set(this.SESSION_CACHE_KEY, session, this.SESSION_TTL_MS);

		this.logger.log(`Megagroup: получена новая сессия для ${domain}`);

		return session;
	}

	private async getSession(): Promise<MegagroupSession> {
		const cached = await this.cacheManager.get<MegagroupSession>(this.SESSION_CACHE_KEY);
		if (cached) return cached;

		if (!this.authenticatePromise) {
			this.authenticatePromise = this.authenticate().finally(() => {
				this.authenticatePromise = null;
			});
		}

		return this.authenticatePromise;
	}

	/** Принудительно перелогиниться, игнорируя кэш (используется debug-эндпоинтом). */
	async refreshSession(): Promise<MegagroupSession> {
		await this.cacheManager.del(this.SESSION_CACHE_KEY);
		return this.authenticate();
	}

	/**
	 * Универсальный вызов CMS.S3 API текущего магазина. Если mcsid оказался
	 * недействителен (протух раньше срока / сессию отозвали) — один раз
	 * перелогинивается и повторяет запрос.
	 */
	async callAdminApi<T = unknown>(
		path: string,
		options: {
			method?: 'GET' | 'POST' | 'PATCH';
			params?: Record<string, unknown>;
			data?: unknown;
		} = {},
		isRetry = false,
	): Promise<T> {
		const session = await this.getSession();
		const { method = 'GET', params, data } = options;
		const startedAt = Date.now();

		try {
			const response = await firstValueFrom(
				this.httpService.request<T>({
					url: `https://${session.domain}${path}`,
					method,
					params: { ver_id: session.verId, access: session.access, ...params },
					data,
					headers: { Cookie: `mcsid=${session.mcsid}` },
					maxRedirects: 0,
				}),
			);

			return response.data;
		} catch (error) {
			const elapsedMs = Date.now() - startedAt;
			const status = isAxiosError(error) ? error.response?.status : undefined;
			// CMS редиректит на /attorney или /user/login, если сессия невалидна
			const sessionLooksExpired =
				status === 401 || (status !== undefined && status >= 300 && status < 400);

			if (sessionLooksExpired && !isRetry) {
				this.logger.warn(
					`Megagroup: mcsid недействителен (за ${elapsedMs}мс), перелогиниваемся и повторяем запрос`,
				);
				await this.cacheManager.del(this.SESSION_CACHE_KEY);
				return this.callAdminApi(path, options, true);
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(
				`Megagroup: ошибка запроса ${method} ${path} за ${elapsedMs}мс: ${errorMessage}` +
					this.describeNetworkError(error),
			);

			throw error;
		}
	}

	/**
	 * Список заказов CMS.S3 отдаётся как HTML-фрагмент (не JSON), поэтому order_id
	 * приходится вытаскивать регэкспом. Строка заказа в списке выглядит как
	 * "<number>&nbsp;(<order_id>)" — привязываемся к конкретному number, а не берём
	 * первое совпадение, чтобы не задеть чужой заказ, если search_text заодно
	 * зацепит совпадение по имени/телефону/email клиента.
	 */
	private async findOrderId(orderNumber: string): Promise<string> {
		const shopId = this.configService.getOrThrow<string>('MEGAGROUP_SHOP_ID');

		const html = await this.callAdminApi<string>('/-/cms/v1/shop2/order/', {
			params: {
				shop_id: shopId,
				search_text: orderNumber,
				order_date_from: '',
				order_date_to: '',
				has_pre_order: '',
				// rnd: Math.floor(Math.random() * 1_000_000),
			},
		});

		// (?<!\d) слева — иначе поиск "123" ложно матчился бы внутри "9123&nbsp;(...)"
		// как на подстроку более длинного номера другого заказа.
		const escapedNumber = orderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = new RegExp(`(?<!\\d)${escapedNumber}&nbsp;\\((\\d+)\\)`).exec(html);

		if (!match) {
			throw new Error(`Megagroup: заказ с номером ${orderNumber} не найден в CMS.S3`);
		}

		return match[1];
	}

	private mapCdekStatusToMegagroupStatusId(cdekStatusCode: string): MegagroupOrderStatusId {
		if (CDEK_DELIVERED_CODES.has(cdekStatusCode)) return MegagroupOrderStatusId.COMPLETED;
		if (CDEK_REFUSED_CODES.has(cdekStatusCode)) return MegagroupOrderStatusId.REFUSED;

		return MegagroupOrderStatusId.IN_PROGRESS;
	}

	/**
	 * Ставит галочку "оплата получена" у заказа — то же самое действие
	 * (act=transaction_edit&is_payment=1), что шлёт админка при ручном
	 * подтверждении оплаты. Проставляется вместе с переводом заказа в
	 * статус "доставлен".
	 */
	private async markPaymentReceived(orderId: string): Promise<void> {
		await this.callAdminApi('/-/cms/v1/shop2/order/', {
			params: {
				order_id: orderId,
				act: 'transaction_edit',
				is_payment: 1,
				xhr: 1,
				rnd: Math.floor(Math.random() * 1_000_000),
			},
		});
	}

	/**
	 * Возвращает false, если статус СДЕК нефинальный и синхронизация с Megagroup
	 * была пропущена (см. ниже) — вызывающая сторона (MegagroupSyncProcessor)
	 * использует это, чтобы не залогировать пропуск как "успешно обновлено".
	 */
	async updateOrderStatus(
		cdekNumber: string,
		orderNumber: string,
		cdekStatusCode: string,
	): Promise<boolean> {
		const statusId = this.mapCdekStatusToMegagroupStatusId(cdekStatusCode);

		// В Megagroup шлём только финальные статусы (доставлен/отказ) — промежуточные
		// коды СДЕК (в пути, принят на складе и т.п.) сейчас никого не интересуют,
		// а поиск заказа в CMS.S3 — лишний сетевой запрос на каждый такой вебхук.
		if (statusId === MegagroupOrderStatusId.IN_PROGRESS) {
			this.logger.log(
				`Megagroup: заказ ${orderNumber} (СДЕК ${cdekNumber}, код ${cdekStatusCode}) — ` +
					'нефинальный статус, синхронизация с Megagroup пропущена',
			);
			return false;
		}

		const shopId = this.configService.getOrThrow<string>('MEGAGROUP_SHOP_ID');
		const orderId = await this.findOrderId(orderNumber);

		// Тело запроса дублирует то, что реально шлёт админка при смене статуса
		// вручную (пустой ключ = status_id, xhr=1, rnd — антикэш).
		await this.callAdminApi('/-/cms/v1/shop2/order/', {
			method: 'POST',
			params: {
				shop_id: shopId,
				order_id: orderId,
				act: 'updateStatus',
				status_id: statusId,
			},
			data: new URLSearchParams({
				'': String(statusId),
				xhr: '1',
				rnd: String(Math.floor(Math.random() * 1_000_000)),
			}),
		});

		if (statusId === MegagroupOrderStatusId.COMPLETED) {
			await this.markPaymentReceived(orderId);
		}

		this.logger.log(
			`Megagroup: заказ ${orderNumber} (order_id ${orderId}, СДЕК ${cdekNumber}) -> статус ${statusId}` +
				(statusId === MegagroupOrderStatusId.COMPLETED ? ' (оплата отмечена)' : ''),
		);

		return true;
	}
}
