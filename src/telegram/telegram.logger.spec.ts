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

	it('пересылает log с обычным контекстом приложения в HTML-формате', () => {
		logger.log('заказ обработан', 'CdekService');

		expect(telegramService.sendMessage).toHaveBeenCalledWith(
			'ℹ️ <b>LOG</b> · <code>CdekService</code>\n<pre>заказ обработан</pre>',
			{ parse_mode: 'HTML' },
		);
	});

	it('пересылает error даже с контекстом, похожим на служебный, если он не в списке', () => {
		logger.error('что-то сломалось', undefined, 'MegagroupService');

		expect(telegramService.sendMessage).toHaveBeenCalledWith(
			'🔴 <b>ERROR</b> · <code>MegagroupService</code>\n<pre>что-то сломалось</pre>',
			{ parse_mode: 'HTML' },
		);
	});

	it('пересылает warn/verbose без контекста как есть', () => {
		logger.warn('предупреждение');
		logger.verbose('подробности');

		expect(telegramService.sendMessage).toHaveBeenNthCalledWith(
			1,
			'🟡 <b>WARN</b>\n<pre>предупреждение</pre>',
			{ parse_mode: 'HTML' },
		);
		expect(telegramService.sendMessage).toHaveBeenNthCalledWith(
			2,
			'💬 <b>VERBOSE</b>\n<pre>подробности</pre>',
			{ parse_mode: 'HTML' },
		);
	});

	it('не пересылает debug — это была временная диагностика, не штатный уровень', () => {
		logger.debug('дебаг-сообщение');

		expect(telegramService.sendMessage).not.toHaveBeenCalled();
	});

	it('экранирует HTML-спецсимволы в тексте сообщения', () => {
		logger.log('оценка <10 && цена > 5', 'CdekService');

		expect(telegramService.sendMessage).toHaveBeenCalledWith(
			'ℹ️ <b>LOG</b> · <code>CdekService</code>\n<pre>оценка &lt;10 &amp;&amp; цена &gt; 5</pre>',
			{ parse_mode: 'HTML' },
		);
	});

	it('обрезает слишком длинные сообщения, не упираясь в лимит Telegram', () => {
		logger.log('x'.repeat(5000), 'CdekService');

		const [text] = telegramService.sendMessage.mock.calls[0] as [string];

		expect(text.length).toBeLessThan(4096);
		expect(text).toContain('обрезано');
	});
});
