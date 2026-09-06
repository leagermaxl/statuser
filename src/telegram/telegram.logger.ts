import { ConsoleLogger, Injectable } from '@nestjs/common';
import { TelegramService } from './telegram.service';

/**
 * Контексты штатного бутстрапа Nest — при каждом старте (а на Render сервис
 * периодически засыпает и поднимается заново) от них улетает пачка сообщений
 * почти одновременно, и Telegram отвечает 429 Too Many Requests. Сам старт
 * не даёт полезной информации для мониторинга, поэтому в Telegram не дублируем.
 */
const SILENCED_CONTEXTS = new Set([
	'NestFactory',
	'InstanceLoader',
	'RouterExplorer',
	'RoutesResolver',
]);

/**
 * Пока что дублирует в Telegram вообще все остальные логи поверх обычного
 * консольного логгера Nest — временно, для отладки на Render, где консоли
 * под рукой нет. Когда трафика станет много, стоит вернуться к error/warn
 * (см. git-историю этого файла) или завести отдельный уровень фильтрации.
 */
@Injectable()
export class TelegramLogger extends ConsoleLogger {
	constructor(private readonly telegramService: TelegramService) {
		super();
	}

	override error(message: unknown, ...rest: unknown[]): void {
		super.error(message, ...rest);
		const { context } = this.getContextAndStackAndMessagesToPrint([message, ...rest]);
		this.forward('🔴 ERROR', message, context);
	}

	override warn(message: unknown, ...rest: unknown[]): void {
		super.warn(message, ...rest);
		this.forward('🟡 WARN', message, this.extractContext(message, rest));
	}

	override log(message: unknown, ...rest: unknown[]): void {
		super.log(message, ...rest);
		this.forward('ℹ️ LOG', message, this.extractContext(message, rest));
	}

	override debug(message: unknown, ...rest: unknown[]): void {
		super.debug(message, ...rest);
		this.forward('🔧 DEBUG', message, this.extractContext(message, rest));
	}

	override verbose(message: unknown, ...rest: unknown[]): void {
		super.verbose(message, ...rest);
		this.forward('💬 VERBOSE', message, this.extractContext(message, rest));
	}

	private extractContext(message: unknown, rest: unknown[]): string | undefined {
		return this.getContextAndMessagesToPrint([message, ...rest]).context;
	}

	private forward(prefix: string, message: unknown, context: string | undefined): void {
		if (context && SILENCED_CONTEXTS.has(context)) return;

		const text = typeof message === 'string' ? message : JSON.stringify(message);
		const withContext = context ? `[${context}] ${text}` : text;

		// Не await'им и не пробрасываем ошибку — падение отправки в Telegram
		// не должно валить обработку запроса, которая и породила этот лог.
		void this.telegramService.sendMessage(`${prefix}\n${withContext}`);
	}
}
