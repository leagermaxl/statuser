import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Telegraf, TelegramError } from 'telegraf';
import { TelegramService } from './telegram.service';

// Automock не сохраняет getter'ы/instanceof-семантику реального TelegramError,
// поэтому подменяем модуль своей лёгкой, но по-настоящему рабочей реализацией —
// сервис и тест берут один и тот же класс, instanceof работает как надо.
jest.mock('telegraf', () => {
	class MockTelegramError extends Error {
		constructor(
			public readonly response: {
				error_code: number;
				description: string;
				parameters?: { migrate_to_chat_id?: number; retry_after?: number };
			},
		) {
			super(`${response.error_code}: ${response.description}`);
		}

		get parameters() {
			return this.response.parameters;
		}
	}

	return {
		Telegraf: jest.fn(),
		TelegramError: MockTelegramError,
	};
});

const CONFIG: Record<string, string> = {
	TELEGRAM_BOT_TOKEN: 'bot-token',
	TELEGRAM_CHAT_ID: 'chat-id',
};

function tooManyRequestsError(retryAfter: number): TelegramError {
	return new TelegramError({
		error_code: 429,
		description: `Too Many Requests: retry after ${retryAfter}`,
		parameters: { retry_after: retryAfter },
	});
}

describe('TelegramService', () => {
	let service: TelegramService;
	let sendMessage: jest.Mock;

	beforeEach(async () => {
		sendMessage = jest.fn().mockResolvedValue(undefined);
		(Telegraf as unknown as jest.Mock).mockImplementation(() => ({
			telegram: { sendMessage },
		}));

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TelegramService,
				{
					provide: ConfigService,
					useValue: { getOrThrow: jest.fn((key: string) => CONFIG[key]) },
				},
			],
		}).compile();

		service = module.get(TelegramService);
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.clearAllMocks();
	});

	it('отправляет текст в настроенный чат', async () => {
		await service.sendMessage('привет');

		expect(Telegraf).toHaveBeenCalledWith('bot-token');
		expect(sendMessage).toHaveBeenCalledWith('chat-id', 'привет', undefined);
	});

	it('прокидывает дополнительные опции (например, parse_mode) в Telegraf', async () => {
		await service.sendMessage('<b>привет</b>', { parse_mode: 'HTML' });

		expect(sendMessage).toHaveBeenCalledWith('chat-id', '<b>привет</b>', {
			parse_mode: 'HTML',
		});
	});

	it('создаёт клиент Telegraf лениво и переиспользует его между вызовами', async () => {
		await service.sendMessage('первое');
		await service.sendMessage('второе');

		expect(Telegraf).toHaveBeenCalledTimes(1);
	});

	it('глотает ошибку отправки, не давая ей всплыть наружу', async () => {
		sendMessage.mockRejectedValue(new Error('Telegram недоступен'));

		await expect(service.sendMessage('привет')).resolves.toBeUndefined();
	});

	it('при 429 ждёт retry_after и повторяет отправку', async () => {
		jest.useFakeTimers();
		sendMessage.mockRejectedValueOnce(tooManyRequestsError(5)).mockResolvedValueOnce(undefined);

		const promise = service.sendMessage('привет');

		await jest.advanceTimersByTimeAsync(0);
		expect(sendMessage).toHaveBeenCalledTimes(1);

		// (retry_after + 1) секунда запаса — см. реализацию sendWithRetry
		await jest.advanceTimersByTimeAsync(6000);
		await promise;

		expect(sendMessage).toHaveBeenCalledTimes(2);
	});

	it('сдаётся после исчерпания попыток при постоянных 429', async () => {
		jest.useFakeTimers();
		jest.spyOn(console, 'error').mockImplementation(() => undefined);
		sendMessage.mockRejectedValue(tooManyRequestsError(1));

		const promise = service.sendMessage('привет');

		// 1 изначальная попытка + 3 ретрая = 4, с запасом по времени между ними
		await jest.advanceTimersByTimeAsync(10_000);
		await promise;

		expect(sendMessage).toHaveBeenCalledTimes(4);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Too Many Requests'));
	});

	it('выдерживает минимальный интервал между последовательными отправками', async () => {
		jest.useFakeTimers();

		const first = service.sendMessage('первое');
		const second = service.sendMessage('второе');

		await jest.advanceTimersByTimeAsync(0);
		expect(sendMessage).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(349);
		expect(sendMessage).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(1);
		expect(sendMessage).toHaveBeenCalledTimes(2);

		await Promise.all([first, second]);
	});
});
