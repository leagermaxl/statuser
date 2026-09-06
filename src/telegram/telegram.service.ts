import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, TelegramError } from 'telegraf';

/**
 * Только отправка сообщений в один служебный чат — bot.launch() (long polling)
 * не нужен, пока у бота нет команд для приёма.
 *
 * Ошибки отправки логируем через console.error, а не через Nest Logger: иначе
 * TelegramLogger поймал бы этот же error и снова попытался отправить сообщение
 * в Telegram, зациклившись при недоступном Telegram API.
 */
@Injectable()
export class TelegramService {
	private readonly chatId: string;
	private bot?: Telegraf;

	constructor(private readonly configService: ConfigService) {
		this.chatId = this.configService.getOrThrow<string>('TELEGRAM_CHAT_ID');
	}

	private getBot(): Telegraf {
		this.bot ??= new Telegraf(this.configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN'));
		return this.bot;
	}

	async sendMessage(text: string): Promise<void> {
		try {
			await this.getBot().telegram.sendMessage(this.chatId, text);
		} catch (error) {
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
