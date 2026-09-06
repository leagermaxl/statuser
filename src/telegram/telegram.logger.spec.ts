import { TelegramLogger } from './telegram.logger';
import { TelegramService } from './telegram.service';

describe('TelegramLogger', () => {
	let telegramService: { sendMessage: jest.Mock };
	let logger: TelegramLogger;

	beforeEach(() => {
		telegramService = { sendMessage: jest.fn().mockResolvedValue(undefined) };
		logger = new TelegramLogger(telegramService as unknown as TelegramService);

		// ConsoleLogger пишет напрямую в stdout/stderr, а не через console.* —
		// глушим вывод, чтобы не засорять лог тестов.
		jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
		jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it.each(['NestFactory', 'InstanceLoader', 'RouterExplorer', 'RoutesResolver'])(
		'не пересылает log с контекстом бутстрапа Nest (%s)',
		(context) => {
			logger.log('какое-то сообщение бутстрапа', context);

			expect(telegramService.sendMessage).not.toHaveBeenCalled();
		},
	);

	it('пересылает log с обычным контекстом приложения', () => {
		logger.log('заказ обработан', 'CdekService');

		expect(telegramService.sendMessage).toHaveBeenCalledWith(
			'ℹ️ LOG\n[CdekService] заказ обработан',
		);
	});

	it('пересылает error даже с контекстом, похожим на служебный, если он не в списке', () => {
		logger.error('что-то сломалось', undefined, 'MegagroupService');

		expect(telegramService.sendMessage).toHaveBeenCalledWith(
			'🔴 ERROR\n[MegagroupService] что-то сломалось',
		);
	});

	it('пересылает warn/debug/verbose без контекста как есть', () => {
		logger.warn('предупреждение');
		logger.debug('дебаг');
		logger.verbose('подробности');

		expect(telegramService.sendMessage).toHaveBeenNthCalledWith(1, '🟡 WARN\nпредупреждение');
		expect(telegramService.sendMessage).toHaveBeenNthCalledWith(2, '🔧 DEBUG\nдебаг');
		expect(telegramService.sendMessage).toHaveBeenNthCalledWith(3, '💬 VERBOSE\nподробности');
	});
});
