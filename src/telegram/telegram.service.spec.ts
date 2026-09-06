import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Telegraf } from 'telegraf';
import { TelegramService } from './telegram.service';

jest.mock('telegraf');

const CONFIG: Record<string, string> = {
	TELEGRAM_BOT_TOKEN: 'bot-token',
	TELEGRAM_CHAT_ID: 'chat-id',
};

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
		jest.clearAllMocks();
	});

	it('отправляет текст в настроенный чат', async () => {
		await service.sendMessage('привет');

		expect(Telegraf).toHaveBeenCalledWith('bot-token');
		expect(sendMessage).toHaveBeenCalledWith('chat-id', 'привет');
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
});
