import { ConsoleLogger, Injectable } from '@nestjs/common';
import { TelegramService } from './telegram.service';

/**
 * Контексты штатного бутстрапа Nest — при каждом старте (а на Render/SnapDeploy
 * сервис периодически засыпает и поднимается заново) от них улетает пачка
 * сообщений почти одновременно, и Telegram отвечает 429 Too Many Requests.
 * Сам старт не даёт полезной информации для мониторинга, поэтому в Telegram
 * не дублируем.
 */
const SILENCED_CONTEXTS = new Set([
	'NestFactory',
	'InstanceLoader',
	'RouterExplorer',
	'RoutesResolver',
]);

/** Реальный лимит Telegram — 4096 символов на сообщение; оставляем запас под теги/заголовок. */
const MAX_BODY_LENGTH = 3500;

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(value: string): string {
	return value.length > MAX_BODY_LENGTH
		? `${value.slice(0, MAX_BODY_LENGTH)}\n… (обрезано)`
		: value;
}

/**
 * Дублирует log/warn/error/verbose в Telegram поверх обычного консольного
 * логгера Nest, с HTML-разметкой (жирный уровень + заголовок, тело —
 * моноширинным блоком) для читаемости. debug сознательно не дублируется —
 * это была временная диагностика, в штатном режиме только засоряет чат.
 */
@Injectable()
export class TelegramLogger extends ConsoleLogger {
	constructor(private readonly telegramService: TelegramService) {
		super();
	}

	override error(message: unknown, ...rest: unknown[]): void {
		super.error(message, ...rest);
		const { context } = this.getContextAndStackAndMessagesToPrint([message, ...rest]);
		this.forward('🔴', 'ERROR', message, context);
	}

	override warn(message: unknown, ...rest: unknown[]): void {
		super.warn(message, ...rest);
		this.forward('🟡', 'WARN', message, this.extractContext(message, rest));
	}

	override log(message: unknown, ...rest: unknown[]): void {
		super.log(message, ...rest);
		this.forward('ℹ️', 'LOG', message, this.extractContext(message, rest));
	}

	override verbose(message: unknown, ...rest: unknown[]): void {
		super.verbose(message, ...rest);
		this.forward('💬', 'VERBOSE', message, this.extractContext(message, rest));
	}

	private extractContext(message: unknown, rest: unknown[]): string | undefined {
		return this.getContextAndMessagesToPrint([message, ...rest]).context;
	}

	private forward(
		emoji: string,
		level: string,
		message: unknown,
		context: string | undefined,
	): void {
		if (context && SILENCED_CONTEXTS.has(context)) return;

		const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
		const header = context
			? `${emoji} <b>${level}</b> · <code>${escapeHtml(context)}</code>`
			: `${emoji} <b>${level}</b>`;
		const body = escapeHtml(truncate(text));

		// Не await'им и не пробрасываем ошибку — падение отправки в Telegram
		// не должно валить обработку запроса, которая и породила этот лог.
		void this.telegramService.sendMessage(`${header}\n<pre>${body}</pre>`, {
			parse_mode: 'HTML',
		});
	}
}
