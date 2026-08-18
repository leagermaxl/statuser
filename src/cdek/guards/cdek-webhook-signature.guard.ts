import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * У СДЕК нет механизма подписи вебхуков секретом с нашей стороны — при подписке
 * (`POST /v2/webhooks`) передаётся только `{type, url}`, никакого поля под
 * секрет там нет, и заголовков вида X-Cdek-Signature они не присылают.
 *
 * Поэтому защита сделана иначе: секрет зашит прямо в путь вебхука. В СДЕК нужно
 * регистрировать урл вида `https://ваш-домен/cdek/webhook/<CDEK_WEBHOOK_SECRET>`
 * (а не просто `/cdek/webhook`) — тогда только тот, кто знает секретную часть
 * пути, вообще может попасть на этот роут. Guard просто сверяет `:secret` из
 * пути с `CDEK_WEBHOOK_SECRET` из .env.
 *
 * Сравниваем через хэш + timingSafeEqual, а не `===`, чтобы не давать по времени
 * ответа утечку о том, сколько символов секрета угадано верно.
 */
@Injectable()
export class CdekWebhookSignatureGuard implements CanActivate {
	private readonly logger = new Logger(CdekWebhookSignatureGuard.name);

	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const expectedSecret = this.configService.getOrThrow<string>('CDEK_WEBHOOK_SECRET');
		const providedSecret = request.params.secret as string;

		if (!providedSecret) {
			this.logger.warn('Webhook СДЕК без секрета в пути — отклонён');
			throw new UnauthorizedException('Missing webhook secret');
		}

		const expectedHash = createHash('sha256').update(expectedSecret).digest();
		const providedHash = createHash('sha256').update(providedSecret).digest();

		if (!timingSafeEqual(expectedHash, providedHash)) {
			this.logger.warn('Webhook СДЕК с неверным секретом в пути — отклонён');
			throw new UnauthorizedException('Invalid webhook secret');
		}

		return true;
	}
}
