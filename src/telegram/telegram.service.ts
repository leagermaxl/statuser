import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, TelegramError, Types } from 'telegraf';

// Telegram Bot API: не больше ~1 сообщения/сек в один чат — иначе 429.
const MIN_INTERVAL_MS = 350;
const MAX_RETRY_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Только отправка сообщений в один служебный чат — bot.launch() (long polling)
 * не нужен, пока у бота нет команд для приёма.
 *
 * Отправка сериализована через очередь (this.queue) с минимальным интервалом
 * между сообщениями: параллельные sendMessage() (как было раньше — каждый лог
 * стрелял отдельным fire-and-forget вызовом) легко упираются в лимит Telegram
 * при пачке логов подряд и ловят 429. При 429 честно ждём retry_after, который
 * присылает сам Telegram, вместо того чтобы просто терять сообщение.
 *
 * Ошибки отправки (после исчерпания ретраев) логируем через console.error, а
 * не через Nest Logger: иначе TelegramLogger поймал бы этот же error и снова
 * попытался отправить сообщение в Telegram, зациклившись при недоступном API.
 */
@Injectable()
export class TelegramService {
	private readonly chatId: string;
	private bot?: Telegraf;
	private queue: Promise<void> = Promise.resolve();
	private lastSentAt = 0;

	constructor(private readonly configService: ConfigService) {
		this.chatId = this.configService.getOrThrow<string>('TELEGRAM_CHAT_ID');
	}

	private getBot(): Telegraf {
		this.bot ??= new Telegraf(this.configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN'));
		return this.bot;
	}

	async sendMessage(text: string, extra?: Types.ExtraReplyMessage): Promise<void> {
		this.queue = this.queue.then(() => this.sendThrottled(text, extra));
		return this.queue;
	}

	private async sendThrottled(
		text: string,
		extra: Types.ExtraReplyMessage | undefined,
	): Promise<void> {
		const waitMs = MIN_INTERVAL_MS - (Date.now() - this.lastSentAt);
		if (waitMs > 0) await sleep(waitMs);

		await this.sendWithRetry(text, extra, 0);
		this.lastSentAt = Date.now();
	}

	private async sendWithRetry(
		text: string,
		extra: Types.ExtraReplyMessage | undefined,
		attempt: number,
	): Promise<void> {
		try {
			await this.getBot().telegram.sendMessage(this.chatId, text, extra);
		} catch (error) {
			const retryAfter =
				error instanceof TelegramError ? error.parameters?.retry_after : undefined;

			if (retryAfter && attempt < MAX_RETRY_ATTEMPTS) {
				await sleep((retryAfter + 1) * 1000);
				return this.sendWithRetry(text, extra, attempt + 1);
			}

			// При апгрейде группы в супергруппу chat_id меняется, и Telegram присылает
			// новый id прямо в теле ошибки — подсказываем его, чтобы не лезть за ним руками.
			const migratedChatId =
				error instanceof TelegramError && error.parameters?.migrate_to_chat_id;
			const errorMessage = error instanceof Error ? error.message : String(error);
			const hint = migratedChatId
				? ` Чат мигрировал в супергруппу — обновите TELEGRAM_CHAT_ID на ${migratedChatId}.`
				: '';

			console.error(
				`[TelegramService] Не удалось отправить сообщение в Telegram: ${errorMessage}.${hint}`,
			);
		}
	}
}
